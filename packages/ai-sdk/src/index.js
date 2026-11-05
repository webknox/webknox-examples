import {tool} from 'ai';
import {z} from 'zod';

const API = 'https://api.webknox.com';

const DESCRIPTION = [
  'Answers everyday questions with a sourced card the user sees in the chat: weather, nutrition, recipes, recipe, game and',
  'artwork searches, comparisons with photos, translations, definitions, conversions, maths, time and timers, sunrise and',
  'sunset, videos, music and radio, pictures, jokes, quotes and this day in history.',
  'Call it when the user asks for one of these, and answer anything else yourself.',
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

/**
 * The WebKnox tool for `generateText`, `streamText` and agents. Its result is the Answers API's answer: hand it to
 * `<webknox-answer>` to show the card.
 */
export function askWebknox({apiKey, baseUrl = API, locale, context, accept, render, fetch: fetchImpl = globalThis.fetch} = {}) {
  return tool({
    description: DESCRIPTION,
    inputSchema: z.object({question: z.string().trim().min(1).max(1000).describe(QUESTION)}),
    execute: async ({question}, {abortSignal} = {}) => {
      const key = apiKey ?? globalThis.process?.env?.WEBKNOX_API_KEY;
      if (!key) throw new WebKnoxError('No API key: set WEBKNOX_API_KEY or pass apiKey. Get one at https://webknox.com/console');
      const response = await fetchImpl(`${baseUrl}/v2/answers`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({messages: [{role: 'user', content: question}], locale, context, accept, render}),
        signal: abortSignal,
      });
      if (!response.ok) throw await refused(response);
      return response.json();
    },
    toModelOutput: ({output}) => ({type: 'text', value: forModel(output)}),
  });
}
