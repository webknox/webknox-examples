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

/** One answer as its card. `onAsk` gets the sentence for a suggested question or a changed filter. */
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

  return <webknox-answer ref={ref} />;
}
