// Reads a models file (models.json, models-cheap.json) and checks every entry before any call is
// made: a missing price would make every cost NaN, and a NaN cost never reaches the budget stop.

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'together'];

/** The problems with one models-file entry, as text; empty when it is usable. */
export function modelProblems(m) {
  const out = [];
  const label = m && typeof m.name === 'string' && m.name ? m.name : JSON.stringify(m);
  if (!m || typeof m !== 'object') return [`${label}: not an object`];
  if (typeof m.name !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(m.name)) out.push(`${label}: name must be lower-case letters, digits, dots and dashes (it names the raw file)`);
  if (!PROVIDERS.includes(m.provider)) out.push(`${label}: provider must be one of ${PROVIDERS.join(', ')}`);
  if (typeof m.id !== 'string' || !m.id) out.push(`${label}: id is missing`);
  if (!(m.temperature === null || Number.isFinite(m.temperature))) out.push(`${label}: temperature must be a number or null (the provider's default)`);
  const p = m.price || {};
  for (const k of ['input_per_mtok', 'output_per_mtok']) {
    if (!Number.isFinite(p[k]) || p[k] < 0) out.push(`${label}: price.${k} must be a number of dollars`);
  }
  for (const c of p.changes || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.from || '') || !Number.isFinite(c.input_per_mtok) || !Number.isFinite(c.output_per_mtok)) {
      out.push(`${label}: each price change needs from (YYYY-MM-DD), input_per_mtok and output_per_mtok`);
    }
  }
  return out;
}

/**
 * The models of a parsed models file, checked, optionally limited to `names` (comma-separated
 * or an array). Throws on a bad entry, a repeated name or an unknown name.
 */
export function selectModels(file, names) {
  const all = file && Array.isArray(file.models) ? file.models : null;
  if (!all || !all.length) throw new Error('The models file has no "models" list.');
  const problems = all.flatMap(modelProblems);
  const seen = new Set();
  for (const m of all) {
    if (seen.has(m.name)) problems.push(`${m.name}: the name is used twice`);
    seen.add(m.name);
  }
  if (problems.length) throw new Error(`Models file:\n  ${problems.join('\n  ')}`);
  if (names === undefined || names === null || names === '') return all;
  const wanted = Array.isArray(names) ? names : String(names).split(',');
  const unknown = wanted.filter((n) => !all.some((m) => m.name === n));
  if (unknown.length) throw new Error(`Unknown model names: ${unknown.join(', ')}`);
  return all.filter((m) => wanted.includes(m.name));
}
