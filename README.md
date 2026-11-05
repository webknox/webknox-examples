# WebKnox examples

<img src="assets/logo.png" alt="" width="72" align="right">

[WebKnox](https://webknox.com) is an API that turns a chat question into a sourced, typed UI card: weather, nutrition, recipes, comparisons with photos, translations, maths, media and more, for chat apps, assistants and displays.

This repo holds what you need to try it: quickstarts, the AI SDK tool, a chat app and the MCP server's listing files. The API and the cards themselves are documented at [webknox.com/docs](https://webknox.com/docs).

## Try it

Get a key at [webknox.com/console](https://webknox.com/console), then:

```bash
export WEBKNOX_API_KEY=your-key
sh quickstart/curl.sh
```

| | |
|---|---|
| [`quickstart/`](quickstart) | One question from curl, Node and Python, with no packages |
| [`packages/ai-sdk/`](packages/ai-sdk) | [`@webknox/ai-sdk`](https://www.npmjs.com/package/@webknox/ai-sdk): a tool for the Vercel AI SDK |
| [`examples/nextjs-chat/`](examples/nextjs-chat) | A chat app that shows answers as cards |

To show a card, use [`@webknox/elements`](https://www.npmjs.com/package/@webknox/elements), a web component that draws every card type in any framework.

## In an AI app

WebKnox is also a remote MCP server, so you can add it to Claude, ChatGPT, Claude Code, Codex, Cursor or VS Code without writing any code:

```
https://mcp.webknox.com/mcp
```

No key is needed for 10 answers with a card a day. See [the MCP docs](https://webknox.com/docs/mcp). [`server.json`](server.json) is its entry in the [MCP Registry](https://registry.modelcontextprotocol.io), where it is `com.webknox/webknox`, and [`llms-install.md`](llms-install.md) tells coding agents how to add it.

## License

[MIT](LICENSE). The API has its own [terms](https://webknox.com/terms).
