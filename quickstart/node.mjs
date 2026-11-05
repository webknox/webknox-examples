// Ask one question and print the answer. Node 18 or later, no packages.
const response = await fetch('https://api.webknox.com/v2/answers', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.WEBKNOX_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({messages: [{role: 'user', content: 'What is the weather in Dresden?'}]}),
});

const answer = await response.json();
if (!response.ok) throw new Error(answer.error.message);

// matched is false when WebKnox has no answer: use your own model then.
console.log(answer.matched ? answer.text : 'No answer for this one.');
console.log(answer.card?.type);
