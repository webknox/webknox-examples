import assert from 'node:assert/strict';
import {test} from 'node:test';
import {allocate, rng, shuffle, stratifiedSample} from '../lib/sample.mjs';

const pool = [];
const sizes = {Beef: 60, Vegetables: 30, Spices: 10};
let id = 1;
for (const [category, n] of Object.entries(sizes)) {
  for (let i = 0; i < n; i++) pool.push({fdc_id: id++, dataset: 'sr_legacy', category, description: `${category} ${i}`});
}

test('the generator is deterministic per seed', () => {
  const a = rng(42);
  const b = rng(42);
  const c = rng(43);
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], rng(7)), shuffle([1, 2, 3, 4, 5], rng(7)));
});

test('allocation is proportional with largest remainders and sums to the total', () => {
  assert.deepEqual(allocate(sizes, 10), {Beef: 6, Spices: 1, Vegetables: 3});
  assert.deepEqual(allocate({A: 1, B: 1, C: 1}, 2), {A: 1, B: 1, C: 0});
  assert.deepEqual(allocate({A: 2, B: 3}, 50), {A: 2, B: 3});
  const big = allocate({A: 7, B: 13, C: 29, D: 51}, 37);
  assert.equal(Object.values(big).reduce((s, v) => s + v, 0), 37);
});

test('the same pool and seed give the same ordered sample, whatever the input order', () => {
  const one = stratifiedSample(pool, 20, 20261113).foods.map((f) => f.fdc_id);
  const two = stratifiedSample(pool.slice().reverse(), 20, 20261113).foods.map((f) => f.fdc_id);
  const other = stratifiedSample(pool, 20, 1).foods.map((f) => f.fdc_id);
  assert.deepEqual(one, two);
  assert.notDeepEqual(one, other);
  assert.equal(new Set(one).size, 20);
});

test('the sample keeps the category shares, and so does its prefix', () => {
  const {foods, allocation} = stratifiedSample(pool, 50, 20261113);
  assert.deepEqual(allocation, {Beef: 30, Spices: 5, Vegetables: 15});
  const prefix = {};
  for (const f of foods.slice(0, 10)) prefix[f.category] = (prefix[f.category] || 0) + 1;
  assert.ok(prefix.Beef >= 5 && prefix.Beef <= 7, JSON.stringify(prefix));
  assert.ok(prefix.Vegetables >= 2 && prefix.Vegetables <= 4, JSON.stringify(prefix));
  assert.ok(prefix.Spices >= 0 && prefix.Spices <= 2, JSON.stringify(prefix));
});
