import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseAnswer, toNumber} from '../lib/parse.mjs';

const full = {energy_kcal: 34, protein_g: 2.82, fat_g: 0.37, carbohydrate_g: 6.64, fiber_g: 2.6, sugars_g: 1.7, sodium_mg: 33};

test('bare JSON', () => {
  assert.deepEqual(parseAnswer(JSON.stringify(full)), {values: full, missing: [], error: null});
});

test('JSON in a ```json fence, with text around it', () => {
  const text = `Here are the values:\n\n\`\`\`json\n${JSON.stringify(full, null, 2)}\n\`\`\`\nThese are approximate.`;
  assert.deepEqual(parseAnswer(text).values, full);
});

test('JSON after extra text, without a fence', () => {
  assert.deepEqual(parseAnswer(`Sure! {"energy_kcal": 34, "protein_g": 2.82, "fat_g": 0.37, "carbohydrate_g": 6.64, "fiber_g": 2.6, "sugars_g": 1.7, "sodium_mg": 33} Hope this helps.`).values, full);
});

test('numbers given as strings, with units or thousands separators', () => {
  const p = parseAnswer('{"energy_kcal": "34", "protein_g": "2.82 g", "fat_g": " 0.37", "carbohydrate_g": 6.64, "fiber_g": "2.6g", "sugars_g": "1.7", "sodium_mg": "1,200 mg"}');
  assert.deepEqual(p.values, {...full, sodium_mg: 1200});
  assert.equal(toNumber('trace'), undefined);
  assert.equal(toNumber('<0.1'), undefined);
  assert.equal(toNumber('1.2.3'), undefined);
  assert.equal(toNumber(Number.NaN), undefined);
  assert.equal(toNumber('-1'), -1);
});

test('a missing key or a non-number is missing for that nutrient only', () => {
  const p = parseAnswer('{"energy_kcal": 34, "protein_g": 2.8, "fat_g": "trace", "carbohydrate_g": 6.6, "fiber_g": null, "sugars_g": 1.7}');
  assert.equal(p.error, null);
  assert.deepEqual(p.missing, ['fat_g', 'fiber_g', 'sodium_mg']);
  assert.deepEqual(Object.keys(p.values), ['energy_kcal', 'protein_g', 'carbohydrate_g', 'sugars_g']);
});

test('reasoning in <think> tags is skipped, even when it holds braces', () => {
  const text = `<think>Maybe {"energy_kcal": 99} is wrong, let me think.</think>\n${JSON.stringify(full)}`;
  assert.deepEqual(parseAnswer(text).values, full);
});

test('braces inside strings do not break the object, and key case is ignored', () => {
  const p = parseAnswer('{"note": "a } brace", "Energy_kcal": 34, "PROTEIN_G": 2.82}');
  assert.equal(p.values.energy_kcal, 34);
  assert.equal(p.values.protein_g, 2.82);
});

test('an object without any of the keys is skipped for a later one', () => {
  assert.deepEqual(parseAnswer(`{"food": "broccoli"} ${JSON.stringify(full)}`).values, full);
});

test('refusals, prose and empty answers are misses with a reason', () => {
  assert.equal(parseAnswer("I'm sorry, I can't provide exact nutrition values.").error, 'refusal');
  assert.equal(parseAnswer('About 34 kcal and 2.8 g of protein.').error, 'no_json');
  assert.equal(parseAnswer('{"energy_kcal": 34,').error, 'no_json');
  assert.equal(parseAnswer('').error, 'empty');
  assert.equal(parseAnswer(null).error, 'empty');
  assert.equal(parseAnswer('[34, 2.8]').error, 'no_json');
});
