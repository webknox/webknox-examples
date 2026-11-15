// Asks every model about every food once and appends one raw record per answer. With `repeat`,
// asks every food again, at the provider's default temperature, until it has that many answers.
import {appendFile, mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {costOf} from './cost.mjs';
import {parseAnswer} from './parse.mjs';
import {ANTHROPIC_MAX_TOKENS, ask, redact} from './providers.mjs';

/** Fills `{description}` (prompt.txt) or `{phrase}` (prompt-everyday.txt). */
export function buildPrompt(template, text) {
  return template.trimEnd().replace(/\{(description|phrase)\}/, () => text);
}

export async function readJsonl(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function rawPath(resultsDir, model) {
  return join(resultsDir, 'raw', `${model.name}.jsonl`);
}

/** The repeat check's answers, kept apart from the scored run: `<results>/repeats/raw/<model>.jsonl`. */
export function repeatPath(resultsDir, model) {
  return join(resultsDir, 'repeats', 'raw', `${model.name}.jsonl`);
}

/** An answer (not a failed call) given at the provider's default temperature. */
export function isDefaultTemperatureAnswer(record) {
  return !record.error && record.settings?.temperature === 'default';
}

/**
 * The calls still to make. Without `repeat`: each food with no answer yet. With `repeat`: each
 * food until it has `repeat` answers in all, where the scored run's answer is the first (at
 * whatever temperature the models file gives) and every other is a repeat-run answer at the
 * default temperature. Each job is {food, run}; `run` is null outside the repeat check.
 */
export function plannedJobs(foods, mainRecords, repeatRecords, repeat) {
  const scored = new Set(mainRecords.filter((r) => !r.error).map((r) => r.fdc_id));
  if (!repeat) return foods.filter((f) => !scored.has(f.fdc_id)).map((food) => ({food, run: null}));
  const count = new Map([...scored].map((id) => [id, 1]));
  for (const r of repeatRecords) {
    if (isDefaultTemperatureAnswer(r)) count.set(r.fdc_id, (count.get(r.fdc_id) || 0) + 1);
  }
  const jobs = [];
  for (const food of foods) {
    for (let run = (count.get(food.fdc_id) || 0) + 1; run <= repeat; run++) jobs.push({food, run});
  }
  return jobs;
}

/** A tiny semaphore: at most `limit` tasks at once. */
function limiter(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active++;
    const {task, resolve, reject} = queue.shift();
    task().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({task, resolve, reject});
    next();
  });
}

/**
 * Runs the questions. Foods that already have an answer in a model's raw file are skipped, so a
 * stopped run resumes; API errors are asked again. Stops starting new calls once `budget`
 * dollars are spent in this run.
 *
 * With `repeat` (a number of answers per food, the scored run's answer included), every model
 * is asked again at its provider's default temperature, whatever the models file says, and the
 * answers go to repeatPath(); see plannedJobs(). `askImpl` stands in for the API call in tests.
 */
export async function runAsk({foods, models, template, resultsDir, budget, concurrency = 4, repeat = 0, askImpl = ask, log = console.log}) {
  if (!Number.isFinite(budget) || budget < 0) throw new Error(`The budget must be a number of dollars, not ${budget}`);
  if (repeat !== 0 && (!Number.isInteger(repeat) || repeat < 1)) throw new Error(`--repeat must be a whole number of answers, not ${repeat}`);
  await mkdir(join(resultsDir, repeat ? join('repeats', 'raw') : 'raw'), {recursive: true});
  const pools = {};
  let spent = 0;
  let stopped = false;
  const perModel = {};
  const jobs = [];
  for (const configured of models) {
    const model = repeat ? {...configured, temperature: null} : configured;
    const main = await readJsonl(rawPath(resultsDir, model));
    const path = repeat ? repeatPath(resultsDir, model) : rawPath(resultsDir, model);
    const todo = plannedJobs(foods, main, repeat ? await readJsonl(path) : [], repeat);
    const wanted = repeat ? foods.length * repeat : foods.length;
    perModel[model.name] = {skipped: wanted - todo.length, asked: 0, errors: 0, cost_usd: 0};
    pools[model.provider] ||= limiter(Math.min(concurrency, 4));
    let writes = Promise.resolve();
    for (const {food, run} of todo) {
      jobs.push(pools[model.provider](async () => {
        if (stopped) return;
        if (spent >= budget) {
          stopped = true;
          log(`Budget of $${budget} reached: no new calls.`);
          return;
        }
        const record = await askOne(model, food, template, run, askImpl);
        const cost = record.usage ? costOf(record.usage, model.price, record.time) : 0;
        record.cost_usd = Math.round(cost * 1e6) / 1e6;
        spent += cost;
        const stats = perModel[model.name];
        stats.asked++;
        stats.cost_usd += cost;
        if (record.error) {
          stats.errors++;
          log(`${model.name} ${food.fdc_id}: ${record.error}`);
        }
        writes = writes.then(() => appendFile(path, JSON.stringify(record) + '\n'));
        await writes;
      }));
    }
  }
  await Promise.all(jobs);
  return {spent, stopped, perModel};
}

async function askOne(model, food, template, run, askImpl) {
  const prompt = buildPrompt(template, food.phrase ?? food.description);
  const time = new Date().toISOString();
  const started = Date.now();
  const base = {
    time,
    model: model.name,
    model_id: model.id,
    provider: model.provider,
    settings: {
      temperature: model.temperature === null ? 'default' : model.temperature,
      ...(model.provider === 'anthropic' ? {max_tokens: ANTHROPIC_MAX_TOKENS} : {}),
    },
    fdc_id: food.fdc_id,
    dataset: food.dataset,
    description: food.description,
    ...(food.phrase ? {phrase: food.phrase, grams: food.grams} : {}),
    ...(run ? {run} : {}),
    prompt,
  };
  try {
    const r = await askImpl(model, prompt);
    const parsed = parseAnswer(r.text);
    return {
      ...base,
      response_model: r.response_model,
      latency_ms: Date.now() - started,
      attempts: r.attempts,
      finish_reason: r.finish_reason,
      response_text: r.text,
      parsed: parsed.error ? null : parsed.values,
      missing_keys: parsed.missing,
      parse_error: parsed.error,
      usage: r.usage,
      error: null,
    };
  } catch (error) {
    return {...base, latency_ms: Date.now() - started, response_text: null, parsed: null, usage: null, error: redact(error.message)};
  }
}
