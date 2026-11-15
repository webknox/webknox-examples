# Nutrition accuracy benchmark

How close do language models get to USDA's numbers when you ask them for the nutrition of a food? This folder asks five models about 500 foods from USDA FoodData Central and compares every answer with USDA's value.

It measures what an app built on a model gets when the model answers from its own knowledge: one plain question through the model's API, no system prompt, no tools, no web search. It does not measure chat apps such as ChatGPT or Gemini with search turned on, which can look things up and can't be repeated reliably.

## The method

**Foods.** 500 foods from two USDA FoodData Central releases: Foundation Foods (October 2026) and SR Legacy (April 2018, the final release). [`foods.json`](foods.json) lists them with USDA's values. The sample is drawn with a fixed seed and stratified by USDA food category in proportion to each category's size. The list is ordered so that any first part of it keeps the category shares; the 20-food pilot is its first 20 foods. Left out:

- the categories Baby Foods, Restaurant Foods, Fast Foods, American Indian/Alaska Native Foods, and Meals, Entrees, and Side Dishes;
- branded foods: descriptions with a word of three or more capital letters ("Cereals ready-to-eat, KELLOGG'S ...") other than USDA, plus 38 brands SR Legacy writes in mixed case, such as Pillsbury and Oscar Mayer (listed in [`lib/usda.mjs`](lib/usda.mjs));
- foods without all seven values;
- the second copy of a description found in both releases; the Foundation Foods copy is kept.

**Question.** The same prompt for every model and food, in [`prompt.txt`](prompt.txt), with the food named by its USDA description:

> Give the nutrition values per 100 g of the food "Broccoli, raw".
> Answer only with a JSON object with these keys: energy_kcal, protein_g, fat_g, carbohydrate_g, fiber_g, sugars_g, sodium_mg. Each value must be a number, with no units and no other text.

Per 100 g means a wrong answer is a wrong number, not a different serving size. Each food is asked once. A call is repeated only after a network error, a timeout, HTTP 429 or a 5xx error, with backoff.

**Nutrients and USDA ids.** Energy is nutrient 1008 (kcal), else 2048 (Atwater specific factors), else 2047 (Atwater general factors), because many Foundation Foods have only the Atwater values. Protein is 1003, fat 1004, carbohydrate 1005 (by difference) and fibre 1079. Sugars is 2000, else 1063. Sodium is 1093 (mg). The ids were checked against SR Legacy's `nutrient.csv` and the nutrient records in the Foundation Foods file.

**Scoring**, fixed before the run ([`lib/score.mjs`](lib/score.mjs)):

- For each model and nutrient: the median absolute percentage error, and the share of foods answered within ±10% and within ±20% of USDA.
- Small values: where USDA's value is under 1 g (under 10 mg for sodium), an answer within 0.5 g (5 mg) counts as within, and as a 0% error. Energy has no such rule.
- A refusal, an answer with no JSON, or a failed call is a miss for all seven nutrients. A missing or non-numeric key is a miss for that nutrient. Misses are counted separately, and a miss is never "within", so the shares are out of every food asked. The median error is over the answers given.
- The headline is the share of foods with calories within ±10%.

## Everyday questions

People don't ask for "Bread, whole-wheat, commercially prepared" per 100 g. They ask about "a slice of whole-wheat bread". A second set, [`everyday.json`](everyday.json), asks 20 such questions, each with a portion. Each item names the one SR Legacy food the phrase means and one of SR's household measures for it (its `food_portion` row: amount, measure and gram weight). USDA's answer is the food's per-100 g value × the portion's grams / 100, for the same seven nutrients.

The items were written by these rules:

- The foods were chosen before any model answer was seen.
- Common foods from at least 12 food groups (the 20 items cover 16), not a run of beef cuts.
- Every attribute that changes the nutrition is kept (raw or cooked, with or without skin, fat level, salted, sweetened), and USDA's jargon ("regular, enriched", "all grades") is dropped.
- The portion is the one SR's household measure gives, as SR says it: "two tablespoons" of peanut butter because SR lists 2 tbsp, and a cup of diced chicken because SR has no 3 oz row for roasted breast meat.
- Each phrase should lead a reasonable reader to that one SR food. An ambiguous phrase is rewritten, or the food replaced.
- The list is published so anyone can contest an item.

The prompt, [`prompt-everyday.txt`](prompt-everyday.txt), asks in plain words for the amounts in that portion, not per 100 g, with the same JSON keys. It doesn't name USDA:

> How many calories, and how much protein, fat, carbohydrate, fiber, sugars and sodium, are in a medium banana? Give the amounts for that portion, not per 100 g.

