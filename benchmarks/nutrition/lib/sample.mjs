// Stratified, seeded sampling. The same foods and seed always give the same ordered list, and
// every prefix of that list (the 20-food pilot, say) keeps roughly the category shares.

/** mulberry32: a small 32-bit PRNG, returning numbers in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle of a copy. */
export function shuffle(items, random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Splits `total` across groups in proportion to their sizes (largest remainder). */
export function allocate(sizes, total) {
  const names = Object.keys(sizes).sort();
  const all = names.reduce((s, n) => s + sizes[n], 0);
  if (total >= all) return Object.fromEntries(names.map((n) => [n, sizes[n]]));
  const quota = names.map((n) => ({n, exact: (sizes[n] * total) / all}));
  const out = Object.fromEntries(quota.map((q) => [q.n, Math.floor(q.exact)]));
  let left = total - Object.values(out).reduce((s, v) => s + v, 0);
  const byRemainder = quota.slice().sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || (a.n < b.n ? -1 : 1));
  for (const q of byRemainder) {
    if (left === 0) break;
    out[q.n]++;
    left--;
  }
  return out;
}

/**
 * Draws `size` foods stratified by `category` with a fixed seed. Within a category the foods are
 * shuffled; the categories are then interleaved evenly (food j of k in a category sits at
 * (j + offset) / k), so the first n of the list hold about n * share of each category.
 */
export function stratifiedSample(foods, size, seed) {
  const random = rng(seed);
  const ordered = foods.slice().sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0) || (a.dataset < b.dataset ? -1 : a.dataset > b.dataset ? 1 : 0) || a.fdc_id - b.fdc_id);
  const groups = {};
  for (const f of ordered) (groups[f.category] ||= []).push(f);
  const sizes = Object.fromEntries(Object.entries(groups).map(([c, g]) => [c, g.length]));
  const take = allocate(sizes, size);
  const placed = [];
  for (const c of Object.keys(groups).sort()) {
    const chosen = shuffle(groups[c], random).slice(0, take[c]);
    const offset = random();
    chosen.forEach((f, j) => placed.push({f, key: (j + offset) / chosen.length, tie: random()}));
  }
  placed.sort((a, b) => a.key - b.key || a.tie - b.tie);
  return {foods: placed.map((p) => p.f), allocation: take};
}
