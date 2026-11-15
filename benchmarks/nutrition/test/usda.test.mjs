import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {eligibleFoods, isBranded, pickNutrients, readFoundationJson, readSrLegacyCsv} from '../lib/usda.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const base = [[1003, 1], [1004, 1], [1005, 1], [1079, 1], [1093, 1]];

test('energy falls back from 1008 to 2048 to 2047', () => {
  const pick = (energy) => pickNutrients(new Map([...base, [2000, 1], ...energy]));
  assert.equal(pick([[1008, 100], [2048, 90], [2047, 80]]).values.energy_kcal, 100);
  assert.equal(pick([[2048, 90], [2047, 80]]).values.energy_kcal, 90);
  assert.equal(pick([[2047, 80]]).ids.energy_kcal, 2047);
  assert.equal(pick([]), null);
});

test('sugars fall back from 2000 to 1063, and zero counts as a value', () => {
  const pick = (sugars) => pickNutrients(new Map([...base, [1008, 50], ...sugars]));
  assert.equal(pick([[2000, 3], [1063, 4]]).values.sugars_g, 3);
  assert.deepEqual([pick([[1063, 4]]).values.sugars_g, pick([[1063, 4]]).ids.sugars_g], [4, 1063]);
  assert.equal(pick([[2000, 0]]).values.sugars_g, 0);
  assert.equal(pick([]), null);
});

test('Foundation Foods JSON: the Atwater ids and 1063 are used when 1008 and 2000 are absent', () => {
  const foods = readFoundationJson(fixture('foundation.json'));
  const kale = pickNutrients(foods[0].amounts);
  assert.deepEqual(kale.ids, {energy_kcal: 2048, protein_g: 1003, fat_g: 1004, carbohydrate_g: 1005, fiber_g: 1079, sugars_g: 1063, sodium_mg: 1093});
  assert.equal(kale.values.energy_kcal, 37);
  const lentils = pickNutrients(foods[1].amounts);
  assert.equal(lentils.ids.energy_kcal, 2047);
  assert.equal(lentils.values.sugars_g, 2);
  assert.equal(pickNutrients(foods[2].amounts), null);
});

test('brand rule: capitals words except USDA, plus mixed-case brands', () => {
  assert.equal(isBranded("Cereals ready-to-eat, KELLOGG'S, CORN FLAKES"), true);
  assert.equal(isBranded("Apples, raw, gala (Includes foods for USDA's Food Distribution Program)"), false);
  assert.equal(isBranded('Beef, loin, USDA choice, raw'), false);
  assert.equal(isBranded('Pillsbury, Cinnamon Rolls with Icing, refrigerated dough'), true);
  assert.equal(isBranded('Cereals ready-to-eat, Post, Waffle Crisp'), true);
  assert.equal(isBranded('Beverages, Postum, instant coffee substitute'), false);
  assert.equal(isBranded("Udi's, Gluten Free, Whole Grain Dinner Rolls"), true);
  assert.equal(isBranded('Kale, raw'), false);
});

test('eligibility: categories, brands, missing nutrients and duplicates are removed and counted', () => {
  const sr = readSrLegacyCsv({food: fixture('food.csv'), foodCategory: fixture('food_category.csv'), foodNutrient: fixture('food_nutrient.csv')});
  const ff = readFoundationJson(fixture('foundation.json'));
  const {foods, counts} = eligibleFoods([...sr, ...ff]);
  assert.deepEqual(
    foods.map((f) => `${f.dataset}:${f.fdc_id}`),
    ['foundation:100', 'foundation:101', 'sr_legacy:1', 'sr_legacy:4', 'sr_legacy:5'],
  );
  assert.deepEqual(
    {...counts, excluded_by_category: undefined},
    {read: 11, excluded_category: 1, branded: 2, missing_nutrient: 2, duplicate_description: 1, eligible: 5, excluded_by_category: undefined},
  );
  assert.deepEqual(counts.excluded_by_category, {'Baby Foods': 1});
  const cheese = foods.find((f) => f.fdc_id === 1);
  assert.deepEqual(cheese.usda, {energy_kcal: 400, protein_g: 25, fat_g: 33, carbohydrate_g: 1.3, fiber_g: 0, sugars_g: 0.3, sodium_mg: 650});
  assert.equal(cheese.category, 'Dairy and Egg Products');
});
