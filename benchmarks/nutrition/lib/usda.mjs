// Reads the two FoodData Central releases and decides which foods can be asked about.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {csvRecords} from './csv.mjs';

// The seven measured nutrients and the FoodData Central nutrient ids behind each, in order of
// preference. Checked against nutrient.csv (SR Legacy) and the nutrient objects in the
// Foundation Foods JSON on 2026-11-13:
//   1008 Energy KCAL; 2048 Energy (Atwater Specific Factors) KCAL; 2047 Energy (Atwater General
//   Factors) KCAL; 1003 Protein G; 1004 Total lipid (fat) G; 1005 Carbohydrate, by difference G;
//   1079 Fiber, total dietary G; 2000 Sugars, Total G (SR) / Total Sugars G (Foundation);
//   1063 Sugars, Total NLEA G (SR) / Sugars, Total G (Foundation); 1093 Sodium, Na MG.
// Foundation Foods often has only the Atwater energy ids and 1063 for sugars; SR Legacy always
// has 1008 and uses 2000.
export const NUTRIENTS = [
  {key: 'energy_kcal', ids: [1008, 2048, 2047], unit: 'kcal'},
  {key: 'protein_g', ids: [1003], unit: 'g'},
  {key: 'fat_g', ids: [1004], unit: 'g'},
  {key: 'carbohydrate_g', ids: [1005], unit: 'g'},
  {key: 'fiber_g', ids: [1079], unit: 'g'},
  {key: 'sugars_g', ids: [2000, 1063], unit: 'g'},
  {key: 'sodium_mg', ids: [1093], unit: 'mg'},
];
export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);

export const EXCLUDED_CATEGORIES = [
  'Baby Foods',
  'Restaurant Foods',
  'Fast Foods',
  'American Indian/Alaska Native Foods',
  'Meals, Entrees, and Side Dishes',
];

// A word of three or more capital letters marks a brand in SR Legacy ("Cereals ready-to-eat,
// KELLOGG'S ..."). USDA is the one such word that is not a brand: "(Includes foods for USDA's
// Food Distribution Program)" and grades like "USDA choice".
export const NOT_BRANDS = ['USDA'];
// Brands SR Legacy writes in mixed case, which the capitals rule misses. Found by reading every
// remaining description with a capitalised word after the first (2026-11-13).
export const MIXED_CASE_BRANDS = [
  "Andrea's", 'Archway', 'Continental Mills', 'Creamsicle', 'Crunchmaster', 'Gamesa', 'George Weston',
  'Glutino', 'Goya', 'Heinz', 'Hormel', 'Interstate Brands', 'Kraft', 'La Moderna', 'La Ricura',
  'Martha White', "Mary's Gone", 'Mckee Baking', 'Mission Foods', 'Monster', 'Muscle Milk', 'Nabisco',
  'Natreon', 'Oscar Mayer', 'Pepperidge Farm', 'Pillsbury', 'Post', 'Powerade', 'Propel', 'Ready Crust',
  'Reddi Wip', "Rudi's", 'Sage Valley', 'Schar', 'Spam', "Udi's", "Van's", 'Vitasoy',
];
const mixedCaseBrand = new RegExp(`(^|[^A-Za-z'])(${MIXED_CASE_BRANDS.map(escapeRegExp).join('|')})(?![A-Za-z])`);

/** True when a description names a brand. */
export function isBranded(description) {
  const capitals = description.match(/[A-Z]{3,}/g) || [];
  if (capitals.some((w) => !NOT_BRANDS.includes(w))) return true;
  return mixedCaseBrand.test(description);
}

/**
 * Picks the seven values from a map of nutrient id to amount (per 100 g), with the fallbacks.
 * Returns {values, ids} or null when any nutrient is missing.
 */
export function pickNutrients(amounts) {
  const values = {};
  const ids = {};
  for (const n of NUTRIENTS) {
    const id = n.ids.find((i) => Number.isFinite(amounts.get(i)));
    if (id === undefined) return null;
    values[n.key] = amounts.get(id);
    ids[n.key] = id;
  }
  return {values, ids};
}

const WANTED = new Set(NUTRIENTS.flatMap((n) => n.ids));

