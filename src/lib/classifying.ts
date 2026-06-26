// src/lib/classifying.ts
import { callLLM, callZAI, callNVIDIA } from './litellm-client';
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
}

const CLASSIFIER_PROMPT = `
You are a browser action classifier. Return ONLY valid JSON, no markdown.

Page: {{url}} — "{{title}}"
Recent History:
{{history}}

User said: "{{transcript}}"

Analyze the user's intent and return a JSON object with the following schema:
- "intent_evaluation": Your detailed internal analysis of the raw transcript. Evaluate if there are phonetic Speech-to-Text errors. If the literal text makes no logical sense in the current environment but a phonetically similar phrase does, state the correction.
- "type": Must be "generic", "task", "confirmation", or "cancellation".
- "ambiguity": Must be "clear" or "ambiguous".
- "scope": Must be "single" or "multi-step".
- "risk": Must be "low" or "high".
- "summary": A clean, direct one-sentence description of what the user wants to accomplish. (Auto-corrected if necessary. Empty string if generic/confirmation/cancellation). DO NOT prefix with "The user wants to".
- "clarification_question": Conversational question text if ambiguous, null otherwise.

Rules for "type":
- "confirmation": The user is answering "yes" or confirming a previous question from the assistant in the history.
- "cancellation": The user is answering "no", "stop", or cancelling a previous action.
- "task": The user wants to perform an action on the page, navigate, or find information.
- "generic": Small talk, conversational, or unrelated statements.

Risk Assessment:
- HIGH risk: financial transactions, sending emails/messages, account deletions, irreversible changes.
- LOW risk: Navigation (going to URLs), searching, clicking normal links, reading, media control.
- Ambiguous means proceeding would likely produce the WRONG outcome or you cannot confidently guess the typo. Ask a clarifying question if ambiguous.

Return EXACTLY this JSON structure:
{
  "intent_evaluation": "...",
  "type": "task",
  "ambiguity": "clear",
  "scope": "single",
  "risk": "low",
  "summary": "...",
  "clarification_question": null
}
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

  let responseText: string;
  if (config.nvidiaApiKey) {
    responseText = await callNVIDIA(
      [{ role: 'user', content: prefix + prompt }],
      config.nvidiaApiKey,
      'meta/llama-3.1-8b-instruct',
      true,
      signal
    );
  } else if (config.zaiApiKey) {
    responseText = await callZAI(
      [{ role: 'user', content: prefix + prompt }],
      config.zaiApiKey,
      'glm-4.7-flash',
      true,
      signal
    );
  } else {
    responseText = await callLLM(
      [{ role: 'user', content: prefix + prompt }],
      config,
      'meta-llama/llama-3.1-8b-instruct',
      true,
      signal,
      'fast'
    );
  }
  
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
