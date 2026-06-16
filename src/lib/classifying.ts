// src/lib/classifying.ts
import { callLLM } from './litellm-client';
import type { LLMConfig } from './litellm-client';
import type { BackgroundContext } from './system-prompt';
import { buildBgCtxSummary } from './system-prompt';

export interface Classification {
  intent_evaluation: string;
  type: 'generic' | 'task' | 'confirmation' | 'cancellation';
  ambiguity: 'clear' | 'ambiguous';
  scope: 'single' | 'multi-step';
  risk: 'low' | 'high';
  summary: string;
  clarification_question: string | null;
  requires_vision: boolean;
}

const CLASSIFIER_PROMPT = `
You are a browser action classifier. Return ONLY valid JSON, no markdown.

Page: {{url}} — "{{title}}"
Recent History:
{{history}}

User said: "{{transcript}}"

Classify and return exactly this JSON structure:
{
  "intent_evaluation": "Analyze the raw transcript against the semantic context of the current webpage. Evaluate if the transcript contains phonetic Speech-to-Text errors. If the literal text makes no logical sense in the current environment but a phonetically similar phrase does, state the correction. If the intent is entirely ambiguous or unsafe to guess, mark it as ambiguous.",
  "type": "generic" | "task" | "confirmation" | "cancellation",
  "ambiguity": "clear" | "ambiguous",
  "scope": "single" | "multi-step",
  "risk": "low" | "high",
  "summary": "one-sentence task description (auto-corrected if necessary, empty string if generic/confirmation/cancellation)",
  "clarification_question": "conversational question text if ambiguous, null otherwise",
  "requires_vision": boolean (Set to true ONLY if the user's request requires visually analyzing page aesthetics, layout, colors, or images. Set to false for standard text reading and navigation.)
}

Rules for "type":
- "confirmation": The user is answering "yes" or confirming a previous question from the assistant in the history.
- "cancellation": The user is answering "no", "stop", or cancelling a previous action.
- "task": The user wants to perform an action on the page.
- "generic": Small talk, conversational, or unrelated statements.

Risk Assessment:
- HIGH risk: financial transactions, sending emails/messages, account deletions, irreversible changes.
- LOW risk: Navigation (going to URLs), searching, clicking normal links, reading, media control.
- Ambiguous means proceeding would likely produce the WRONG outcome or you cannot confidently guess the typo. Ask a clarifying question if ambiguous.
`;

export async function classifyTranscript(
  transcript: string, 
  url: string, 
  title: string, 
  historySummary: string,
  config: LLMConfig,
  bgCtx: BackgroundContext | null,
  signal?: AbortSignal,
  isRetry = false
): Promise<Classification> {
  let prompt = CLASSIFIER_PROMPT
    .replace('{{url}}', () => url)
    .replace('{{title}}', () => title)
    .replace('{{history}}', () => historySummary)
    .replace('{{transcript}}', () => transcript);

  if (bgCtx) {
    prompt += buildBgCtxSummary(bgCtx);
  }

  const prefix = isRetry ? "Return ONLY raw JSON. No backticks. No explanation.\n\n" : "";

  const responseText = await callLLM(
    [{ role: 'user', content: prefix + prompt }], 
    config, 
    'meta-llama/llama-3.1-8b-instruct', 
    true,
    signal,
    'fast'
  );
  
  try {
    const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned) as Classification;
  } catch (err) {
    if (!isRetry) {
      return classifyTranscript(transcript, url, title, historySummary, config, bgCtx, signal, true);
    }
    throw new Error('Failed to parse classification JSON');
  }
}