/** Foundation Foods from the JSON release. */
export function readFoundationJson(text) {
  const foods = [];
  for (const f of JSON.parse(text).FoundationFoods) {
    if (f.dataType !== 'Foundation') continue;
    const amounts = new Map();
    for (const fn of f.foodNutrients || []) {
      const id = fn.nutrient?.id;
      if (WANTED.has(id) && typeof fn.amount === 'number') amounts.set(id, fn.amount);
    }
    foods.push({
      fdc_id: f.fdcId,
      dataset: 'foundation',
      description: f.description,
      category: f.foodCategory?.description ?? '',
      amounts,
    });
  }
  return foods;
}

/** SR Legacy from its CSV files: food.csv, food_category.csv and food_nutrient.csv texts. */
export function readSrLegacyCsv({food, foodCategory, foodNutrient}) {
  const categories = new Map();
  for (const r of csvRecords(foodCategory)) categories.set(r.id, r.description);
  const amountsByFood = new Map();
  for (const r of csvRecords(foodNutrient)) {
    const id = Number(r.nutrient_id);
    if (!WANTED.has(id) || r.amount === '') continue;
    const amount = Number(r.amount);
    if (!Number.isFinite(amount)) continue;
    if (!amountsByFood.has(r.fdc_id)) amountsByFood.set(r.fdc_id, new Map());
    amountsByFood.get(r.fdc_id).set(id, amount);
  }
  const foods = [];
  for (const r of csvRecords(food)) {
    if (r.data_type !== 'sr_legacy_food') continue;
    foods.push({
      fdc_id: Number(r.fdc_id),
      dataset: 'sr_legacy',
      description: r.description,
      category: categories.get(r.food_category_id) ?? '',
      amounts: amountsByFood.get(r.fdc_id) ?? new Map(),
    });
  }
  return foods;
}

/** Reads both releases from data/, using the paths in the manifest. */
export async function loadUsda(dataDir, manifest) {
  const byName = Object.fromEntries(manifest.datasets.map((d) => [d.dataset, d]));
  const ff = byName.foundation;
  const sr = byName.sr_legacy;
  const foundation = readFoundationJson(await readFile(join(dataDir, ff.dir, ff.files[0].file), 'utf8'));
  const srDir = join(dataDir, sr.dir);
  const srLegacy = readSrLegacyCsv({
    food: await readFile(join(srDir, 'food.csv'), 'utf8'),
    foodCategory: await readFile(join(srDir, 'food_category.csv'), 'utf8'),
    foodNutrient: await readFile(join(srDir, 'food_nutrient.csv'), 'utf8'),
  });
  return [...foundation, ...srLegacy];
}

/**
 * Applies the rules in order and counts what each one removed. Returns the eligible foods
 * (with their seven values) and the counts.
 */
export function eligibleFoods(foods) {
  const counts = {read: foods.length, excluded_category: 0, branded: 0, missing_nutrient: 0, duplicate_description: 0};
  const byCategory = {};
  const kept = [];
  for (const f of foods) {
    if (EXCLUDED_CATEGORIES.includes(f.category)) {
      counts.excluded_category++;
      byCategory[f.category] = (byCategory[f.category] || 0) + 1;
      continue;
    }
    if (isBranded(f.description)) {
      counts.branded++;
      continue;
    }
    const picked = pickNutrients(f.amounts);
    if (!picked) {
      counts.missing_nutrient++;
      continue;
    }
    kept.push({fdc_id: f.fdc_id, dataset: f.dataset, description: f.description, category: f.category, usda: picked.values, nutrient_ids: picked.ids});
  }
  // The same description in both releases: keep Foundation Foods, the newer analysis.
  kept.sort((a, b) => (a.dataset === b.dataset ? a.fdc_id - b.fdc_id : a.dataset === 'foundation' ? -1 : 1));
  const seen = new Set();
  const unique = [];
  for (const f of kept) {
    const key = f.description.trim().toLowerCase();
    if (seen.has(key)) {
      counts.duplicate_description++;
      continue;
    }
    seen.add(key);
    unique.push(f);
  }
  counts.eligible = unique.length;
  counts.excluded_by_category = byCategory;
  return {foods: unique, counts};
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
