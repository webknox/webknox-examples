// Downloads the two FoodData Central releases into data/ and unzips them with the system
// `unzip`. The files are data: they are parsed, nothing in them is executed.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);

// Listed on https://fdc.nal.usda.gov/download-datasets/ (checked 2026-11-13).
// Foundation Foods comes as JSON: the October 2026 CSV zip on that page is 1.1 MB and holds
// no food.csv or food_nutrient.csv (the page says 4.1 MB zipped, 35 MB unzipped), while the
// JSON zip of the same release is complete (424 foods, like the CSV's foundation_food.csv).
export const DATASETS = [
  {
    dataset: 'foundation',
    name: 'Foundation Foods',
    release: '2026-10-29',
    releaseLabel: 'October 2026',
    format: 'json',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-10-29.zip',
    need: ['FoodData_Central_foundation_food_json_2026-10-29.json'],
    note: 'The CSV zip of this release (FoodData_Central_foundation_food_csv_2026-10-29.zip, 1,127,612 bytes) has no food.csv or food_nutrient.csv, so the JSON zip of the same release is used.',
  },
  {
    dataset: 'sr_legacy',
    name: 'SR Legacy',
    release: '2018-04',
    releaseLabel: 'April 2018 (final)',
    format: 'csv',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip',
    need: ['food.csv', 'food_nutrient.csv', 'nutrient.csv', 'food_category.csv', 'food_portion.csv'],
  },
];

/** Downloads, checks and unzips every dataset, and returns the manifest. */
export async function fetchUsda(dataDir) {
  await mkdir(dataDir, {recursive: true});
  const entries = [];
  for (const d of DATASETS) {
    const zipName = d.url.split('/').pop();
    const zipPath = join(dataDir, zipName);
    console.log(`Downloading ${d.url}`);
    const response = await fetch(d.url);
    if (!response.ok) throw new Error(`${d.url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(zipPath, bytes);

    // Refuse archives with absolute paths or `..` before unzipping anything.
    const {stdout: listing} = await run('unzip', ['-Z1', zipPath], {maxBuffer: 16 * 1024 * 1024});
    const names = listing.split('\n').filter(Boolean);
    const unsafe = names.filter((n) => n.startsWith('/') || n.split('/').includes('..'));
    if (unsafe.length) throw new Error(`${zipName} has unsafe paths: ${unsafe.join(', ')}`);

    const outDir = join(dataDir, d.dataset);
    await rm(outDir, {recursive: true, force: true});
    await mkdir(outDir, {recursive: true});
    await run('unzip', ['-q', '-o', zipPath, '-d', outDir]);
    const dir = await findDir(outDir, d.need[0]);
    if (!dir) throw new Error(`${zipName}: no ${d.need[0]} inside`);

    const files = [];
    for (const f of d.need) {
      const s = await stat(join(dir, f)).catch(() => null);
      if (!s) throw new Error(`${zipName}: no ${f} inside`);
      files.push({file: f, bytes: s.size});
    }
    entries.push({
      dataset: d.dataset,
      name: d.name,
      release: d.release,
      release_label: d.releaseLabel,
      format: d.format,
      url: d.url,
      zip: zipName,
      zip_bytes: bytes.length,
      zip_sha256: createHash('sha256').update(bytes).digest('hex'),
      last_modified: response.headers.get('last-modified'),
      dir: dir.slice(dataDir.length + 1),
      files,
      ...(d.note ? {note: d.note} : {}),
    });
  }
  return {downloaded_at: new Date().toISOString(), source: 'https://fdc.nal.usda.gov/download-datasets/', datasets: entries};
}

async function findDir(dir, fileName) {
  const items = await readdir(dir, {withFileTypes: true});
  if (items.some((i) => i.isFile() && i.name === fileName)) return dir;
  for (const i of items) {
    if (i.isDirectory()) {
      const found = await findDir(join(dir, i.name), fileName);
      if (found) return found;
    }
  }
  return null;
}
