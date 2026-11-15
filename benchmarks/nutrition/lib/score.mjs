// The scoring rules of decision 5, fixed before the run.
import {NUTRIENTS} from './usda.mjs';
import {parseAnswer} from './parse.mjs';

// Small values: under 1 g (10 mg for sodium) an answer within 0.5 g (5 mg) counts as within.
// Energy has no small-value rule in the USDA-description set.
export const SMALL = {g: {below: 1, within: 0.5}, mg: {below: 10, within: 5}};
// The everyday set adds one for energy: under 10 kcal, within 5 kcal counts (a cup of coffee).
export const EVERYDAY_SMALL = {...SMALL, kcal: {below: 10, within: 5}};
const EPSILON = 1e-9;

/**
 * Scores one value. `ape` is the absolute percentage error, Infinity when USDA says 0 and the
 * answer does not. A small USDA value answered within the absolute tolerance scores 0% and
 * counts as within ±10% and ±20%.
 */
export function scoreValue(usda, answer, unit, rules = SMALL) {
  const small = rules[unit];
  if (small && usda < small.below && Math.abs(answer - usda) <= small.within + EPSILON) {
    return {ape: 0, within10: true, within20: true, small: true};
  }
  const ape = usda === 0 ? (answer === 0 ? 0 : Infinity) : (Math.abs(answer - usda) / Math.abs(usda)) * 100;
  return {ape, within10: ape <= 10 + EPSILON, within20: ape <= 20 + EPSILON, small: false};
}

export function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The latest record per food: a record with an answer wins over an API error. Records of foods
 * not in `foods` are ignored.
 */
export function latestByFood(records, foods) {
  const wanted = new Set(foods.map((f) => f.fdc_id));
  const byFood = new Map();
  for (const r of records) {
    if (!wanted.has(r.fdc_id)) continue;
    const prev = byFood.get(r.fdc_id);
    if (!prev || prev.error || !r.error) byFood.set(r.fdc_id, r);
  }
  return byFood;
}

/**
 * Scores one model over `foods` from its raw records. Shares within ±10% / ±20% are over every
 * food asked, so a miss counts against the model; the median error is over the answered values.
 */
export function scoreModel(foods, records, {small = SMALL} = {}) {
  const byFood = latestByFood(records, foods);
  const asked = foods.filter((f) => byFood.has(f.fdc_id));
  const misses = {api_error: 0, empty: 0, refusal: 0, no_json: 0};
  const parsed = new Map();
  for (const f of asked) {
    const r = byFood.get(f.fdc_id);
    const p = r.error ? {values: {}, missing: NUTRIENTS.map((n) => n.key), error: 'api_error'} : parseAnswer(r.response_text);
    if (p.error) misses[p.error]++;
    parsed.set(f.fdc_id, p);
  }
  const nutrients = {};
  for (const n of NUTRIENTS) {
    const apes = [];
    let w10 = 0;
    let w20 = 0;
    let missingKey = 0;
    let smallApplied = 0;
    for (const f of asked) {
      const p = parsed.get(f.fdc_id);
      if (!p.error && !(n.key in p.values)) missingKey++;
      if (!(n.key in p.values)) continue;
      const s = scoreValue(f.usda[n.key], p.values[n.key], n.unit, small);
      apes.push(s.ape);
      if (s.within10) w10++;
      if (s.within20) w20++;
      if (s.small) smallApplied++;
    }
    const m = median(apes);
    nutrients[n.key] = {
      foods: asked.length,
      answered: apes.length,
      misses: asked.length - apes.length,
      missing_key: missingKey,
      median_ape_pct: m === null || !Number.isFinite(m) ? null : round(m, 2),
      median_ape_infinite: m === Infinity,
      within_10: w10,
      within_20: w20,
      within_10_share: asked.length ? round(w10 / asked.length, 4) : null,
      within_20_share: asked.length ? round(w20 / asked.length, 4) : null,
      small_value_rule_applied: smallApplied,
    };
  }
  const fullyParsed = asked.filter((f) => {
    const p = parsed.get(f.fdc_id);
    return !p.error && p.missing.length === 0;
  }).length;
  return {
    foods: foods.length,
    asked: asked.length,
    not_asked: foods.length - asked.length,
    fully_parsed: fullyParsed,
    misses,
    headline_calories_within_10_share: nutrients.energy_kcal.within_10_share,
    nutrients,
  };
}

export function round(x, digits) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
