import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kcalSpread, repeatReport, repeatRuns} from '../lib/repeat.mjs';
import {EVERYDAY_SMALL} from '../lib/score.mjs';

const usda = (energy_kcal) => ({energy_kcal, protein_g: 1, fat_g: 1, carbohydrate_g: 1, fiber_g: 0, sugars_g: 0, sodium_mg: 1});
const text = (kcal) => JSON.stringify({...usda(kcal)});
let clock = 0;
const rec = (fdc_id, kcal, extra = {}) => ({
  fdc_id,
  time: `2026-11-15T00:00:${String(clock++).padStart(2, '0')}Z`,
  settings: {temperature: 'default'},
  response_text: typeof kcal === 'number' ? text(kcal) : kcal,
  error: null,
  ...extra,
});

test('kcalSpread: max over min, the everyday energy rule, zero and too few answers', () => {
  assert.equal(kcalSpread([100, 105, 110], 100).spread_pct, 10);
  assert.ok(Math.abs(kcalSpread([90, 100], 100).spread_pct - 11.111111) < 1e-5);
  // A cup of coffee: USDA 2.4 kcal, answers 2 and 5 are within 5 kcal, so they agree.
  assert.deepEqual(kcalSpread([2, 5], 2.4, EVERYDAY_SMALL.kcal), {min: 2, max: 5, spread_pct: 0, small: true});
  assert.equal(kcalSpread([2, 9], 2.4, EVERYDAY_SMALL.kcal).spread_pct, 350);
  assert.equal(kcalSpread([0, 3], 50).spread_pct, Infinity);
  assert.equal(kcalSpread([0, 0], 50).spread_pct, 0);
  assert.equal(kcalSpread([100], 100), null);
});

test('repeatRuns: the scored answer first, then default-temperature repeat answers, oldest first, at most n', () => {
  clock = 0;
  const foods = [{fdc_id: 1}, {fdc_id: 2}];
  const main = [rec(2, 80, {settings: {temperature: 0}}), rec(1, 100)];
  const repeats = [
    rec(1, 101, {run: 2}),
    rec(1, 0, {run: 3, error: 'HTTP 500', response_text: null}),
    rec(2, 81, {settings: {temperature: 0}}), // not a repeat-run answer
    rec(1, 102, {run: 3}),
    rec(1, 103, {run: 4}),
    rec(9, 1),
  ];
  const runs = repeatRuns(foods, main, repeats, 3);
  const kcal = (id) => runs.get(id).map((r) => JSON.parse(r.response_text).energy_kcal);
  assert.deepEqual(kcal(1), [100, 101, 102]);
  assert.deepEqual(kcal(2), [80]); // the scored answer at temperature 0 is run 1
  assert.equal(runs.has(9), false);
});

test('repeatReport: share that differ by more than 10%, median spread, widest item, accuracy over all runs', () => {
  clock = 0;
  const foods = [
    {fdc_id: 1, phrase: 'a banana', usda: usda(105)},
    {fdc_id: 2, phrase: 'a slice of bacon', usda: usda(54)},
    {fdc_id: 3, phrase: 'a cup of coffee', usda: usda(2.4)},
    {fdc_id: 4, phrase: 'an egg', usda: usda(72)},
  ];
  const records = [
    ...[105, 105, 106].map((k) => rec(1, k)), // spread 1%, all within ±10%
    ...[43, 54, 54].map((k) => rec(2, k)), // spread 25.6%: differs
    ...[2, 0, 5].map((k) => rec(3, k)), // under 10 kcal, within 5 kcal of each other: agree
    rec(4, 72), rec(4, "I'm sorry, I can't help."), // one calorie answer: not compared
  ];
  const report = repeatReport(foods, repeatRuns(foods, [], records, 3), {n: 3, small: EVERYDAY_SMALL});
  assert.equal(report.foods_compared, 3);
  assert.equal(report.foods_with_all_runs, 3);
  assert.equal(report.differ_over_10_pct, 1);
  assert.equal(report.differ_over_10_pct_share, 0.3333);
  assert.equal(report.median_spread_pct, 1); // spreads 0.95, 25.6, 0
  assert.deepEqual(report.widest, {phrase: 'a slice of bacon', kcal: [43, 54, 54], usda_kcal: 54, spread_pct: 25.6, spread_infinite: false});
  assert.equal(report.answers, 11);
  assert.equal(report.answers_without_kcal, 1);
  // Within ±10% of USDA: 3 banana, 2 bacon, 3 coffee (within 5 kcal), 1 egg = 9 of 11.
  assert.equal(report.kcal_within_10_of_usda_share, 0.8182);
  const egg = report.items.find((i) => i.fdc_id === 4);
  assert.deepEqual([egg.runs, egg.kcal, egg.differs], [2, [72], null]);
});
