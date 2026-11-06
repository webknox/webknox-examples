import {convertToModelMessages, isStepCount, streamText, type UIMessage} from 'ai';
import {askWebknox} from '@webknox/ai-sdk';

// One object, so convertToModelMessages reads the tool's short model output for earlier turns too.
const tools = {askWebknox: askWebknox()};

export async function POST(request: Request) {
  const {messages}: {messages: UIMessage[]} = await request.json();

  const result = streamText({
    model: 'openai/gpt-5-mini',
    system: 'You are a helpful assistant. Use askWebknox for anything it covers, even in a follow-up and even if you could answer yourself. When a tool result says the user sees a card, keep your reply to one short sentence.',
    messages: await convertToModelMessages(messages, {tools}),
    tools,
    stopWhen: isStepCount(3),
  });

  return result.toUIMessageStreamResponse({
    // The real reason, for building. In production, log it and send something general.
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
