// One plain HTTP call per answer, per provider. Keys come from the environment only and are
// sent as headers, never in a URL. Every error text that is logged or saved goes through redact().

// Fixed on purpose: an ANTHROPIC_BASE_URL in the environment (a proxy or another tool's setting)
// is ignored, so the benchmark always reaches Anthropic's own API.
const BASE = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  together: 'https://api.together.xyz/v1',
};
const KEY_ENV = {openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', together: 'TOGETHER_API_KEY'};
// Required by the Messages API. Thinking counts against it, so it is far above a JSON answer's
// size; only the tokens used are billed.
export const ANTHROPIC_MAX_TOKENS = 8192;
const TIMEOUT_MS = 180_000;

function key(provider) {
  const value = process.env[KEY_ENV[provider]];
  if (!value) throw new Error(`${KEY_ENV[provider]} is not set`);
  return value;
}

function headers(provider) {
  switch (provider) {
    case 'anthropic':
      return {'x-api-key': key(provider), 'anthropic-version': '2023-06-01', 'content-type': 'application/json'};
    case 'gemini':
      return {'x-goog-api-key': key(provider), 'content-type': 'application/json'};
    default:
      return {authorization: `Bearer ${key(provider)}`, 'content-type': 'application/json'};
  }
}

/**
 * The names of the key variables whose value appears in `text`, and whether anything looks like
 * a key (the patterns redact() removes). Never returns a value.
 */
export function keysIn(text) {
  const s = String(text);
  const names = Object.values(KEY_ENV).filter((name) => {
    const value = process.env[name];
    return value && value.length >= 8 && s.includes(value);
  });
  return {names, pattern: /\b(sk|gsk|tgp|AIza)[-_A-Za-z0-9]{16,}/.test(s)};
}

/** The key variables that are set, by name only. */
export function keysSet() {
  return Object.values(KEY_ENV).filter((name) => (process.env[name] || '').length >= 8);
}

/** Replaces every API key value found in `text` with [redacted]. */
export function redact(text) {
  let out = String(text);
  for (const name of Object.values(KEY_ENV)) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join('[redacted]');
  }
  return out.replace(/\b(sk|gsk|tgp|AIza)[-_A-Za-z0-9]{16,}/g, '[redacted]');
}

export class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${redact(body).slice(0, 500)}`);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with retries for network errors, timeouts, 429 and 5xx only (exponential backoff with
 * jitter, Retry-After honoured). Returns {json, attempts}. Any other status throws at once.
 */
export async function request(url, init, {retries = 5, fetchImpl = fetch, baseDelayMs = 2000} = {}) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {...init, signal: AbortSignal.timeout(TIMEOUT_MS)});
    } catch (error) {
      if (attempt > retries) throw new Error(`network: ${redact(error.message)}`);
      await sleep(backoff(attempt, null, baseDelayMs));
      continue;
    }
    const text = await response.text();
    if (response.ok) return {json: JSON.parse(text), attempts: attempt};
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt > retries) throw new HttpError(response.status, text);
    await sleep(backoff(attempt, response.headers.get('retry-after'), baseDelayMs));
  }
}

function backoff(attempt, retryAfter, baseDelayMs) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 120_000);
  return Math.min(baseDelayMs * 2 ** (attempt - 1), 60_000) * (0.75 + Math.random() * 0.5);
}

/** Lists a provider's model ids (free calls). */
export async function listModels(provider) {
  const h = headers(provider);
  if (provider === 'anthropic') {
    const {json} = await request(`${BASE.anthropic}/models?limit=1000`, {headers: h});
    return json.data.map((m) => ({id: m.id, name: m.display_name, created: m.created_at}));
  }
  if (provider === 'gemini') {
    const {json} = await request(`${BASE.gemini}/models?pageSize=1000`, {headers: h});
    return json.models
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({id: m.name.replace(/^models\//, ''), name: m.displayName}));
  }
  const {json} = await request(`${BASE[provider]}/models`, {headers: h});
  const list = Array.isArray(json) ? json : json.data;
  return list.map((m) => ({
    id: m.id,
    created: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : undefined,
    type: m.type,
    pricing: m.pricing,
  }));
}

/**
 * Sends one user message, with no system prompt and no tools. `model` is an entry of
 * models.json. Returns {text, usage, finish_reason, response_model, attempts}.
 */
export async function ask(model, prompt, options = {}) {
  const h = headers(model.provider);
  if (model.provider === 'anthropic') {
    const body = {model: model.id, max_tokens: ANTHROPIC_MAX_TOKENS, messages: [{role: 'user', content: prompt}]};
    if (model.temperature !== null) body.temperature = model.temperature;
    const {json, attempts} = await request(`${BASE.anthropic}/messages`, {method: 'POST', headers: h, body: JSON.stringify(body)}, options);
    const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const u = json.usage || {};
    return {
      text,
      finish_reason: json.stop_reason,
      response_model: json.model,
      attempts,
      usage: {
        input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
        // output_tokens already includes the thinking tokens.
        output_tokens: u.output_tokens || 0,
        reasoning_tokens: u.output_tokens_details?.thinking_tokens ?? null,
        reported: u,
      },
    };
  }
  if (model.provider === 'gemini') {
    const body = {contents: [{role: 'user', parts: [{text: prompt}]}]};
    if (model.temperature !== null) body.generationConfig = {temperature: model.temperature};
    const url = `${BASE.gemini}/models/${encodeURIComponent(model.id)}:generateContent`;
    const {json, attempts} = await request(url, {method: 'POST', headers: h, body: JSON.stringify(body)}, options);
    const candidate = (json.candidates || [])[0] || {};
    const text = (candidate.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    const u = json.usageMetadata || {};
    // Thinking tokens are billed as output, on top of candidatesTokenCount.
    return {
      text,
      finish_reason: candidate.finishReason ?? json.promptFeedback?.blockReason ?? null,
      response_model: json.modelVersion,
      attempts,
      usage: {
        input_tokens: u.promptTokenCount || 0,
        output_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
        reasoning_tokens: u.thoughtsTokenCount ?? null,
        reported: u,
      },
    };
  }
  // OpenAI and Together: Chat Completions.
  const body = {model: model.id, messages: [{role: 'user', content: prompt}]};
  if (model.temperature !== null) body.temperature = model.temperature;
  const {json, attempts} = await request(`${BASE[model.provider]}/chat/completions`, {method: 'POST', headers: h, body: JSON.stringify(body)}, options);
  const choice = (json.choices || [])[0] || {};
  const u = json.usage || {};
  // completion_tokens already includes any reasoning tokens.
  return {
    text: choice.message?.content ?? '',
    finish_reason: choice.finish_reason ?? null,
    response_model: json.model,
    attempts,
    usage: {
      input_tokens: u.prompt_tokens || 0,
      output_tokens: u.completion_tokens || 0,
      reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens ?? null,
      reported: u,
    },
  };
}
