import {refineAnswer} from '@webknox/ai-sdk';

// A change to a search card: its filters, sort, more results or one of its recipes. It needs no model turn.
// Your key stays here, so add your own auth and rate limits before this goes public.
export async function POST(request: Request) {
  const {question, locale, refine} = await request.json();
  try {
    return Response.json(await refineAnswer({question, locale, refine}));
  } catch (error) {
    return Response.json({error: error instanceof Error ? error.message : String(error)}, {status: 502});
  }
}
