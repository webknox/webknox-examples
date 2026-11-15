import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildPrompt} from '../lib/ask.mjs';
import {keysIn, keysSet, redact, request} from '../lib/providers.mjs';

function fakeFetch(steps) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const step = steps.shift();
    if (step instanceof Error) throw step;
    return new Response(JSON.stringify(step.body ?? {}), {status: step.status, headers: step.headers});
  };
  return {impl, calls};
}

test('retries network errors, 429 and 5xx, then returns the answer', async () => {
  const {impl, calls} = fakeFetch([new Error('ECONNRESET'), {status: 429}, {status: 503}, {status: 200, body: {ok: true}}]);
  const {json, attempts} = await request('https://example.test', {}, {fetchImpl: impl, baseDelayMs: 1});
  assert.deepEqual(json, {ok: true});
  assert.equal(attempts, 4);
  assert.equal(calls.length, 4);
});

test('does not retry other errors', async () => {
  const {impl, calls} = fakeFetch([{status: 400, body: {error: 'bad temperature'}}]);
  await assert.rejects(request('https://example.test', {}, {fetchImpl: impl, baseDelayMs: 1}), (e) => e.status === 400 && /bad temperature/.test(e.message));
  assert.equal(calls.length, 1);
});

test('gives up after the last retry', async () => {
  const {impl, calls} = fakeFetch([{status: 500}, {status: 500}, {status: 500}]);
  await assert.rejects(request('https://example.test', {}, {fetchImpl: impl, baseDelayMs: 1, retries: 2}), (e) => e.status === 500);
  assert.equal(calls.length, 3);
});

test('keys are redacted from error text', () => {
  const saved = process.env.TOGETHER_API_KEY;
  process.env.TOGETHER_API_KEY = 'tgp_v1_secretsecretsecret';
  try {
    assert.equal(redact('bad key tgp_v1_secretsecretsecret here'), 'bad key [redacted] here');
    assert.equal(redact('Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuv'), 'Incorrect API key provided: [redacted]');
  } finally {
    if (saved === undefined) delete process.env.TOGETHER_API_KEY;
    else process.env.TOGETHER_API_KEY = saved;
  }
});

test('keysIn names the key variables found in a text, never their values', () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'gemini-secret-value-123';
  try {
    assert.deepEqual(keysIn('{"response_text": "fine"}'), {names: [], pattern: false});
    assert.deepEqual(keysIn('leaked gemini-secret-value-123 here'), {names: ['GEMINI_API_KEY'], pattern: false});
    assert.equal(keysIn('header AIzaSyAbcdefghijklmnopqrstu').pattern, true);
    assert.ok(keysSet().includes('GEMINI_API_KEY'));
    assert.equal(JSON.stringify(keysIn('x gemini-secret-value-123')).includes('secret'), false);
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  }
});

test('the prompt names the food by its description, quoted', () => {
  const p = buildPrompt('Per 100 g of "{description}".\n', 'Beef, trimmed to 0" fat, raw');
  assert.equal(p, 'Per 100 g of "Beef, trimmed to 0" fat, raw".');
});
