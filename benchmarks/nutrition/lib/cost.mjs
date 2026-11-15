// Cost from the usage each API reported and the list price in models.json. Output tokens already
// include reasoning or thinking tokens for every provider (see providers.mjs), and all input is
// charged at the full input price, so cached prompt tokens make this a slight overestimate.

/** The price that applied at `isoTime` (models.json can list dated price changes). */
export function priceAt(price, isoTime) {
  let current = {input_per_mtok: price.input_per_mtok, output_per_mtok: price.output_per_mtok};
  for (const c of (price.changes || []).slice().sort((a, b) => (a.from < b.from ? -1 : 1))) {
    if (isoTime.slice(0, 10) >= c.from) current = {input_per_mtok: c.input_per_mtok, output_per_mtok: c.output_per_mtok};
  }
  return current;
}

export function costOf(usage, price, isoTime) {
  if (!usage) return 0;
  const p = priceAt(price, isoTime);
  return ((usage.input_tokens || 0) * p.input_per_mtok + (usage.output_tokens || 0) * p.output_per_mtok) / 1e6;
}

/** Token and cost totals over a model's records. */
export function totals(records, price) {
  const t = {calls: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, reasoning_reported: false, cost_usd: 0};
  for (const r of records) {
    if (!r.usage) continue;
    t.calls++;
    t.input_tokens += r.usage.input_tokens || 0;
    t.output_tokens += r.usage.output_tokens || 0;
    if (r.usage.reasoning_tokens !== null && r.usage.reasoning_tokens !== undefined) {
      t.reasoning_tokens += r.usage.reasoning_tokens;
      t.reasoning_reported = true;
    }
    t.cost_usd += costOf(r.usage, price, r.time);
  }
  t.cost_usd = Math.round(t.cost_usd * 1e6) / 1e6;
  return t;
}
