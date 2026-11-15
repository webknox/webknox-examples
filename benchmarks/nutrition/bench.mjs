#!/usr/bin/env node
// Nutrition accuracy benchmark. Node 20 or later, no packages.
//   node bench.mjs fetch-usda                      download the USDA releases into data/
//   node bench.mjs sample                          write foods.json (500 foods)
//   node bench.mjs models                          list each provider's models (free)
//   node bench.mjs ask [--limit 20] [--models gpt-6-astra,...] [--budget 30] [--concurrency 4]
//   node bench.mjs score [--limit 20]              write results/scores.json and summary.csv
//   node bench.mjs everyday                        fill in and check everyday.json from data/
//   node bench.mjs ask --set everyday --budget 2   the everyday questions, into results-everyday/
//   node bench.mjs score --set everyday
// Other models and folders (the budget-model pilot):
//   --models-file models-cheap.json --results results-cheap      read models and write answers there
//   node bench.mjs ask --set everyday --repeat 5 ...    each item until it has 5 default-temperature answers
//   node bench.mjs repeats --set everyday --repeat 5 ...   how far apart those answers are
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonl, rawPath, repeatPath, runAsk} from './lib/ask.mjs';
import {totals} from './lib/cost.mjs';
import {csvCell} from './lib/csv.mjs';
import {buildItems, loadSrLegacy, validateItems} from './lib/everyday.mjs';
import {fetchUsda} from './lib/fetch-usda.mjs';
import {selectModels} from './lib/models.mjs';
import {keysIn, keysSet, listModels, redact} from './lib/providers.mjs';
import {repeatReport, repeatRuns, SPREAD_THRESHOLD_PCT} from './lib/repeat.mjs';
import {stratifiedSample} from './lib/sample.mjs';
import {EVERYDAY_SMALL, SMALL, round, scoreModel} from './lib/score.mjs';
import {EXCLUDED_CATEGORIES, MIXED_CASE_BRANDS, NUTRIENTS, eligibleFoods, loadUsda} from './lib/usda.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, 'data');
const SEED = 20261113;
const SAMPLE_SIZE = 500;
const PILOT_SIZE = 20;
// The plan's hard stop for the full run; pass --budget 3 for the pilot.
const DEFAULT_BUDGET = 30;
// Two question sets: foods named by their USDA description, per 100 g (`usda`), and everyday
// phrases with a portion, "a medium banana" (`everyday`).
const SETS = {
  usda: {prompt: 'prompt.txt', results: join(ROOT, 'results'), small: SMALL},
  everyday: {prompt: 'prompt-everyday.txt', results: join(ROOT, 'results-everyday'), small: EVERYDAY_SMALL},
};

