# Next.js chat with WebKnox cards

A small chat on the [AI SDK](https://ai-sdk.dev). When a question has a WebKnox answer, the app shows the card and the model adds only what the card doesn't say. Filters on a search card send a new message, so they work without any extra code.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Fill in `.env.local` first, then open http://localhost:3000 and try "What is the weather in Dresden?" or "Compare ravens and crows".

| File | What it does |
|---|---|
| `app/api/chat/route.ts` | Adds the `askWebknox` tool to the model |
| `app/page.tsx` | The chat: text parts as text, `askWebknox` results as cards |
| `app/answer-card.tsx` | Puts an answer into `<webknox-answer>` |
