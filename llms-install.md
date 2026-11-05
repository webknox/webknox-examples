# Installing the WebKnox MCP server

WebKnox is a remote MCP server, so there is nothing to install or run. Add this address as a Streamable HTTP server:

```
https://mcp.webknox.com/mcp
```

Most clients take it in a JSON file:

```json
{
  "mcpServers": {
    "webknox": {
      "url": "https://mcp.webknox.com/mcp"
    }
  }
}
```

In Claude Code:

```bash
claude mcp add --transport http webknox https://mcp.webknox.com/mcp
```

No key is needed for 10 answers with a card a day. After that, sign in with a WebKnox account (OAuth), or send an API key from https://webknox.com/console as `Authorization: Bearer <key>`.

The server has one tool, `ask_webknox`. To check the install, ask "What is the weather in Dresden?". A client that supports MCP Apps shows a card; others get the answer as text.

Docs: https://webknox.com/docs/mcp
