// src/lib/history-manager.ts
import { callLLM, callZAI } from './litellm-client';
import type { LLMMessage, LLMConfig } from './litellm-client';

export class HistoryManager {
  private history: LLMMessage[] = [];
  private longTermMemories: string[] = [];

  // Private constructor — use HistoryManager.create() to get an initialized instance.
  // This prevents the async constructor race condition where loadHistory() was fire-and-forget.
  private constructor() {}

  public static async create(): Promise<HistoryManager> {
    const mgr = new HistoryManager();
    await mgr.loadHistory();
    return mgr;
  }

  private async loadHistory() {
    const data = await chrome.storage.session.get(['chatHistory']);
    if (data && Array.isArray(data.chatHistory)) {
      this.history = data.chatHistory;
    }
    const local = await chrome.storage.local.get(['longTermMemories']);
    if (local && Array.isArray(local.longTermMemories)) {
      this.longTermMemories = local.longTermMemories;
    }
  }

  private async saveHistory() {
    await chrome.storage.session.set({ chatHistory: this.history });
    await chrome.storage.local.set({ longTermMemories: this.longTermMemories });
  }

  public getHistory(): LLMMessage[] {
    if (this.longTermMemories.length > 0) {
      const memText = this.longTermMemories.map((m, i) => `${i + 1}. ${m}`).join('\n');
      const memMsg: LLMMessage = { role: 'system', content: `Long Term Memories:\n${memText}` };
      return [memMsg, ...this.history];
    }
    return this.history;
  }

  /** Clears the in-memory history and persists the cleared state. Always await this. */
  public async clear(): Promise<void> {
    this.history = [];
    this.longTermMemories = [];
    await this.saveHistory();
  }

  public async addTurn(role: 'user' | 'assistant', content: string, llmConfig?: LLMConfig) {
    this.history.push({ role, content });

    if (this.history.length > 20) {
      if (llmConfig) {
        const toSummarize = this.history.slice(0, 4);
        try {
          const summaryText = await this.summarizeTurns(toSummarize, llmConfig);
          this.longTermMemories.push(summaryText);
          
          if (this.longTermMemories.length > 5) {
             const compressed = await this.compressMemories(this.longTermMemories, llmConfig);
             this.longTermMemories = [compressed];
          }

          this.history = this.history.slice(4);
        } catch (e) {
          console.warn('Failed to summarize history, truncating instead', e);
          this.history = this.history.slice(4);
        }
      } else {
        this.history = this.history.slice(-20);
      }
    }

    await this.saveHistory();
  }

  private async summarizeTurns(turns: LLMMessage[], config: LLMConfig): Promise<string> {
    const prompt = `Summarize these conversation turns in 2-3 sentences, preserving task context and any important decisions made:\n${JSON.stringify(turns)}`;
    if (config.zaiApiKey) {
      return callZAI([{ role: 'user', content: prompt }], config.zaiApiKey, 'glm-4.7-flash', false);
    }
    return callLLM([{ role: 'user', content: prompt }], config, 'meta-llama/llama-3.1-8b-instruct', false);
  }

  private async compressMemories(memories: string[], config: LLMConfig): Promise<string> {
    const prompt = `Synthesize and compress the following long-term memories into a single, concise, cohesive master memory document. Retain all important facts, preferences, and context about the user, but eliminate redundancy:\n${JSON.stringify(memories)}`;
    if (config.zaiApiKey) {
      return callZAI([{ role: 'user', content: prompt }], config.zaiApiKey, 'glm-4.7-flash', false);
    }
    return callLLM([{ role: 'user', content: prompt }], config, 'meta-llama/llama-3.1-8b-instruct', false);
  }
}
