'use client';

import {useEffect, useRef, type DetailedHTMLProps, type HTMLAttributes} from 'react';
import type {WebKnoxAnswer} from '@webknox/ai-sdk';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'webknox-answer': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

type AnswerElement = HTMLElement & {answer: WebKnoxAnswer};

type Refine = {refine: Record<string, unknown>; done: () => void};

/** One answer as its card. `onAsk` gets a suggested question. A change to a search card updates it in place. */
export function AnswerCard({answer, onAsk}: {answer: WebKnoxAnswer; onAsk: (text: string) => void}) {
  const ref = useRef<AnswerElement>(null);

  useEffect(() => {
    // The element registers itself in the browser, so it can't load on the server.
    import('@webknox/elements');
  }, []);

  useEffect(() => {
    if (ref.current) ref.current.answer = answer;
  }, [answer]);

  useEffect(() => {
    const element = ref.current;
    const ask = (event: Event) => onAsk((event as CustomEvent<{text: string}>).detail.text);
    element?.addEventListener('webknox-follow-up', ask);
    return () => element?.removeEventListener('webknox-follow-up', ask);
  }, [onAsk]);

  useEffect(() => {
    const element = ref.current;
    let latest = 0;

    async function refine(event: Event) {
      event.preventDefault();
      const {refine, done} = (event as CustomEvent<Refine>).detail;
      const shown = element!.answer;
      const asked = ++latest;
      try {
        const response = await fetch('/api/refine', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({question: shown.card?.data.query ?? shown.text, locale: shown.locale, refine}),
        });
        if (!response.ok) throw new Error(String(response.status));
        const next = await response.json();
        // The last change wins: a slower answer to an earlier one is dropped.
        if (asked === latest) element!.answer = next;
      } catch {
        if (asked === latest) done();
      }
    }

    element?.addEventListener('webknox-refine', refine);
    return () => element?.removeEventListener('webknox-refine', refine);
  }, []);

  return <webknox-answer ref={ref} />;
}
