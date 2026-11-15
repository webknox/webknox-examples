import assert from 'node:assert/strict';
import {test} from 'node:test';
import {costOf, priceAt, totals} from '../lib/cost.mjs';
import {latestByFood, median, scoreModel, scoreValue} from '../lib/score.mjs';

test('percentage error and the ±10% / ±20% bands', () => {
  assert.deepEqual(scoreValue(100, 110, 'kcal'), {ape: 10, within10: true, within20: true, small: false});
  assert.deepEqual(scoreValue(100, 85, 'kcal'), {ape: 15, within10: false, within20: true, small: false});
  assert.equal(scoreValue(100, 121, 'kcal').within20, false);
  assert.equal(scoreValue(3, 3.3, 'g').within10, true); // 10.000000000000009 by floating point
  assert.equal(scoreValue(50, 25, 'g').ape, 50);
});

test('small values: under 1 g, within 0.5 g counts as within and as 0% error', () => {
  assert.deepEqual(scoreValue(0.3, 0.7, 'g'), {ape: 0, within10: true, within20: true, small: true});
  assert.deepEqual(scoreValue(0, 0.5, 'g'), {ape: 0, within10: true, within20: true, small: true});
  const far = scoreValue(0.3, 0.9, 'g');
  assert.equal(far.within20, false);
  assert.ok(Math.abs(far.ape - 200) < 1e-9);
  assert.equal(scoreValue(0, 2, 'g').ape, Infinity);
  assert.equal(scoreValue(1, 1.4, 'g').small, false); // 1 g is not under 1 g
  assert.equal(scoreValue(1, 1.4, 'g').within20, false);
});

test('small values: under 10 mg of sodium, within 5 mg counts', () => {
  assert.equal(scoreValue(8, 12, 'mg').within10, true);
  assert.equal(scoreValue(8, 14, 'mg').within20, false);
  assert.equal(scoreValue(0, 0, 'mg').ape, 0);
});

test('energy has no small-value rule', () => {
  assert.equal(scoreValue(0.5, 0.9, 'kcal').small, false);
  assert.ok(Math.abs(scoreValue(0.5, 0.9, 'kcal').ape - 80) < 1e-9);
});

test('median of odd and even counts, with Infinity', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([1, Infinity, 2]), 2);
  assert.equal(median([]), null);
});

const usda = {energy_kcal: 100, protein_g: 10, fat_g: 0.4, carbohydrate_g: 20, fiber_g: 0, sugars_g: 5, sodium_mg: 200};
const foods = [1, 2, 3, 4, 5].map((fdc_id) => ({fdc_id, usda}));
const answer = (o) => JSON.stringify({...usda, ...o});

test('misses count against the shares and are reported by kind', () => {
  const records = [
    {fdc_id: 1, response_text: answer({energy_kcal: 105})},
    {fdc_id: 2, response_text: answer({energy_kcal: 150, fat_g: 0.8})},
    {fdc_id: 3, response_text: "I'm sorry, I can't help with that."},
    {fdc_id: 4, response_text: '{"energy_kcal": 100}'},
    {fdc_id: 5, error: 'HTTP 500: overloaded', response_text: null},
    {fdc_id: 99, response_text: answer({})},
  ];
  const s = scoreModel(foods, records);
  assert.equal(s.asked, 5);
  assert.equal(s.fully_parsed, 2);
  assert.deepEqual(s.misses, {api_error: 1, empty: 0, refusal: 1, no_json: 0});
  const e = s.nutrients.energy_kcal;
  assert.deepEqual([e.answered, e.misses, e.missing_key, e.within_10, e.within_10_share], [3, 2, 0, 2, 0.4]);
  assert.equal(e.median_ape_pct, 5); // errors 5, 50, 0
  const p = s.nutrients.protein_g;
  assert.deepEqual([p.answered, p.missing_key, p.within_20_share], [2, 1, 0.4]);
  const fat = s.nutrients.fat_g;
  assert.equal(fat.small_value_rule_applied, 2); // 0.4 and 0.8 are both within 0.5 g of 0.4
  assert.equal(s.headline_calories_within_10_share, 0.4);
});

test('a food never asked is left out, and an answer beats an API error', () => {
  const records = [
    {fdc_id: 1, error: 'network: timeout'},
    {fdc_id: 1, response_text: answer({})},
    {fdc_id: 2, response_text: answer({})},
    {fdc_id: 2, error: 'HTTP 503'},
  ];
  const latest = latestByFood(records, foods);
  assert.equal(latest.get(1).error, undefined);
  assert.equal(latest.get(2).error, undefined);
  const s = scoreModel(foods, records);
  assert.deepEqual([s.asked, s.not_asked, s.nutrients.sodium_mg.within_10_share], [2, 3, 1]);
});

test('cost from usage and the price on the request date', () => {
  const price = {input_per_mtok: 2, output_per_mtok: 10, changes: [{from: '2026-12-01', input_per_mtok: 4, output_per_mtok: 20}]};
  assert.deepEqual(priceAt(price, '2026-11-30T23:59:59Z'), {input_per_mtok: 2, output_per_mtok: 10});
  assert.deepEqual(priceAt(price, '2026-12-01T00:00:00Z'), {input_per_mtok: 4, output_per_mtok: 20});
  assert.ok(Math.abs(costOf({input_tokens: 1000, output_tokens: 500}, price, '2026-11-13T00:00:00Z') - 0.007) < 1e-12);
  const t = totals(
    [
      {time: '2026-11-13T00:00:00Z', usage: {input_tokens: 100, output_tokens: 200, reasoning_tokens: 50}},
      {time: '2026-11-13T00:00:00Z', usage: null, error: 'HTTP 500'},
      {time: '2026-12-02T00:00:00Z', usage: {input_tokens: 100, output_tokens: 200, reasoning_tokens: null}},
    ],
    price,
  );
  assert.deepEqual(t, {calls: 2, input_tokens: 200, output_tokens: 400, reasoning_tokens: 50, reasoning_reported: true, cost_usd: 0.0066});
});
