// Everyday questions: a phrase a person would type ("a medium banana"), the one SR Legacy food it
// means, and one of SR's household portions. USDA's answer is the per-100 g value times the
// portion's grams / 100.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {csvRecords} from './csv.mjs';
import {NUTRIENTS, pickNutrients, readSrLegacyCsv} from './usda.mjs';

export const MIN_FOOD_GROUPS = 12;

/** SR Legacy food_portion.csv rows by fdc_id. The household measure is amount + modifier. */
export function readSrPortions(text) {
  const byFood = new Map();
  for (const r of csvRecords(text)) {
    const fdcId = Number(r.fdc_id);
    if (!byFood.has(fdcId)) byFood.set(fdcId, []);
    byFood.get(fdcId).push({id: Number(r.id), amount: Number(r.amount), modifier: r.modifier, gram_weight: Number(r.gram_weight)});
  }
  return byFood;
}

/** SR Legacy foods (with their nutrient amounts) and portions from data/, per the manifest. */
export async function loadSrLegacy(dataDir, manifest) {
  const sr = manifest.datasets.find((d) => d.dataset === 'sr_legacy');
  const dir = join(dataDir, sr.dir);
  const read = (f) => readFile(join(dir, f), 'utf8');
  const foods = readSrLegacyCsv({food: await read('food.csv'), foodCategory: await read('food_category.csv'), foodNutrient: await read('food_nutrient.csv')});
  return {foods, portions: readSrPortions(await read('food_portion.csv'))};
}

/** Per-100 g values scaled to a portion, rounded to 3 decimals. */
export function portionValues(per100g, grams) {
  const out = {};
  for (const n of NUTRIENTS) out[n.key] = Math.round(((per100g[n.key] * grams) / 100) * 1000) / 1000;
  return out;
}

/**
 * Fills in every derived field of the hand-written items ({phrase, fdc_id, portion: {id}}):
 * the SR description and category, the whole portion row, the grams, the per-100 g values and
 * the portion values. Throws on an unknown food or a portion row of another food.
 */
export function buildItems(items, {foods, portions}) {
  const byId = new Map(foods.map((f) => [f.fdc_id, f]));
  return items.map((item) => {
    const food = byId.get(item.fdc_id);
    if (!food) throw new Error(`${item.phrase}: no SR Legacy food ${item.fdc_id}`);
    const row = (portions.get(item.fdc_id) || []).find((p) => p.id === item.portion.id);
    if (!row) throw new Error(`${item.phrase}: portion ${item.portion.id} is not a portion of ${item.fdc_id}`);
    const picked = pickNutrients(food.amounts);
    if (!picked) throw new Error(`${item.phrase}: ${item.fdc_id} lacks one of the seven nutrients`);
    return {
      phrase: item.phrase,
      fdc_id: item.fdc_id,
      sr_description: food.description,
      category: food.category,
      portion: row,
      grams: row.gram_weight,
      per_100g: picked.values,
      usda: portionValues(picked.values, row.gram_weight),
    };
  });
}

/** Every problem with a finished item list, checked against the SR data; [] when it is sound. */
export function validateItems(items, {foods, portions}, {minGroups = MIN_FOOD_GROUPS} = {}) {
  const problems = [];
  const byId = new Map(foods.map((f) => [f.fdc_id, f]));
  const seenFoods = new Set();
  const seenPhrases = new Set();
  for (const item of items) {
    const where = item.phrase || `fdc_id ${item.fdc_id}`;
    if (seenFoods.has(item.fdc_id)) problems.push(`${where}: fdc_id ${item.fdc_id} is used twice`);
    if (seenPhrases.has(item.phrase)) problems.push(`${where}: the phrase is used twice`);
    seenFoods.add(item.fdc_id);
    seenPhrases.add(item.phrase);
    const food = byId.get(item.fdc_id);
    if (!food) {
      problems.push(`${where}: no SR Legacy food ${item.fdc_id}`);
      continue;
    }
    if (item.sr_description !== food.description) problems.push(`${where}: sr_description differs from SR's "${food.description}"`);
    if (item.category !== food.category) problems.push(`${where}: category differs from SR's "${food.category}"`);
    const row = (portions.get(item.fdc_id) || []).find((p) => p.id === item.portion?.id);
    if (!row) {
      problems.push(`${where}: portion ${item.portion?.id} is not a portion of ${item.fdc_id}`);
      continue;
    }
    for (const k of ['amount', 'modifier', 'gram_weight']) {
      if (item.portion[k] !== row[k]) problems.push(`${where}: portion ${k} ${JSON.stringify(item.portion[k])} differs from SR's ${JSON.stringify(row[k])}`);
    }
    if (item.grams !== row.gram_weight) problems.push(`${where}: grams ${item.grams} differ from the portion's ${row.gram_weight} g`);
    const picked = pickNutrients(food.amounts);
    if (!picked) {
      problems.push(`${where}: SR lacks one of the seven nutrients`);
      continue;
    }
    const expected = portionValues(picked.values, row.gram_weight);
    for (const n of NUTRIENTS) {
      if (item.per_100g?.[n.key] !== picked.values[n.key]) problems.push(`${where}: per_100g.${n.key} differs from SR`);
      if (item.usda?.[n.key] !== expected[n.key]) problems.push(`${where}: usda.${n.key} is not per_100g × grams / 100`);
    }
  }
  const groups = new Set(items.map((i) => i.category));
  if (groups.size < minGroups) problems.push(`only ${groups.size} food groups, at least ${minGroups} wanted`);
  return problems;
}
