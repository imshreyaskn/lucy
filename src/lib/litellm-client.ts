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

// NVIDIA NIM rate limits (free tier):
//   - 40 RPM = one request every 1500ms minimum
//   - Credit-based, not daily-capped — best for consistent throughput
//
// Z.ai rate limits (free tier, fallback):
//   - 1 concurrent request (no RPM cap)
//   - Serial queue enforces the concurrency limit
//   - On timeout: wait 10s before retry (let original slot expire)
//   - On 429: exponential backoff 5s, 10s, 20s
//
// OpenRouter rate limits (free tier, last resort):
//   - 20 RPM = one request every 3000ms minimum
const NVIDIA_MIN_INTERVAL_MS = 1600;  // ~37.5 RPM — safely under 40 RPM limit
const OPENROUTER_MIN_INTERVAL_MS = 3100; // ~19.4 RPM — safely under 20 RPM limit
const ZAI_TIMEOUT_MS = 30000;
const ZAI_TIMEOUT_BACKOFF_MS = 10000;
const ZAI_429_BASE_BACKOFF_MS = 5000;

let lastNvidiaCallTime = 0;
let lastOpenRouterCallTime = 0;
let nvidiaQueue: Promise<string | void> = Promise.resolve();
let openRouterQueue = Promise.resolve();
let zaiQueue: Promise<string | void> = Promise.resolve();


// ── NVIDIA NIM native caller (primary) ──────────────────────────────────────
export function callNVIDIA(
  messages: LLMMessage[],
  apiKey: string,
  model: string = 'meta/llama-3.1-70b-instruct',
  jsonMode: boolean = false,
  signal?: AbortSignal,
): Promise<string> {
  const task = nvidiaQueue.then(() => executeNVIDIA(messages, apiKey, model, jsonMode, signal, 3));
  nvidiaQueue = task.catch(() => {});
  return task;
}

// ── NVIDIA NIM vision caller (multimodal: text + screenshot) ─────────────────
export function callNVIDIAVision(
  textPrompt: string,
  screenshotBase64: string,
  apiKey: string,
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
          url: `data:image/png;base64,${screenshotBase64}`
        }
      }
    ] as any
  }];
  const task = nvidiaQueue.then(() => executeNVIDIA(messages as any, apiKey, 'meta/llama-3.2-90b-vision-instruct', jsonMode, signal, 3));
  nvidiaQueue = task.catch(() => {});
  return task;
}


async function executeNVIDIA(
  messages: LLMMessage[],
  apiKey: string,
  model: string,
  jsonMode: boolean,
  signal?: AbortSignal,
  retries = 3
): Promise<string> {
  const now = Date.now();
  const elapsed = now - lastNvidiaCallTime;
  if (elapsed < NVIDIA_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, NVIDIA_MIN_INTERVAL_MS - elapsed));
  }
  lastNvidiaCallTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
    if (signal.aborted) controller.abort();
  }

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        max_tokens: 1024,
        ...(jsonMode && { response_format: { type: 'json_object' } })
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      if (res.status === 429 && retries > 0) {
        logger.warn('NVIDIA', `Rate limit hit. Retrying... (${retries} left)`);
        await new Promise(r => setTimeout(r, 3000));
        return executeNVIDIA(messages, apiKey, model, jsonMode, signal, retries - 1);
      }
      const errText = await res.text();
      logger.error('NVIDIA', `NIM error ${res.status}`, errText);
      throw new Error(`NVIDIA NIM error: ${res.status}`);
    }

    const data = await res.json();
    logger.debug('NVIDIA', 'NIM response received');
    return data.choices[0].message.content;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError' && retries > 0 && !signal?.aborted) {
      logger.warn('NVIDIA', `Timeout. Retrying... (${retries} left)`);
      return executeNVIDIA(messages, apiKey, model, jsonMode, signal, retries - 1);
    }
    logger.error('NVIDIA', 'NIM fetch failed', e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Z.ai caller (fallback) ───────────────────────────────────────────────────
export function callZAI(
  messages: LLMMessage[],
  apiKey: string,
  model: string = 'glm-4.7-flash',
  jsonMode: boolean = false,
  signal?: AbortSignal,
): Promise<string> {
  const task = zaiQueue.then(() => executeZAI(messages, apiKey, model, jsonMode, signal, 3));
  zaiQueue = task.catch(() => {});
  return task;
}

// ── Z.ai vision caller ───────────────────────────────────────────────────────
export function callZAIVision(
  textPrompt: string,
  screenshotBase64: string,
  apiKey: string,
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
  const task = zaiQueue.then(() => executeZAI(messages as any, apiKey, 'glm-4v-flash', jsonMode, signal, 3));
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

// ── OpenRouter caller (last resort) ─────────────────────────────────────────
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

// ── OpenRouter vision caller ─────────────────────────────────────────────────
export async function callLLMVision(
  textPrompt: string,
  screenshotBase64: string,
  config: LLMConfig,
  jsonMode: boolean = false,
  signal?: AbortSignal,
): Promise<string> {
  if (!config.openRouterApiKey) throw new Error('OpenRouter API key not configured');

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

  return new Promise((resolve, reject) => {
    const task = openRouterQueue
      .then(() => executeOpenRouter(messages as any, config, 'google/gemini-2.5-flash', jsonMode, signal, 3))
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
  const delayMs = config.rateLimitDurationMs ?? OPENROUTER_MIN_INTERVAL_MS;
  const elapsed = Date.now() - lastOpenRouterCallTime;
  if (elapsed < delayMs) {
    await new Promise(r => setTimeout(r, delayMs - elapsed));
  }
  lastOpenRouterCallTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
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