The scoring rules are the same, applied to the portion values, with one more rule for energy: under 10 kcal, an answer within 5 kcal counts as within (a cup of black coffee has 2.4 kcal). The models and settings are the same. The answers go to `results-everyday/`.

## The models

The top general model of each family as its provider presents it, chosen on 2026-11-13 from each provider's models endpoint (`node bench.mjs models`) and its model pages. [`models.json`](models.json) holds the ids, settings and prices.

| Family | Model id | Settings | Why this one |
|---|---|---|---|
| OpenAI GPT | `gpt-6-astra` | default: temperature 0 is rejected (only 1 is allowed); default reasoning effort | OpenAI calls it "our flagship model" and the place to start |
| Anthropic Claude | `claude-opus-5-5` | default: temperature is rejected for this model; adaptive thinking (always on) at the default effort; `max_tokens` 8192 | Anthropic's recommended start "for most workloads"; Claude Fable 5.2 is positioned for demanding reasoning and agentic work |
| Google Gemini | `gemini-4-carbon` | temperature 0; default thinking | Google's "most capable reasoning model" |
| Meta | `meta-models/Muse-Spark-Open-816B-A42B` via Together AI | temperature 0; default reasoning | Meta's largest model on Together AI's serverless API. Together serves no Llama model serverless any more: Llama 4 Maverick and Llama 3.3 70B need a dedicated endpoint |
| DeepSeek | `deepseek-ai/DeepSeek-V4-Pro-0813` via Together AI | temperature 0; default reasoning | DeepSeek's Pro tier on Together AI |

All five reason or think before answering at their default settings, and those tokens are billed as output. Each raw record keeps the model version the API reported.

## Budget models

Apps that answer many questions rarely run a flagship. A second list, [`models-cheap.json`](models-cheap.json), holds the budget tier of each family, chosen on 2026-11-15 the same way and run with the same settings rule. Their answers go to `results-cheap/` (the first 20 USDA-description foods) and `results-cheap-everyday/` (the 20 everyday items).

| Family | Model id | Settings | Why this one |
|---|---|---|---|
| OpenAI GPT | `gpt-5.6-luna` | default: temperature 0 is rejected; default reasoning effort | A small model apps already run (WebKnox moved to it when OpenAI retired the gpt-5 minis) |
| OpenAI GPT | `gpt-6-luna` | default: temperature 0 is rejected; default reasoning effort | OpenAI's pick for cost-sensitive, high-volume work, at half gpt-5.6-luna's price |
| Anthropic Claude | `claude-haiku-5-5` | default: temperature is rejected; adaptive thinking at the default effort; `max_tokens` 8192 | Anthropic's model "for high-volume, latency-sensitive tasks" |
| Google Gemini | `gemini-3.8-flash` | temperature 0; default thinking | The newest Flash model |
| Meta | `meta-models/Muse-Glimmer-30B` via Together AI | temperature 0; default reasoning | Meta's small model on Together AI's serverless API |
| DeepSeek | `deepseek-ai/DeepSeek-V4.1-Flash-1017` via Together AI | temperature 0; default reasoning | DeepSeek's cheapest serverless chat model on Together AI |

**Repeat check.** A model can give a different number when asked again. `ask --repeat 5` asks every everyday item again at the provider's default temperature (whatever the models file says) until it has 5 answers: the scored run's answer counts as the first, so for the models run at temperature 0 the first of the five is that answer. The repeat answers go to `<results>/repeats/raw/` and never change the scores. `repeats --repeat 5` reports, per model:

- the share of items whose calorie answers differ by more than 10%, where the spread is (largest − smallest) / smallest, over the items with at least two calorie answers;
- the median spread and the widest item;
- the share of all the answers within ±10% of USDA under the scoring rules.

The everyday energy rule carries over: where USDA's value is under 10 kcal, answers no more than 5 kcal apart agree.

## Cost

Each call's cost is the token usage the API reported times the list price per million input and output tokens, as given in `models.json` (or `models-cheap.json`) with the source page and date. Reasoning and thinking tokens are included in the output count for every provider. Cached input is charged at the full input price, which slightly overstates the cost. Gemini 4 Carbon's price doubles on 2026-12-01 and Gemini 3.8 Flash's on 2027-01-01; the script applies the price in force on the day of each request.

## Run it yourself

Node 20 or later, no packages.

