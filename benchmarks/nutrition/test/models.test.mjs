import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {modelProblems, selectModels} from '../lib/models.mjs';

const good = {name: 'haiku', provider: 'anthropic', id: 'claude-x', temperature: null, price: {input_per_mtok: 0.1, output_per_mtok: 0.5}};

test('a complete entry has no problems; temperature may be 0 or null', () => {
  assert.deepEqual(modelProblems(good), []);
  assert.deepEqual(modelProblems({...good, temperature: 0}), []);
});

test('a missing price, a bad provider or a bad temperature is caught before any call', () => {
  assert.match(modelProblems({...good, price: {input_per_mtok: 0.1}}).join(), /output_per_mtok/);
  assert.match(modelProblems({...good, provider: 'mistral'}).join(), /provider/);
  assert.match(modelProblems({...good, temperature: 'default'}).join(), /temperature/);
  assert.match(modelProblems({...good, name: '../escape'}).join(), /name/);
  assert.match(modelProblems({...good, price: {...good.price, changes: [{from: 'soon', input_per_mtok: 1, output_per_mtok: 2}]}}).join(), /price change/);
});

test('selectModels checks every entry, then limits to the names asked for', () => {
  const file = {models: [good, {...good, name: 'flash', provider: 'gemini', id: 'gemini-x', temperature: 0}]};
  assert.equal(selectModels(file).length, 2);
  assert.deepEqual(selectModels(file, 'flash').map((m) => m.name), ['flash']);
  assert.throws(() => selectModels(file, 'flash,nano'), /Unknown model names: nano/);
  assert.throws(() => selectModels({models: [good, good]}), /used twice/);
  assert.throws(() => selectModels({models: [{...good, price: {}}]}), /input_per_mtok/);
  assert.throws(() => selectModels({}), /no "models" list/);
});

test('both shipped models files pass the checks', async () => {
  for (const name of ['models.json', 'models-cheap.json']) {
    const file = JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
    assert.ok(selectModels(file).length >= 5, name);
  }
});