const [command, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

async function main() {
  const setName = flags.set ?? 'usda';
  const known = SETS[setName];
  if (!known) throw new Error(`Unknown --set ${setName}: use usda or everyday`);
  // --results puts a run's answers and scores in another folder (relative to this one).
  const set = flags.results ? {...known, results: resolve(ROOT, flags.results)} : known;
  const repeat = flags.repeat !== undefined ? Number(flags.repeat) : 0;
  if (flags.repeat !== undefined && !(Number.isInteger(repeat) && repeat >= 1)) throw new Error(`--repeat must be a whole number of answers, not ${flags.repeat}`);
  switch (command) {
    case 'fetch-usda': {
      const manifest = await fetchUsda(DATA);
      await writeJson(join(ROOT, 'usda-manifest.json'), manifest);
      for (const d of manifest.datasets) console.log(`${d.name} ${d.release_label}: ${d.zip} (${d.zip_bytes} bytes)`);
      break;
    }
    case 'sample': {
      const manifest = await readJson(join(ROOT, 'usda-manifest.json'));
      const {foods: pool, counts} = eligibleFoods(await loadUsda(DATA, manifest));
      const {foods, allocation} = stratifiedSample(pool, SAMPLE_SIZE, SEED);
      const out = {
        seed: SEED,
        size: foods.length,
        pilot: PILOT_SIZE,
        datasets: manifest.datasets.map((d) => ({dataset: d.dataset, name: d.name, release: d.release, zip: d.zip})),
        nutrients: NUTRIENTS.map((n) => ({key: n.key, unit: n.unit, fdc_nutrient_ids: n.ids})),
        rules: {
          excluded_categories: EXCLUDED_CATEGORIES,
          brand_rule: 'a word of 3 or more capital letters other than USDA, or one of mixed_case_brands',
          mixed_case_brands: MIXED_CASE_BRANDS,
          all_seven_nutrients: true,
          duplicates: 'the same description in both releases is kept once, from Foundation Foods',
          stratified_by: 'food_category, proportional (largest remainder), categories interleaved so every prefix keeps the shares',
        },
        counts: {...counts, pool_by_category: countBy(pool, 'category'), sample_by_category: allocation, sample_by_dataset: countBy(foods, 'dataset')},
        foods: foods.map((f) => ({fdc_id: f.fdc_id, dataset: f.dataset, description: f.description, category: f.category, usda: f.usda, nutrient_ids: f.nutrient_ids})),
      };
      await writeJson(join(ROOT, 'foods.json'), out);
      console.log(JSON.stringify({counts: out.counts, pilot_categories: countBy(foods.slice(0, PILOT_SIZE), 'category')}, null, 2));
      break;
    }
    case 'everyday': {
      // everyday.json is written by hand as {phrase, fdc_id, portion: {id}}; this fills in the SR
      // description, category, portion row, grams, per-100 g values and the portion values.
      const manifest = await readJson(join(ROOT, 'usda-manifest.json'));
      const sr = await loadSrLegacy(DATA, manifest);
      const file = join(ROOT, 'everyday.json');
      const items = buildItems((await readJson(file)).items, sr);
      const problems = validateItems(items, sr);
      if (problems.length) throw new Error(`everyday.json:\n  ${problems.join('\n  ')}`);
      await writeJson(file, {items});
      for (const i of items) console.log(`${String(i.grams).padStart(6)} g ${String(i.usda.energy_kcal).padStart(8)} kcal  ${i.phrase}  =  ${i.sr_description}  [${i.portion.amount} ${i.portion.modifier}]`);
      console.log(`${items.length} items in ${new Set(items.map((i) => i.category)).size} food groups.`);
      break;
    }
    case 'models': {
      // Free calls: what each provider lists today, to pick the flagship ids in models.json.
      const want = {openai: /^(gpt|o\d|chatgpt)/i, anthropic: /./, gemini: /gemini/i, together: /llama|deepseek|meta-models/i};
      for (const provider of Object.keys(want)) {
        try {
          const models = (await listModels(provider)).filter((m) => want[provider].test(m.id));
          console.log(`\n${provider} (${models.length})`);
          for (const m of models) console.log(`  ${m.id}${m.name ? `  ${m.name}` : ''}${m.created ? `  ${m.created}` : ''}${m.type ? `  ${m.type}` : ''}${m.pricing ? `  in ${m.pricing.input} out ${m.pricing.output}` : ''}`);
        } catch (error) {
          console.log(`\n${provider}: ${redact(error.message)}`);
        }
      }
      break;
    }
    case 'ask': {
      const foods = await loadFoods(setName);
      const models = await loadModels();
      const template = await readFile(join(ROOT, set.prompt), 'utf8');
      const budget = flags.budget !== undefined ? Number(flags.budget) : DEFAULT_BUDGET;
      const concurrency = flags.concurrency !== undefined ? Number(flags.concurrency) : 4;
      const what = repeat ? `until each has ${repeat} answers at the default temperature` : 'once each';
      console.log(`Asking ${models.length} models about ${foods.length} ${setName} items ${what} (budget $${budget}, ${Math.min(concurrency, 4)} at a time per provider).`);
      const result = await runAsk({foods, models, template, resultsDir: set.results, budget, concurrency, repeat});
      for (const [name, s] of Object.entries(result.perModel)) {
        console.log(`${name}: asked ${s.asked}, already done ${s.skipped}, errors ${s.errors}, $${s.cost_usd.toFixed(4)}`);
      }
      console.log(`Spent $${result.spent.toFixed(4)}${result.stopped ? ' (stopped at the budget)' : ''}.`);
      break;
    }
    case 'score': {
      const foods = await loadFoods(setName);
      const models = await loadModels();
      const scores = {
        scored_at: new Date().toISOString(),
        set: setName,
        foods: foods.length,
        rules: {
          ...(setName === 'everyday' ? {values: "USDA's per-100 g values × the portion's grams / 100"} : {}),
          median_ape: 'median absolute percentage error over the answered values; Infinity where USDA says 0 and the answer does not',
          within: 'share of all foods asked with an answer within ±10% / ±20% of USDA; a miss is not within',
          small_values: set.small.kcal
            ? 'USDA under 1 g (10 mg sodium, 10 kcal energy): an answer within 0.5 g (5 mg, 5 kcal) counts as within and as 0% error'
            : 'USDA under 1 g (10 mg sodium): an answer within 0.5 g (5 mg) counts as within and as 0% error',
          misses: 'api_error, empty, refusal and no_json count against every nutrient; missing_key against that nutrient',
          headline: 'calories within ±10%',
        },
        models: {},
      };
      const rows = [];
      for (const model of models) {
        const records = await readJsonl(rawPath(set.results, model));
        const ids = new Set(foods.map((f) => f.fdc_id));
        const scored = scoreModel(foods, records, {small: set.small});
        const cost = totals(records.filter((r) => ids.has(r.fdc_id)), model.price);
        scores.models[model.name] = {
          family: model.family,
          id: model.id,
          provider: model.provider,
          settings: model.settings,
          response_models: [...new Set(records.filter((r) => ids.has(r.fdc_id) && r.response_model).map((r) => r.response_model))],
          run_dates: [...new Set(records.filter((r) => ids.has(r.fdc_id)).map((r) => r.time.slice(0, 10)))].sort(),
          ...scored,
          usage: {...cost, cost_per_food_usd: scored.asked ? round(cost.cost_usd / scored.asked, 6) : null},
          price: model.price,
        };
        for (const n of NUTRIENTS) {
          const s = scored.nutrients[n.key];
          rows.push([model.name, model.id, n.key, s.foods, s.answered, s.misses, s.median_ape_pct ?? (s.median_ape_infinite ? 'Infinity' : ''), pct(s.within_10_share), pct(s.within_20_share)]);
        }
      }
      await writeJson(join(set.results, 'scores.json'), scores);
      const header = ['model', 'model_id', 'nutrient', 'foods', 'answered', 'misses', 'median_abs_pct_error', 'within_10_pct', 'within_20_pct'];
      await writeFile(join(set.results, 'summary.csv'), [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
      for (const [name, m] of Object.entries(scores.models)) {
        console.log(`${name}: asked ${m.asked}, fully parsed ${m.fully_parsed}, calories within ±10% ${pct(m.headline_calories_within_10_share)}%, $${m.usage.cost_usd.toFixed(4)}`);
      }
      break;
    }
    case 'repeats': {
      // The repeat check, from the answers `ask --repeat N` stored: how far apart each item's
      // calorie answers land. Writes <results>/repeats/scores.json and summary.csv.
      if (!Number.isInteger(repeat) || repeat < 2) throw new Error('repeats needs --repeat N, the number of answers per item (2 or more)');
      const foods = await loadFoods(setName);
      const models = await loadModels();
      const out = {
        scored_at: new Date().toISOString(),
        set: setName,
        foods: foods.length,
        rules: {
          answers: `up to ${repeat} answers per item: the scored run's answer (at the models file's temperature), then the repeat runs' answers at the provider's default temperature, oldest first`,
          spread: '(max − min) / min of the calorie answers, in percent; Infinity when the smallest is 0 and another is not',
          differs: `spread over ${SPREAD_THRESHOLD_PCT}%, over the items with at least 2 calorie answers`,
          small_values: set.small.kcal ? 'USDA under 10 kcal: answers no more than 5 kcal apart agree (spread 0)' : 'none',
          kcal_within_10_of_usda: 'share of all answers within ±10% of USDA under the scoring rules; an answer without calories counts against it',
        },
        models: {},
      };
      const rows = [];
      for (const model of models) {
        const main = await readJsonl(rawPath(set.results, model));
        const repeats = await readJsonl(repeatPath(set.results, model));
        const runs = repeatRuns(foods, main, repeats, repeat);
        const used = [...runs.values()].flat();
        const report = repeatReport(foods, runs, {n: repeat, small: set.small});
        // Cost of the repeat runs only: the scored run's answer is paid for in scores.json.
        const ids = new Set(foods.map((f) => f.fdc_id));
        const cost = totals(repeats.filter((r) => ids.has(r.fdc_id)), model.price);
        out.models[model.name] = {
          family: model.family,
          id: model.id,
          provider: model.provider,
          scored_run_temperature: model.temperature === null ? 'default' : model.temperature,
          repeat_run_temperature: 'default',
          response_models: [...new Set(used.map((r) => r.response_model).filter(Boolean))],
          run_dates: [...new Set(used.map((r) => r.time.slice(0, 10)))].sort(),
          ...report,
          repeat_usage: cost,
        };
        rows.push([model.name, model.id, report.foods_compared, report.foods_with_all_runs, report.answers, report.answers_without_kcal, report.differ_over_10_pct, pct(report.differ_over_10_pct_share), report.median_spread_pct ?? (report.median_spread_infinite ? 'Infinity' : ''), report.widest?.phrase ?? '', report.widest ? (report.widest.spread_infinite ? 'Infinity' : report.widest.spread_pct) : '', pct(report.kcal_within_10_of_usda_share)]);
      }
      const dir = join(set.results, 'repeats');
      await mkdir(dir, {recursive: true});
      await writeJson(join(dir, 'scores.json'), out);
      const header = ['model', 'model_id', 'items_compared', 'items_with_all_runs', 'answers', 'answers_without_kcal', 'items_differ_over_10', 'items_differ_over_10_pct', 'median_spread_pct', 'widest_item', 'widest_spread_pct', 'answers_kcal_within_10_pct'];
      await writeFile(join(dir, 'summary.csv'), [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
      for (const [name, m] of Object.entries(out.models)) {
        const w = m.widest;
        console.log(`${name}: ${m.foods_compared} items, ${m.differ_over_10_pct} differ by >${SPREAD_THRESHOLD_PCT}% (${pct(m.differ_over_10_pct_share)}%), median spread ${m.median_spread_pct ?? (m.median_spread_infinite ? 'Infinity' : '-')}%, widest ${w ? `${w.phrase} ${JSON.stringify(w.kcal)}` : '-'}, $${m.repeat_usage.cost_usd.toFixed(4)}`);
      }
      break;
    }
    case 'check-keys': {
      // Scans every file in this folder (but data/) for the key values in the environment, and
      // every file outside test/ (whose redaction tests hold fake keys) for anything shaped like
      // a key. Run it through run-with-keys.sh; prints names, never values.
      const files = await listFiles(ROOT, ['data', '.cache', 'node_modules', '.git']);
      const found = [];
      for (const file of files) {
        const rel = file.slice(ROOT.length + 1);
        const hit = keysIn(await readFile(file, 'latin1'));
        if (hit.names.length) found.push(`${rel}: ${hit.names.join(', ')}`);
        else if (hit.pattern && !rel.startsWith('test/')) found.push(`${rel}: a key-shaped string`);
      }
      console.log(`Checked ${files.length} files against ${keysSet().length} key values (${keysSet().join(', ') || 'none set'}).`);
      if (found.length) {
        console.log(`Found:\n  ${found.join('\n  ')}`);
        process.exitCode = 1;
      } else console.log('No key found.');
      break;
    }
    default:
      console.log('Commands: fetch-usda, sample, everyday, models, ask, score, repeats, check-keys');
      process.exitCode = command ? 1 : 0;
  }
}

async function loadFoods(setName) {
  let all;
  if (setName === 'everyday') {
    const items = (await readJson(join(ROOT, 'everyday.json'))).items;
    if (items.some((i) => !i.usda)) throw new Error('everyday.json has no answer key yet: run node bench.mjs everyday');
    all = items.map((i) => ({fdc_id: i.fdc_id, dataset: 'sr_legacy', description: i.sr_description, phrase: i.phrase, grams: i.grams, usda: i.usda}));
  } else {
    all = (await readJson(join(ROOT, 'foods.json'))).foods;
  }
  return flags.limit !== undefined ? all.slice(0, Number(flags.limit)) : all;
}

/** The models of models.json, or of --models-file, limited to --models names. */
async function loadModels() {
  return selectModels(await readJson(resolve(ROOT, flags['models-file'] ?? 'models.json')), flags.models);
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`Unknown argument: ${args[i]}`);
    out[m[1]] = m[2] ?? args[++i];
  }
  return out;
}

function pct(share) {
  return share === null || share === undefined ? '' : round(share * 100, 1);
}

function countBy(items, key) {
  const out = {};
  for (const i of items) out[i[key]] = (out[i[key]] || 0) + 1;
  return out;
}

/** Every file under `dir`, skipping the folders named in `skip`. */
async function listFiles(dir, skip) {
  const out = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip.includes(entry.name)) out.push(...(await listFiles(path, skip)));
    } else if (entry.isFile()) out.push(path);
  }
  return out;
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

main().catch((error) => {
  console.error(redact(error.message));
  process.exitCode = 1;
});
