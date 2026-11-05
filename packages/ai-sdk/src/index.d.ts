import type {Tool} from 'ai';

/** Card types, `null` when the answer has none. New types can appear: see https://webknox.com/docs/cards */
export interface WebKnoxCard {
  type: string;
  version: number;
  data: Record<string, unknown>;
}

export interface WebKnoxSource {
  name: string;
  url?: string;
  license?: string;
}

/** An Answers API answer. New optional fields can appear: see https://webknox.com/docs/reference */
export interface WebKnoxAnswer {
  v: number;
  id: string;
  matched: boolean;
  reason?: string;
  locale: string;
  skill?: string;
  confidence?: number;
  text: string | null;
  speech?: string;
  card: WebKnoxCard | null;
  sources: WebKnoxSource[];
  follow_ups: string[];
  actions: Array<Record<string, unknown>>;
  usage: {billable: boolean};
  attribution?: {text: string; url: string};
  render?: {embed_url?: string; image_url?: string; expires_at: string};
}

export interface AskWebknoxOptions {
  /** Defaults to the WEBKNOX_API_KEY environment variable. */
  apiKey?: string;
  /** Defaults to https://api.webknox.com */
  baseUrl?: string;
  /** en (default), de, fr, es, pt or it: the language of the text and of localized card fields. */
  locale?: string;
  /** What to know about the user, for "today" and "here". */
  context?: {
    timezone?: string;
    now?: string;
    location?: {lat: number; lon: number};
    units?: 'metric' | 'imperial';
  };
  /** Card types your client can render. Omit it to accept all. */
  accept?: string[];
  /** Hosted render URLs, on Pro and Scale. */
  render?: {theme?: unknown; layout?: string; formats: Array<'embed' | 'image'>};
  /** Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
}

export function askWebknox(options?: AskWebknoxOptions): Tool<{question: string}, WebKnoxAnswer>;

/** What the model reads of an answer: its text and sources, not the card. */
export function forModel(answer: WebKnoxAnswer): string;

export class WebKnoxError extends Error {
  status?: number;
  code?: string;
  retryAfterS?: number;
}
