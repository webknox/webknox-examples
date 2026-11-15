// The repeat check: the same everyday question asked several times, and how far apart the
// calorie answers land. The first answer is the scored run's; the others were asked at the
// provider's default temperature.
import {isDefaultTemperatureAnswer} from './ask.mjs';
import {parseAnswer} from './parse.mjs';
import {EVERYDAY_SMALL, latestByFood, median, round, scoreValue} from './score.mjs';

const EPSILON = 1e-9;
// Two answers "differ" when the larger is more than this many percent above the smaller.
export const SPREAD_THRESHOLD_PCT = 10;

/**
 * Up to `n` answers per food: the scored run's answer (the one scoreModel scores), then the
 * repeat runs' default-temperature answers, oldest first. Failed calls are left out.
 */
export function repeatRuns(foods, mainRecords, repeatRecords, n) {
  const scored = latestByFood(mainRecords, foods);
  const byFood = new Map(foods.map((f) => [f.fdc_id, []]));
  for (const f of foods) {
    const r = scored.get(f.fdc_id);
    if (r && !r.error && n > 0) byFood.get(f.fdc_id).push(r);
  }
  const repeats = repeatRecords.filter((r) => byFood.has(r.fdc_id) && isDefaultTemperatureAnswer(r));
  repeats.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  for (const r of repeats) {
    const list = byFood.get(r.fdc_id);
    if (list.length < n) list.push(r);
  }
  return byFood;
}

/**
 * How far apart a food's calorie answers are: (max − min) / min in percent, Infinity when the
 * smallest is 0 and another is not. The everyday energy rule carries over: where USDA's value is
 * under 10 kcal, answers no more than 5 kcal apart agree (spread 0). Null for fewer than 2 answers.
 */
export function kcalSpread(values, usdaKcal, small = EVERYDAY_SMALL.kcal) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (small && usdaKcal < small.below && max - min <= small.within + EPSILON) return {min, max, spread_pct: 0, small: true};
  const spread = min > 0 ? ((max - min) / min) * 100 : max === min ? 0 : Infinity;
  return {min, max, spread_pct: spread, small: false};
}

/**
 * The repeat report for one model. Per food: the calorie answers in order, their spread, and
 * whether they differ by more than SPREAD_THRESHOLD_PCT. Over the foods with at least 2 calorie
 * answers: the share that differ, the median spread and the widest food. Also the share of all
 * answers within ±10% of USDA (an answer without calories counts against it).
 */
export function repeatReport(foods, runsByFood, {n, small = EVERYDAY_SMALL} = {}) {
  const items = [];
  let answers = 0;
  let noKcal = 0;
  let within10 = 0;
  for (const f of foods) {
    const runs = runsByFood.get(f.fdc_id) || [];
    const kcal = [];
    for (const r of runs) {
      const p = parseAnswer(r.response_text);
      const v = p.error ? undefined : p.values.energy_kcal;
      answers++;
      if (v === undefined) {
        noKcal++;
        continue;
      }
      kcal.push(v);
      if (scoreValue(f.usda.energy_kcal, v, 'kcal', small).within10) within10++;
    }
    const s = kcalSpread(kcal, f.usda.energy_kcal, small.kcal);
    items.push({
      fdc_id: f.fdc_id,
      phrase: f.phrase ?? f.description,
      usda_kcal: round(f.usda.energy_kcal, 1),
      runs: runs.length,
      kcal,
      spread_pct: s ? (Number.isFinite(s.spread_pct) ? round(s.spread_pct, 1) : null) : null,
      spread_infinite: s ? s.spread_pct === Infinity : false,
      small_value_rule_applied: s ? s.small : false,
      differs: s ? s.spread_pct > SPREAD_THRESHOLD_PCT + EPSILON : null,
    });
  }
  const compared = items.filter((i) => i.differs !== null);
  const spreads = compared.map((i) => (i.spread_infinite ? Infinity : i.spread_pct));
  const m = median(spreads);
  let widest = null;
  for (const i of compared) {
    const s = i.spread_infinite ? Infinity : i.spread_pct;
    if (!widest || s > (widest.spread_infinite ? Infinity : widest.spread_pct)) widest = i;
  }
  const differ = compared.filter((i) => i.differs).length;
  return {
    runs_wanted: n,
    foods: foods.length,
    foods_with_all_runs: items.filter((i) => i.runs >= n).length,
    foods_compared: compared.length,
    answers,
    answers_without_kcal: noKcal,
    differ_over_10_pct: differ,
    differ_over_10_pct_share: compared.length ? round(differ / compared.length, 4) : null,
    median_spread_pct: m === null ? null : Number.isFinite(m) ? round(m, 1) : null,
    median_spread_infinite: m === Infinity,
    widest: widest && {phrase: widest.phrase, kcal: widest.kcal, usda_kcal: widest.usda_kcal, spread_pct: widest.spread_pct, spread_infinite: widest.spread_infinite},
    kcal_within_10_of_usda_share: answers ? round(within10 / answers, 4) : null,
    items,
  };
}
