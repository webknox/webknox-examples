import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildPrompt} from '../lib/ask.mjs';
import {MIN_FOOD_GROUPS, buildItems, loadSrLegacy, portionValues, readSrPortions, validateItems} from '../lib/everyday.mjs';
import {EVERYDAY_SMALL, SMALL, scoreValue} from '../lib/score.mjs';
import {readSrLegacyCsv} from '../lib/usda.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const sr = {
  foods: readSrLegacyCsv({food: fixture('food.csv'), foodCategory: fixture('food_category.csv'), foodNutrient: fixture('food_nutrient.csv')}),
  portions: readSrPortions(fixture('food_portion.csv')),
};
const spec = [
  {phrase: 'a cup of diced sharp cheddar', fdc_id: 1, portion: {id: 2}},
  {phrase: 'a cup of chopped raw kale', fdc_id: 8, portion: {id: 3}},
];

test('portion values are the per-100 g values × grams / 100', () => {
  const per100 = {energy_kcal: 89, protein_g: 1.09, fat_g: 0.33, carbohydrate_g: 22.84, fiber_g: 2.6, sugars_g: 12.23, sodium_mg: 1};
  assert.deepEqual(portionValues(per100, 118), {energy_kcal: 105.02, protein_g: 1.286, fat_g: 0.389, carbohydrate_g: 26.951, fiber_g: 3.068, sugars_g: 14.431, sodium_mg: 1.18});
  assert.deepEqual(portionValues(per100, 100), per100);
  assert.equal(portionValues({...per100, energy_kcal: 1}, 237).energy_kcal, 2.37);
});

test('SR portions: the household measure is amount + modifier, with its gram weight', () => {
  assert.deepEqual(sr.portions.get(5), [{id: 4, amount: 1, modifier: 'medium (3" dia)', gram_weight: 182}]);
  assert.equal(sr.portions.get(1).length, 2);
});

test('items are filled in from the SR food and portion row', () => {
  const [cheese] = buildItems(spec, sr);
  assert.deepEqual(cheese, {
    phrase: 'a cup of diced sharp cheddar',
    fdc_id: 1,
    sr_description: 'Cheese, cheddar, sharp, sliced',
    category: 'Dairy and Egg Products',
    portion: {id: 2, amount: 1, modifier: 'cup, diced', gram_weight: 132},
    grams: 132,
    per_100g: {energy_kcal: 400, protein_g: 25, fat_g: 33, carbohydrate_g: 1.3, fiber_g: 0, sugars_g: 0.3, sodium_mg: 650},
    usda: {energy_kcal: 528, protein_g: 33, fat_g: 43.56, carbohydrate_g: 1.716, fiber_g: 0, sugars_g: 0.396, sodium_mg: 858},
  });
  assert.throws(() => buildItems([{phrase: 'x', fdc_id: 404, portion: {id: 2}}], sr), /no SR Legacy food 404/);
  assert.throws(() => buildItems([{phrase: 'x', fdc_id: 1, portion: {id: 3}}], sr), /portion 3 is not a portion of 1/);
  assert.throws(() => buildItems([{phrase: 'x', fdc_id: 6, portion: {id: 1}}], sr), /portion 1 is not a portion of 6/);
});

test('validation finds a wrong food, portion row, gram weight or answer key', () => {
  const items = buildItems(spec, sr);
  assert.deepEqual(validateItems(items, sr, {minGroups: 2}), []);
  const broken = (change) => {
    const copy = structuredClone(items);
    change(copy[0]);
    return validateItems(copy, sr, {minGroups: 2});
  };
  assert.match(broken((i) => (i.grams = 130)).join(), /grams 130 differ from the portion's 132 g/);
  assert.match(broken((i) => (i.portion.gram_weight = 130)).join(), /portion gram_weight 130 differs from SR's 132/);
  assert.match(broken((i) => (i.portion.modifier = 'cup')).join(), /portion modifier "cup" differs/);
  assert.match(broken((i) => (i.portion.id = 3)).join(), /portion 3 is not a portion of 1/);
  assert.match(broken((i) => (i.fdc_id = 404)).join(), /no SR Legacy food 404/);
  assert.match(broken((i) => (i.sr_description = 'Cheese')).join(), /sr_description differs/);
  assert.match(broken((i) => (i.usda.energy_kcal = 500)).join(), /usda.energy_kcal is not per_100g × grams \/ 100/);
  assert.match(broken((i) => (i.per_100g.fat_g = 30)).join(), /per_100g.fat_g differs from SR/);
  assert.match(validateItems([items[0], items[0]], sr, {minGroups: 1}).join(), /used twice/);
  assert.match(validateItems(items, sr).join(), /only 2 food groups, at least 12 wanted/);
});

test('energy rule for the everyday set: under 10 kcal, within 5 kcal counts', () => {
  assert.equal(scoreValue(2.37, 5, 'kcal', EVERYDAY_SMALL).within10, true);
  assert.equal(scoreValue(2.37, 5, 'kcal', EVERYDAY_SMALL).ape, 0);
  assert.equal(scoreValue(2.37, 10, 'kcal', EVERYDAY_SMALL).within20, false);
  assert.equal(scoreValue(12, 16, 'kcal', EVERYDAY_SMALL).small, false);
  assert.equal(scoreValue(2.37, 5, 'kcal', SMALL).within20, false); // not in the USDA-description set
  assert.equal(scoreValue(0.3, 0.7, 'g', EVERYDAY_SMALL).within10, true); // the gram rule still holds
});

test('the everyday prompt takes the phrase as written', () => {
  const template = readFileSync(new URL('../prompt-everyday.txt', import.meta.url), 'utf8');
  const prompt = buildPrompt(template, 'a medium banana');
  assert.match(prompt, /are in a medium banana\? Give the amounts for that portion, not per 100 g\./);
  assert.doesNotMatch(prompt, /USDA|\{phrase\}/);
  assert.equal(buildPrompt('in {phrase}.', 'a $& cup'), 'in a $& cup.');
});

// Checks the published list against the real USDA files when they are downloaded.
const root = fileURLToPath(new URL('..', import.meta.url));
const haveData = existsSync(`${root}data/sr_legacy`);
test('everyday.json: every fdc_id and portion row exists in SR Legacy, and the grams match', {skip: !haveData && 'run node bench.mjs fetch-usda first'}, async () => {
  const manifest = JSON.parse(readFileSync(`${root}usda-manifest.json`, 'utf8'));
  const data = await loadSrLegacy(`${root}data`, manifest);
  const {items} = JSON.parse(readFileSync(`${root}everyday.json`, 'utf8'));
  assert.equal(items.length, 20);
  assert.deepEqual(validateItems(items, data), []);
  assert.ok(new Set(items.map((i) => i.category)).size >= MIN_FOOD_GROUPS);
  assert.deepEqual(buildItems(items, data), items);
});
