#!/bin/sh
# Ask one question. Get a key at https://webknox.com/console
curl -s https://api.webknox.com/v2/answers \
  -H "Authorization: Bearer $WEBKNOX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What is the weather in Dresden?"}]}'
