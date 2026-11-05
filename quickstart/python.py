"""Ask one question and print the answer. Python 3, no packages."""
import json
import os
import urllib.request

request = urllib.request.Request(
    "https://api.webknox.com/v2/answers",
    data=json.dumps({"messages": [{"role": "user", "content": "What is the weather in Dresden?"}]}).encode(),
    headers={
        "Authorization": f"Bearer {os.environ['WEBKNOX_API_KEY']}",
        "Content-Type": "application/json",
    },
)

with urllib.request.urlopen(request) as response:
    answer = json.load(response)

# matched is false when WebKnox has no answer: use your own model then.
print(answer["text"] if answer["matched"] else "No answer for this one.")
print(answer["card"]["type"] if answer["card"] else None)
