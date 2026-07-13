// src/lib/history-manager.ts
import { callGemini } from './litellm-client';
import type { LLMMessage, LLMConfig } from './litellm-client';
import { logger } from './logger';

export interface CompactionEvent {
  type: 'summarized' | 'truncated' | 'compressed_memories';
  before: number;
  after: number;
}

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

  /**
   * Add a turn to history. Automatically compacts when history exceeds 20 turns.
   * Returns a CompactionEvent if compaction occurred, null otherwise.
   */
  public async addTurn(role: 'user' | 'assistant', content: string, llmConfig?: LLMConfig): Promise<CompactionEvent | null> {
    this.history.push({ role, content });
    let event: CompactionEvent | null = null;

    if (this.history.length > 20) {
      if (llmConfig) {
        const toSummarize = this.history.slice(0, 4);
        const beforeCount = this.history.length;
        try {
          const summaryText = await this.summarizeTurns(toSummarize, llmConfig);
          this.longTermMemories.push(summaryText);
          
          if (this.longTermMemories.length > 5) {
             const compressed = await this.compressMemories(this.longTermMemories, llmConfig);
             this.longTermMemories = [compressed];
             event = { type: 'compressed_memories', before: beforeCount, after: this.history.length - 4 };
          } else {
            event = { type: 'summarized', before: beforeCount, after: this.history.length - 4 };
          }

          this.history = this.history.slice(4);
        } catch (e) {
          // ponytail: retry once before giving up. The first failure is often a transient rate limit.
          logger.warn('HistoryManager', 'Summarization failed, retrying once...', e);
          try {
            const summaryText = await this.summarizeTurns(toSummarize, llmConfig);
            this.longTermMemories.push(summaryText);
            this.history = this.history.slice(4);
            event = { type: 'summarized', before: beforeCount, after: this.history.length };
          } catch (retryErr) {
            logger.warn('HistoryManager', 'Retry failed, truncating without summary', retryErr);
            this.history = this.history.slice(4);
            event = { type: 'truncated', before: beforeCount, after: this.history.length };
          }
        }
      } else {
        const before = this.history.length;
        this.history = this.history.slice(-20);
        event = { type: 'truncated', before, after: this.history.length };
      }
    }

    await this.saveHistory();
    return event;
  }

  private async summarizeTurns(turns: LLMMessage[], config: LLMConfig): Promise<string> {
    const prompt = `Summarize these conversation turns in 2-3 sentences, preserving task context and any important decisions made:\n${JSON.stringify(turns)}`;
    return callGemini([{ role: 'user', content: prompt }], config, false);
  }

  private async compressMemories(memories: string[], config: LLMConfig): Promise<string> {
    const prompt = `Synthesize and compress the following long-term memories into a single, concise, cohesive master memory document. Retain all important facts, preferences, and context about the user, but eliminate redundancy:\n${JSON.stringify(memories)}`;
    return callGemini([{ role: 'user', content: prompt }], config, false);
  }
}
