// src/lib/litellm-client.ts
import { logger } from './logger';

export interface LLMConfig {
  geminiModel?: string;
  geminiApiKey?: string;
  rateLimitEnabled?: boolean;
  rateLimitDurationMs?: number;
  visionEnabled?: boolean;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const GEMINI_MIN_INTERVAL_MS = 1600;

let lastGeminiCallTime = 0;
let isGeminiRunning = false;
let geminiTaskQueue: (() => void)[] = [];

function processGeminiQueue() {
  if (isGeminiRunning || geminiTaskQueue.length === 0) return;
  isGeminiRunning = true;
  const next = geminiTaskQueue.shift();
  if (next) next();
}

// ── Gemini caller (primary) ──────────────────────────────────────
export function callGemini(
  messages: LLMMessage[],
  config: LLMConfig,
  jsonMode: boolean = false,
  signal?: AbortSignal,
): Promise<string> {
  const model = config.geminiModel || 'gemini-3.1-flash-lite';
  return new Promise((resolve, reject) => {
    geminiTaskQueue.push(async () => {
      try {
        const result = await executeGemini(messages, config, model, jsonMode, signal, 3);
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        isGeminiRunning = false;
        processGeminiQueue();
      }
    });
    processGeminiQueue();
  });
}

// ── Gemini vision caller (multimodal: text + screenshot) ─────────────────
export function callGeminiVision(
  textPrompt: string,
  screenshotBase64: string,
  config: LLMConfig,
  jsonMode: boolean = false,
  signal?: AbortSignal,
): Promise<string> {
  const messages = [{
    role: 'user' as const,
    content: [
      {
        type: 'text',
        text: textPrompt
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${screenshotBase64}`
        }
      }
    ] as any
  }];
  const model = config.geminiModel || 'gemini-3.1-flash-lite';
  return new Promise((resolve, reject) => {
    geminiTaskQueue.push(async () => {
      try {
        const result = await executeGemini(messages as any, config, model, jsonMode, signal, 3);
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        isGeminiRunning = false;
        processGeminiQueue();
      }
    });
    processGeminiQueue();
  });
}

async function executeGemini(
  messages: LLMMessage[],
  config: LLMConfig,
  model: string,
  jsonMode: boolean,
  signal?: AbortSignal,
  retries = 3
): Promise<string> {
  const apiKey = config.geminiApiKey;
  if (!apiKey) throw new Error("Gemini API key is missing. Please configure it in Settings.");
  const delayMs = config.rateLimitEnabled ? (config.rateLimitDurationMs || GEMINI_MIN_INTERVAL_MS) : 0;
  
  const now = Date.now();
  const elapsed = now - lastGeminiCallTime;
  if (elapsed < delayMs) {
    await new Promise(r => setTimeout(r, delayMs - elapsed));
  }
  lastGeminiCallTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
    if (signal.aborted) controller.abort();
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        ...(jsonMode && { response_format: { type: 'json_object' } })
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      if (res.status === 429 && retries > 0) {
        logger.warn('Gemini', `Rate limit hit. Retrying... (${retries} left)`);
        await new Promise(r => setTimeout(r, 3000));
        return executeGemini(messages, config, model, jsonMode, signal, retries - 1);
      }
      const errText = await res.text();
      logger.error('Gemini', `Gemini error ${res.status}`, errText);
      throw new Error(`Gemini error: ${res.status}`);
    }

    const data = await res.json();
    logger.debug('Gemini', 'Gemini response received');
    return data.choices[0].message.content;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError' && retries > 0 && !signal?.aborted) {
      logger.warn('Gemini', `Timeout. Retrying... (${retries} left)`);
      return executeGemini(messages, config, model, jsonMode, signal, retries - 1);
    }
    logger.error('Gemini', 'Gemini fetch failed', e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}
