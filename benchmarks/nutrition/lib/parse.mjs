// Reads the seven values out of a model's answer text.
import {NUTRIENT_KEYS} from './usda.mjs';

const NUMBER = /^\s*(-?\d+(?:\.\d+)?|-?\d{1,3}(?:,\d{3})+(?:\.\d+)?)\s*(kcal|mg|g)?\s*$/i;
const REFUSAL = /\b(I can(?:not|'t)|I am unable|I'm unable|I am not able|I'm not able|I don't have|sorry)\b/i;

/** A number, or a string holding one number (with an optional unit), else undefined. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const m = value.match(NUMBER);
  return m ? Number(m[1].replace(/,/g, '')) : undefined;
}

/** Pieces of text that may hold the JSON object: fenced blocks first, then each {...} span. */
function candidates(text) {
  const out = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) out.push(m[1]);
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        out.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  return out;
}

/**
 * Parses an answer. Returns {values, missing, error}: `values` holds every key that came back as
 * a number, `missing` the keys that did not, and `error` is null, 'empty', 'refusal' or
 * 'no_json' when no JSON object with any of the keys was found.
 */
export function parseAnswer(text) {
  const all = {values: {}, missing: NUTRIENT_KEYS.slice()};
  if (!text || !text.trim()) return {...all, error: 'empty'};
  // Reasoning some open models print before the answer.
  const visible = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '');
  for (const piece of candidates(visible)) {
    let object;
    try {
      object = JSON.parse(piece.trim());
    } catch {
      continue;
    }
    if (!object || typeof object !== 'object' || Array.isArray(object)) continue;
    const lower = Object.fromEntries(Object.entries(object).map(([k, v]) => [k.toLowerCase().trim(), v]));
    if (!NUTRIENT_KEYS.some((k) => k in lower)) continue;
    const values = {};
    const missing = [];
    for (const k of NUTRIENT_KEYS) {
      const n = toNumber(lower[k]);
      if (n === undefined) missing.push(k);
      else values[k] = n;
    }
    return {values, missing, error: null};
  }
  return {...all, error: REFUSAL.test(visible) ? 'refusal' : 'no_json'};
}
