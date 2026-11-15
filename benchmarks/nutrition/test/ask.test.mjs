import assert from 'node:assert/strict';
import {appendFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {plannedJobs, rawPath, readJsonl, repeatPath, runAsk} from '../lib/ask.mjs';

const foods = [1, 2].map((fdc_id) => ({fdc_id, dataset: 'sr_legacy', description: `Food ${fdc_id}`, phrase: `a food ${fdc_id}`, grams: 100}));
const price = {input_per_mtok: 1, output_per_mtok: 2};
const answer = '{"energy_kcal": 100, "protein_g": 1, "fat_g": 1, "carbohydrate_g": 1, "fiber_g": 0, "sugars_g": 0, "sodium_mg": 1}';

// Stands in for the API: records each call's model settings and prompt, bills 1000 + 1000 tokens.
function fakeAsk() {
  const calls = [];
  const impl = async (model, prompt) => {
    calls.push({temperature: model.temperature, prompt});
    return {text: answer, usage: {input_tokens: 1000, output_tokens: 1000}, finish_reason: 'stop', response_model: model.id, attempts: 1};
  };
  return {impl, calls};
}

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'nutrition-bench-'));
}

test('plannedJobs: the scored run skips answered foods; the repeat check counts the scored answer as run 1', () => {
  const main = [
    {fdc_id: 1, settings: {temperature: 'default'}, error: null},
    {fdc_id: 2, settings: {temperature: 0}, error: null},
  ];
  assert.deepEqual(plannedJobs(foods, main, [], 0), []);
  assert.deepEqual(plannedJobs(foods, [{fdc_id: 1, error: 'HTTP 500'}], [], 0).map((j) => j.food.fdc_id), [1, 2]);
  const repeats = [
    {fdc_id: 1, settings: {temperature: 'default'}, error: null},
    {fdc_id: 1, settings: {temperature: 'default'}, error: 'HTTP 500'},
    {fdc_id: 2, settings: {temperature: 0}, error: null}, // not a repeat-run answer
  ];
  const jobs = plannedJobs(foods, main, repeats, 3);
  // Food 1: the scored answer and one repeat, so run 3 is left. Food 2: the scored answer
  // (temperature 0 counts as run 1), so runs 2 and 3.
  assert.deepEqual(jobs.map((j) => [j.food.fdc_id, j.run]), [[1, 3], [2, 2], [2, 3]]);
  // A food the scored run never answered gets every run from the repeat check.
  assert.deepEqual(plannedJobs(foods, [], [], 2).map((j) => [j.food.fdc_id, j.run]), [[1, 1], [1, 2], [2, 1], [2, 2]]);
});

test('runAsk --repeat asks at the default temperature, into repeats/raw, numbering the runs, and resumes', async () => {
  const dir = await tempDir();
  try {
    const model = {name: 'flash', provider: 'gemini', id: 'gemini-x', temperature: 0, price};
    const {impl, calls} = fakeAsk();
    const first = await runAsk({foods, models: [model], template: 'How much in {phrase}?', resultsDir: dir, budget: 1, repeat: 2, askImpl: impl, log: () => {}});
    assert.equal(calls.length, 4);
    assert.ok(calls.every((c) => c.temperature === null));
    assert.deepEqual(await readJsonl(rawPath(dir, model)), []); // the scored run's file is untouched
    const stored = await readJsonl(repeatPath(dir, model));
    assert.deepEqual(stored.map((r) => [r.fdc_id, r.run, r.settings.temperature]).sort(), [[1, 1, 'default'], [1, 2, 'default'], [2, 1, 'default'], [2, 2, 'default']]);
    assert.equal(stored[0].prompt.startsWith('How much in a food'), true);
    assert.equal(first.perModel.flash.asked, 4);
    assert.ok(Math.abs(first.spent - 4 * 0.003) < 1e-12);
    // A second run with a higher count asks only the missing runs.
    const again = await runAsk({foods, models: [model], template: '{phrase}', resultsDir: dir, budget: 1, repeat: 3, askImpl: impl, log: () => {}});
    assert.deepEqual([again.perModel.flash.skipped, again.perModel.flash.asked], [4, 2]);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('runAsk --repeat counts the scored answer as the first run and asks the rest at the default temperature', async () => {
  const dir = await tempDir();
  try {
    const model = {name: 'flash', provider: 'gemini', id: 'gemini-x', temperature: 0, price};
    await mkdir(join(dir, 'raw'), {recursive: true});
    await appendFile(rawPath(dir, model), JSON.stringify({fdc_id: 1, time: '2026-11-15T00:00:00Z', settings: {temperature: 0}, response_text: answer, error: null}) + '\n');
    const {impl, calls} = fakeAsk();
    await runAsk({foods, models: [model], template: '{phrase}', resultsDir: dir, budget: 1, repeat: 2, askImpl: impl, log: () => {}});
    assert.equal(calls.length, 3); // food 1 needs one more, food 2 needs two
    assert.ok(calls.every((c) => c.temperature === null));
    const stored = await readJsonl(repeatPath(dir, model));
    assert.deepEqual(stored.map((r) => [r.fdc_id, r.run]).sort(), [[1, 2], [2, 1], [2, 2]]);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('runAsk stops starting calls at the budget and refuses a budget that is not a number', async () => {
  const dir = await tempDir();
  try {
    const model = {name: 'luna', provider: 'openai', id: 'gpt-x', temperature: null, price};
    const {impl, calls} = fakeAsk();
    const result = await runAsk({foods, models: [model], template: '{phrase}', resultsDir: dir, budget: 0.001, concurrency: 1, repeat: 5, askImpl: impl, log: () => {}});
    assert.equal(calls.length, 1); // the first call costs $0.003, so no second one starts
    assert.equal(result.stopped, true);
    await assert.rejects(runAsk({foods, models: [model], template: '{phrase}', resultsDir: dir, budget: NaN, askImpl: impl}), /budget/);
    await assert.rejects(runAsk({foods, models: [model], template: '{phrase}', resultsDir: dir, budget: 1, repeat: 2.5, askImpl: impl}), /repeat/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
