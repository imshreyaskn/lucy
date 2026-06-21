// src/lib/litellm-client.ts
import { logger } from './logger';

export interface LLMConfig {
  openRouterApiKey?: string;
  groqApiKey?: string;
  zaiApiKey?: string;
  nvidiaApiKey?: string;
  model?: string;
  rateLimitEnabled?: boolean;
  rateLimitDurationMs?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Z.ai rate limits:
//   - 1 concurrent request (no RPM cap)
//   - A serial queue ensures we never send two requests simultaneously,
//     which is the correct way to respect a concurrency-based limit.
//   - On timeout, wait 10s before retry to let the original request expire
//     on Z.ai's side before sending a new one.
//   - On 429, exponential backoff: 5s, 10s, 20s
//
// OpenRouter rate limits (free tier):
//   - 20 RPM = one request every 3000ms minimum
//   - 50 requests/day (1000/day with $10 topup)
const OPENROUTER_MIN_INTERVAL_MS = 3100; // ~19.4 RPM — safely under 20 RPM limit
const ZAI_TIMEOUT_MS = 30000;            // 30s — generous timeout for cold starts
const ZAI_TIMEOUT_BACKOFF_MS = 10000;    // wait 10s after a timeout before retry
const ZAI_429_BASE_BACKOFF_MS = 5000;    // exponential backoff base on 429: 5s, 10s, 20s

let lastOpenRouterCallTime = 0;
let openRouterQueue = Promise.resolve();

// Single serial queue for Z.ai — enforces the 1-concurrent-request limit
let zaiQueue: Promise<string | void> = Promise.resolve();

// ── Z.ai (GLM-4.7-Flash) native caller ──────────────────────────────────────
export function callZAI(
  messages: LLMMessage[],
  apiKey: string,
  model: string = 'glm-4.7-flash',
  jsonMode: boolean = false,
  signal?: AbortSignal,
): Promise<string> {
  // Enqueue: only one Z.ai request runs at a time
  const task = zaiQueue.then(() => executeZAI(messages, apiKey, model, jsonMode, signal, 3));
  zaiQueue = task.catch(() => {});
  return task;
}

async function executeZAI(
  messages: LLMMessage[],
  apiKey: string,
  model: string,
  jsonMode: boolean,
  signal?: AbortSignal,
  retries = 3
): Promise<string> {
  if (signal?.aborted) throw new Error('Aborted');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ZAI_TIMEOUT_MS);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
    if (signal.aborted) controller.abort();
  }

  try {
    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
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
        // Exponential backoff: 5s, 10s, 20s
        const backoff = ZAI_429_BASE_BACKOFF_MS * Math.pow(2, 3 - retries);
        logger.warn('ZAI', `Rate limit hit. Waiting ${backoff / 1000}s before retry... (${retries} left)`);
        await new Promise(r => setTimeout(r, backoff));
        return executeZAI(messages, apiKey, model, jsonMode, signal, retries - 1);
      }
      const errText = await res.text();
      logger.error('ZAI', `Z.ai error ${res.status}`, errText);
      throw new Error(`Z.ai error: ${res.status}`);
    }

    const data = await res.json();
    logger.debug('ZAI', 'Z.ai response received');
    return data.choices[0].message.content;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError' && retries > 0 && !signal?.aborted) {
      // Wait for Z.ai's side to release the slot before retrying
      logger.warn('ZAI', `Timeout. Waiting ${ZAI_TIMEOUT_BACKOFF_MS / 1000}s before retry... (${retries} left)`);
      await new Promise(r => setTimeout(r, ZAI_TIMEOUT_BACKOFF_MS));
      return executeZAI(messages, apiKey, model, jsonMode, signal, retries - 1);
    }
    logger.error('ZAI', 'Z.ai fetch failed', e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── OpenRouter caller (optional fallback) ────────────────────────────────────
export async function callLLM(
  messages: LLMMessage[],
  config: LLMConfig,
  model: string,
  jsonMode: boolean = false,
  signal?: AbortSignal,
  _queueType: 'default' | 'fast' = 'default'
): Promise<string> {
  if (!config.openRouterApiKey) throw new Error('OpenRouter API key not configured');

  return new Promise((resolve, reject) => {
    const task = openRouterQueue
      .then(() => executeOpenRouter(messages, config, model, jsonMode, signal, 3))
      .then(resolve)
      .catch(reject);
    openRouterQueue = task.catch(() => {});
  });
}

async function executeOpenRouter(
  messages: LLMMessage[],
  config: LLMConfig,
  model: string,
  jsonMode: boolean,
  parentSignal?: AbortSignal,
  retries = 3
): Promise<string> {
  const delayMs = config.rateLimitDurationMs !== undefined
    ? config.rateLimitDurationMs
    : OPENROUTER_MIN_INTERVAL_MS;

  const now = Date.now();
  const timeSinceLastCall = now - lastOpenRouterCallTime;
  if (timeSinceLastCall < delayMs) {
    await new Promise(r => setTimeout(r, delayMs - timeSinceLastCall));
  }
  lastOpenRouterCallTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  if (parentSignal) {
    parentSignal.addEventListener('abort', () => controller.abort());
    if (parentSignal.aborted) controller.abort();
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://lucy.app',
        'X-Title': 'Lucy Voice Extension'
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
        logger.warn('LiteLLM', `OpenRouter 429. Retrying... (${retries} left)`);
        return executeOpenRouter(messages, config, model, jsonMode, parentSignal, retries - 1);
      }
      const errText = await res.text();
      logger.error('LiteLLM', `OpenRouter error ${res.status}`, errText);
      throw new Error(`OpenRouter LLM error: ${res.status}`);
    }

    const data = await res.json();
    logger.debug('LiteLLM', 'OpenRouter response received');
    return data.choices[0].message.content;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError' && retries > 0 && !parentSignal?.aborted) {
      logger.warn('LiteLLM', `OpenRouter timeout. Retrying... (${retries} left)`);
      return executeOpenRouter(messages, config, model, jsonMode, parentSignal, retries - 1);
    }
    logger.error('LiteLLM', 'OpenRouter fetch failed', e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}
