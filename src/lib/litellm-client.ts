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

let lastCallTime = 0;
let defaultQueue = Promise.resolve();
let fastQueue = Promise.resolve();

// ── Z.ai (GLM-4.7-Flash) native caller ─────────────────────────────────────
export async function callZAI(
  messages: LLMMessage[],
  apiKey: string,
  model: string = 'glm-4.7-flash',
  jsonMode: boolean = false,
  signal?: AbortSignal,
  retries = 3
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
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
        logger.warn('ZAI', `Rate limit hit. Retrying... (${retries} left)`);
        await new Promise(r => setTimeout(r, 1000));
        return callZAI(messages, apiKey, model, jsonMode, signal, retries - 1);
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
      logger.warn('ZAI', `Timeout. Retrying... (${retries} left)`);
      return callZAI(messages, apiKey, model, jsonMode, signal, retries - 1);
    }
    logger.error('ZAI', 'Z.ai fetch failed', e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── OpenRouter caller (used for optional/fallback models) ───────────────────
export async function callLLM(
  messages: LLMMessage[],
  config: LLMConfig,
  model: string,
  jsonMode: boolean = false,
  signal?: AbortSignal,
  queueType: 'default' | 'fast' = 'default'
): Promise<string> {
  if (!config.openRouterApiKey) throw new Error('OpenRouter API key not configured');
  
  return new Promise((resolve, reject) => {
    const queue = queueType === 'fast' ? fastQueue : defaultQueue;
    const task = queue.then(() => executeOpenRouter(messages, config, model, jsonMode, signal, 3))
      .then(resolve)
      .catch(reject);
    
    if (queueType === 'fast') fastQueue = task.catch(() => {});
    else defaultQueue = task.catch(() => {});
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
  const isRateLimited = config.rateLimitEnabled !== false;
  const delayMs = config.rateLimitDurationMs !== undefined ? config.rateLimitDurationMs : 2100;
  
  if (isRateLimited) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    if (timeSinceLastCall < delayMs) {
      await new Promise(r => setTimeout(r, delayMs - timeSinceLastCall));
    }
    lastCallTime = Date.now();
  }

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
        logger.warn('LiteLLM', `OpenRouter 429 rate limit hit. Queueing retry... (${retries} left)`);
        return executeOpenRouter(messages, config, model, jsonMode, parentSignal, retries - 1);
      }
      const errText = await res.text();
      logger.error('LiteLLM', `OpenRouter LLM error ${res.status}`, errText);
      throw new Error(`OpenRouter LLM error: ${res.status}`);
    }
    const data = await res.json();
    logger.debug('LiteLLM', 'OpenRouter Response received');
    return data.choices[0].message.content;
  } catch(e) {
    if (e instanceof Error && e.name === 'AbortError' && retries > 0 && !parentSignal?.aborted) {
      logger.warn('LiteLLM', `OpenRouter timeout hit. Queueing retry... (${retries} left)`);
      return executeOpenRouter(messages, config, model, jsonMode, parentSignal, retries - 1);
    }
    logger.error('LiteLLM', 'OpenRouter fetch failed', e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}