```bash
cd benchmarks/nutrition
node --test test/*.test.mjs          # offline tests

node bench.mjs fetch-usda            # downloads the two USDA zips into data/ (about 7 MB)
node bench.mjs sample                # writes foods.json; the same USDA files give the same list

export OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GEMINI_API_KEY=... TOGETHER_API_KEY=...
node bench.mjs models                # lists each provider's models (free)
node bench.mjs ask --limit 20 --budget 3     # the first 20 foods, all five models
node bench.mjs score --limit 20

node bench.mjs everyday              # fills in and checks everyday.json against the SR files
node bench.mjs ask --set everyday --budget 2
node bench.mjs score --set everyday

# the budget models, and the repeat check
node bench.mjs ask --limit 20 --models-file models-cheap.json --results results-cheap --budget 0.3
node bench.mjs score --limit 20 --models-file models-cheap.json --results results-cheap
node bench.mjs ask --set everyday --models-file models-cheap.json --results results-cheap-everyday --budget 0.3
node bench.mjs score --set everyday --models-file models-cheap.json --results results-cheap-everyday
node bench.mjs ask --set everyday --repeat 5 --models-file models-cheap.json --results results-cheap-everyday --budget 0.6
node bench.mjs repeats --set everyday --repeat 5 --models-file models-cheap.json --results results-cheap-everyday
```

`--models-file` reads another models file and `--results` another results folder, both relative to this folder. A models file is checked before any call: every entry needs a name, a provider, an id, a temperature (a number, or `null` for the default) and an input and output price.

`everyday.json` is written by hand as `{phrase, fdc_id, portion: {id}}`. `node bench.mjs everyday` fills in the SR description, category, portion row, grams, per-100 g values and portion values. It stops if a food or portion row doesn't exist, the grams don't match the row, or fewer than 12 food groups are covered.

Without `--limit` the commands cover all 500 foods. `ask` stops starting new calls once `--budget` dollars (default 30) are spent. It skips foods a model has already answered, so a stopped run picks up where it left off; failed calls are asked again. Delete `results/raw/` to start over. `--models gpt-6-astra,claude-opus-5-5` limits a run to some of the models. To try another model, add an entry to `models.json`.

The keys are read from the environment only, sent as request headers, and never written to a file. [`run-with-keys.sh`](run-with-keys.sh) runs `bench.mjs` with the Anthropic, Gemini and Together keys taken from a Java-style properties file (`KEYS_FILE`), exported for that one process. `sh run-with-keys.sh check-keys` scans every file in this folder (but `data/`) for those key values and for anything shaped like a key, and prints only the variable names.

## Files

| File | What it holds |
|---|---|
| [`bench.mjs`](bench.mjs) | The commands: `fetch-usda`, `sample`, `everyday`, `models`, `ask`, `score`, `repeats` |
| [`prompt.txt`](prompt.txt) | The exact prompt; `{description}` is the USDA description |
| [`prompt-everyday.txt`](prompt-everyday.txt) | The everyday prompt; `{phrase}` is the item's phrase |
| [`everyday.json`](everyday.json) | The 20 everyday items: phrase, SR food, portion row, grams, per-100 g values and USDA's portion values |
| `results-everyday/` | The everyday answers and scores, laid out like `results/` |
| [`models.json`](models.json) | Model ids, settings, why each was chosen, list prices with their sources |
| [`models-cheap.json`](models-cheap.json) | The same for the budget models |
| `results-cheap/`, `results-cheap-everyday/` | The budget models' answers and scores, laid out like `results/` |
| `results-cheap-everyday/repeats/` | The repeat check: `raw/<model>.jsonl` (each answer with its `run` number), `scores.json` and `summary.csv` |
| [`foods.json`](foods.json) | The 500 foods in order, with USDA's values, the nutrient ids used, the rules and the counts |
| [`usda-manifest.json`](usda-manifest.json) | The USDA files downloaded: URL, release, size, SHA-256 |
| `results/raw/<model>.jsonl` | One line per answer: request time, model and reported version, settings, prompt, full response text, parsed values, token usage as reported, cost |
| [`results/scores.json`](results/scores.json) | Scores per model and nutrient, misses, tokens and cost |
| [`results/summary.csv`](results/summary.csv) | The same scores, one row per model and nutrient |
| `lib/`, `test/` | The code and its offline tests with small fixtures |

`results/` holds the 20-food pilot until the full run replaces it.

USDA's October 2026 Foundation Foods CSV download contains no `food.csv` or `food_nutrient.csv`, so the script uses the JSON download of the same release. SR Legacy comes from its CSV download.

## Licence

The USDA FoodData Central data is in the public domain. The code in this folder is under the repository's [MIT licence](../../LICENSE).
