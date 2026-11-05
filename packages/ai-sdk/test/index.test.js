import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateText, isStepCount} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {askWebknox, forModel, WebKnoxError} from '../src/index.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url))).response;
const weather = fixture('weather');

/** A fetch that records its calls and answers with `body`. */
function stub(body, status = 200) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({url, init, body: JSON.parse(init.body)});
    return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  };
  return {calls, fetch};
}

const usage = {inputTokens: {total: 1}, outputTokens: {total: 1}};

/** A model that asks the tool once, then answers. */
function modelCallingTool(question) {
  let step = 0;
  const prompts = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({prompt}) => {
      prompts.push(prompt);
      step += 1;
      return step === 1
        ? {
            content: [{type: 'tool-call', toolCallId: 'call-1', toolName: 'askWebknox', input: JSON.stringify({question})}],
            finishReason: {unified: 'tool-calls', raw: undefined},
            usage,
            warnings: [],
          }
        : {content: [{type: 'text', text: 'Take a jacket.'}], finishReason: {unified: 'stop', raw: undefined}, usage, warnings: []};
    },
  });
  return {model, prompts};
}

test('the tool sends the question and keeps the whole answer for the UI', async () => {
  const {calls, fetch} = stub(weather);
  const answer = await askWebknox({apiKey: 'k', fetch, locale: 'de', accept: ['weather.forecast']}).execute({question: 'Wetter in Dresden'}, {});
  assert.equal(calls[0].url, 'https://api.webknox.com/v2/answers');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.deepEqual(calls[0].body, {messages: [{role: 'user', content: 'Wetter in Dresden'}], locale: 'de', accept: ['weather.forecast']});
  assert.deepEqual(answer, weather);
});

test('an agent gets the text and sources, and the result keeps the card', async () => {
  const {fetch} = stub(weather);
  const {model, prompts} = modelCallingTool('What is the weather in Dresden?');
  const result = await generateText({
    model,
    prompt: 'Do I need a jacket in Dresden?',
    tools: {askWebknox: askWebknox({apiKey: 'k', fetch})},
    stopWhen: isStepCount(3),
  });
  assert.equal(result.text, 'Take a jacket.');
  const toolResult = result.steps[0].toolResults[0];
  assert.equal(toolResult.output.card.type, 'weather.forecast', 'the UI gets the card');
  const sent = JSON.stringify(prompts[1]);
  assert.ok(sent.includes(weather.text.slice(0, 30).replace(/"/g, '\\"')), 'the model reads the text');
  assert.ok(sent.includes('already sees this as a card'));
  assert.ok(!sent.includes('"forecast"') && !sent.includes(JSON.stringify(weather.card.data).slice(0, 40)), 'and not the card data');
});

test('a question without an answer goes back to the model', () => {
  assert.match(forModel({matched: false, reason: 'no_rich_answer', text: null, card: null, sources: []}), /Answer from what you know/);
});

test('an answer without a card says nothing about a card', () => {
  const text = forModel({matched: true, text: '12', card: null, sources: [{name: 'WebKnox'}]});
  assert.equal(text, '12\nSources: WebKnox.');
});

test('a refused request says why', async () => {
  const {fetch} = stub({error: {code: 'quota_exceeded', message: 'No tokens left today', retry_after_s: 3600}}, 429);
  await assert.rejects(askWebknox({apiKey: 'k', fetch}).execute({question: 'x'}, {}), (error) => {
    assert.ok(error instanceof WebKnoxError);
    assert.equal(error.status, 429);
    assert.equal(error.code, 'quota_exceeded');
    assert.equal(error.retryAfterS, 3600);
    assert.equal(error.message, 'No tokens left today');
    return true;
  });
});

test('a refused request reaches the model as a failed tool call', async () => {
  const {fetch} = stub({error: {code: 'quota_exceeded', message: 'No tokens left today', retry_after_s: 3600}}, 429);
  const {model, prompts} = modelCallingTool('Weather in Dresden');
  const result = await generateText({
    model,
    prompt: 'Weather in Dresden?',
    tools: {askWebknox: askWebknox({apiKey: 'k', fetch})},
    stopWhen: isStepCount(3),
  });
  assert.equal(result.text, 'Take a jacket.', 'the model still answers');
  assert.match(JSON.stringify(prompts[1]), /No tokens left today/);
});

test('a failure without JSON still gives an error', async () => {
  const fetch = async () => new Response('<html>Bad gateway</html>', {status: 502});
  await assert.rejects(askWebknox({apiKey: 'k', fetch}).execute({question: 'x'}, {}), /WebKnox answered 502/);
});

test('no key says where to get one, before any request', async () => {
  const saved = process.env.WEBKNOX_API_KEY;
  delete process.env.WEBKNOX_API_KEY;
  const {calls, fetch} = stub(weather);
  await assert.rejects(askWebknox({fetch}).execute({question: 'x'}, {}), /webknox\.com\/console/);
  assert.equal(calls.length, 0);
  if (saved != null) process.env.WEBKNOX_API_KEY = saved;
});

test('the key comes from the environment when none is passed', async () => {
  process.env.WEBKNOX_API_KEY = 'from-env';
  const {calls, fetch} = stub(weather);
  await askWebknox({fetch}).execute({question: 'x'}, {});
  assert.equal(calls[0].init.headers.Authorization, 'Bearer from-env');
  delete process.env.WEBKNOX_API_KEY;
});

test('the question is one trimmed line the model must fill in', () => {
  const {inputSchema} = askWebknox({apiKey: 'k'});
  assert.equal(inputSchema.parse({question: '  Weather in Rome  '}).question, 'Weather in Rome');
  assert.throws(() => inputSchema.parse({question: '  '}));
  assert.throws(() => inputSchema.parse({question: 'x'.repeat(1001)}));
});
