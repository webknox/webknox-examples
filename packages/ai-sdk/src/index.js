import {tool} from 'ai';
import {z} from 'zod';

const API = 'https://api.webknox.com';

const DESCRIPTION = [
  'Shows the user a sourced card in the chat, from live data: weather, nutrition, single recipes and recipe searches,',
  'game and artwork searches, comparisons with photos, translations, definitions, conversions, maths, time and timers,',
  'sunrise and sunset, videos, music and radio, pictures, jokes, quotes and this day in history.',
  'Call it whenever the user asks for one of these, even if you could answer from memory: real recipes with photos and',
  'filters beat a recipe you write yourself. Answer anything else yourself.',
].join(' ');

const QUESTION = 'The question as one self-contained sentence in the user\'s language that names the place, food or things it is about; a follow-up such as "and tomorrow?" written out as a full question.';

/** A request the API refused: `code` is its error code, `retryAfterS` is set on a 429. */
export class WebKnoxError extends Error {
  constructor(message, {status, code, retryAfterS} = {}) {
    super(message);
    this.name = 'WebKnoxError';
    this.status = status;
    this.code = code;
    this.retryAfterS = retryAfterS;
  }
}

/** What the model reads: the answer's text and sources. The card stays in the tool result, for the UI. */
export function forModel(answer) {
  if (!answer.matched) return 'WebKnox has no answer for this. Answer from what you know.';
  const sources = answer.sources.map((source) => source.name).filter(Boolean);
  return [
    answer.text,
    sources.length ? `Sources: ${sources.join(', ')}.` : null,
    answer.card ? 'The user already sees this as a card, so don\'t repeat it. Add only what the card doesn\'t say.' : null,
  ].filter(Boolean).join('\n');
}

async function refused(response) {
  const error = await response.json().then((body) => body?.error, () => null);
  return new WebKnoxError(error?.message || `WebKnox answered ${response.status}`, {
    status: response.status,
    code: error?.code,
    retryAfterS: error?.retry_after_s,
  });
}

/** One POST to the Answers API. */
async function post(body, {apiKey, baseUrl = API, fetch: fetchImpl = globalThis.fetch} = {}, signal) {
  const key = apiKey ?? globalThis.process?.env?.WEBKNOX_API_KEY;
  if (!key) throw new WebKnoxError('No API key: set WEBKNOX_API_KEY or pass apiKey. Get one at https://webknox.com/console');
  const response = await fetchImpl(`${baseUrl}/v2/answers`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await refused(response);
  return response.json();
}

/**
 * The WebKnox tool for `generateText`, `streamText` and agents. Its result is the Answers API's answer: hand it to
 * `<webknox-answer>` to show the card.
 */
export function askWebknox({locale, context, accept, render, ...connection} = {}) {
  return tool({
    description: DESCRIPTION,
    inputSchema: z.object({question: z.string().trim().min(1).max(1000).describe(QUESTION)}),
    execute: ({question}, {abortSignal} = {}) =>
      post({messages: [{role: 'user', content: question}], locale, context, accept, render}, connection, abortSignal),
    toModelOutput: ({output}) => ({type: 'text', value: forModel(output)}),
  });
}

/**
 * A change to a search card: `refine` from its `webknox-refine` event, for its filters, sort, more results or one of its
 * recipes. It goes straight to the API, so the card updates without a model turn. `question` is what the card answered.
 */
export function refineAnswer({question, locale, refine}, connection) {
  return post({messages: [{role: 'user', content: question}], locale, refine}, connection);
}
