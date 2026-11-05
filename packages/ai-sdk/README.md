# @webknox/ai-sdk

WebKnox for the [AI SDK](https://ai-sdk.dev). One tool, `askWebknox`, answers everyday questions with a sourced card your app can show: weather, nutrition, recipes, comparisons with photos, translations, maths, media and [more](https://webknox.com/docs/cards).

```bash
npm install @webknox/ai-sdk
```

Set `WEBKNOX_API_KEY`, with a key from [the console](https://webknox.com/console), and add the tool:

```js
import {generateText, isStepCount} from 'ai';
import {askWebknox} from '@webknox/ai-sdk';

const {text, steps} = await generateText({
  model: 'openai/gpt-5-mini',
  prompt: 'Do I need an umbrella in Dresden tomorrow?',
  tools: {askWebknox: askWebknox()},
  stopWhen: isStepCount(3),
});

console.log(text);
```

## Showing the card

The tool's result is the whole [answer](https://webknox.com/docs/reference). Hand it to [`<webknox-answer>`](https://webknox.com/docs/rendering) from `@webknox/elements`:

```js
const element = document.createElement('webknox-answer');
element.answer = toolResult.output;
```

The model reads only the answer's text and sources, and is told the user already sees the card. That keeps a large card out of its context, and it won't read the card back. [The Next.js chat](https://github.com/webknox/webknox-examples/tree/main/examples/nextjs-chat) shows the whole loop.

## Options

```js
askWebknox({
  locale: 'de',                                        // en (default), de, fr, es, pt, it
  context: {timezone: 'Europe/Berlin', units: 'metric'},
  accept: ['weather.forecast', 'nutrition.facts'],     // card types your app can show
});
```

`apiKey`, `baseUrl`, `render` (hosted embeds and images, on Pro and Scale) and `fetch` work the same way. A question WebKnox can't answer comes back with `matched: false`, and the model answers it itself. A refused request throws a `WebKnoxError` with `status`, `code` and `retryAfterS`.

## License

MIT
