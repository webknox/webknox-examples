'use client';

import {useChat} from '@ai-sdk/react';
import {useState, type FormEvent} from 'react';
import type {WebKnoxAnswer} from '@webknox/ai-sdk';
import {AnswerCard} from './answer-card';

export default function Chat() {
  const {messages, sendMessage, status} = useChat();
  const [input, setInput] = useState('');
  const ask = (text: string) => sendMessage({text});

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    ask(input);
    setInput('');
  }

  return (
    <main>
      {messages.map((message) => (
        <section key={message.id} className={message.role}>
          {message.parts.map((part, index) => {
            if (part.type === 'text') return <p key={index}>{part.text}</p>;
            if (part.type === 'tool-askWebknox' && part.state === 'output-available') {
              const answer = part.output as WebKnoxAnswer;
              return answer.card ? <AnswerCard key={index} answer={answer} onAsk={ask} /> : null;
            }
            return null;
          })}
        </section>
      ))}
      <form onSubmit={submit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="What is the weather in Dresden?"
          aria-label="Your question"
        />
        <button type="submit" disabled={status === 'submitted' || status === 'streaming'}>Ask</button>
      </form>
    </main>
  );
}
