// src/lib/agent-manager.ts
import { classifyTranscript } from './classifying';
import { determineNextAction } from './planning';
import { HistoryManager } from './history-manager';
import { logger } from './logger';
import { buildFullSystemPrompt } from './system-prompt';
import type { BackgroundContext } from './system-prompt';
import type { LLMConfig } from './litellm-client';
import { callLLM } from './litellm-client';

export type AgentState = 
  | 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'CLASSIFYING' 
  | 'RESPONDING' | 'CLARIFYING' | 'PLANNING' | 'EXECUTING' 
  | 'CONFIRMING' | 'REPLANNING' | 'RECOVERING' | 'COMPLETE';

export class AgentManager {
  private state: AgentState = 'IDLE';
  private history!: HistoryManager;
  private llmConfig: LLMConfig | null = null;
  private bgCtx: BackgroundContext | null = null;
  private taskAbortController: AbortController | null = null;
  private pendingTaskSummary: string | null = null;
  
  // Callbacks
  public onStateChange?: (state: AgentState, message: string) => void;
  public onSpeak?: (text: string) => void;
  public onExecuteAction?: (action: any) => Promise<boolean>;
  public onGetContext?: () => Promise<{ url: string; title: string; semanticText: string; markersText: string }>;

  public async configure(config: LLMConfig, bgCtx?: BackgroundContext) {
    this.llmConfig = config;
    if (bgCtx) this.bgCtx = bgCtx;
    this.history = await HistoryManager.create();
  }

  public getState(): AgentState { return this.state; }
  public getBgCtx(): BackgroundContext | null { return this.bgCtx; }
  
  public async clearHistory() {
    if (this.taskAbortController) {
      this.taskAbortController.abort();
      this.taskAbortController = null;
    }
    await this.history.clear();
    this.setState('IDLE', 'Memory wiped.');
  }

  private setState(state: AgentState, message: string) {
    logger.info('AgentManager', `State changed: ${this.state} -> ${state}`, { message });
    this.state = state;
    this.onStateChange?.(state, message);
  }

  public async handleTranscript(transcript: string) {
    logger.info('AgentManager', 'Handling transcript', { transcript });

    if (this.taskAbortController) {
      this.taskAbortController.abort();
      this.taskAbortController = null;
    }
    const currentAbortController = new AbortController();
    this.taskAbortController = currentAbortController;

    if (!this.llmConfig) {
      this.setState('IDLE', 'Error: API Key not set');
      return;
    }
    if (!this.llmConfig.openRouterApiKey) {
      this.setState('IDLE', 'Error: OpenRouter API Key missing');
      this.onSpeak?.('Please enter your OpenRouter API key in the settings.');
      return;
    }

    this.setState('CLASSIFYING', 'Thinking...');
    
    // Add user message to history
    await this.history.addTurn('user', transcript, this.llmConfig);

    try {
      const ctx = await this.onGetContext?.() || { url: '', title: '', semanticText: '', markersText: '' };
      
      const historyStr = JSON.stringify(this.history.getHistory().slice(-4));
      const classification = await classifyTranscript(
        transcript, ctx.url, ctx.title, historyStr, this.llmConfig, this.bgCtx, currentAbortController.signal
      );
      logger.info('AgentManager', 'Classification result', classification);

      if (classification.type === 'cancellation') {
        this.pendingTaskSummary = null;
        this.setState('IDLE', 'Task cancelled.');
        this.onSpeak?.('Okay, cancelled.');
        await this.history.addTurn('assistant', 'Action cancelled by user.', this.llmConfig);
      } else if (classification.type === 'confirmation') {
        if (this.pendingTaskSummary) {
          this.setState('PLANNING', 'Planning execution...');
          const taskToExecute = this.pendingTaskSummary;
          this.pendingTaskSummary = null;
          await this.executeTask(taskToExecute, currentAbortController.signal);
        } else {
          this.setState('IDLE', 'Idle');
          this.onSpeak?.('Okay.');
        }
      } else if (classification.type === 'generic') {
        this.pendingTaskSummary = null;
        this.setState('RESPONDING', 'Replying...');
        try {
          const sysPrompt = buildFullSystemPrompt(this.bgCtx);
          const historyMsgs = this.history.getHistory().map((h: any) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
          const llmMessages: any = [
            { role: 'system', content: sysPrompt },
            ...historyMsgs,
            { role: 'user', content: transcript }
          ];
          const model = this.llmConfig.model || 'meta-llama/llama-3.1-8b-instruct';
          const responseText = await callLLM(
            llmMessages, this.llmConfig, model, false, currentAbortController.signal, 'fast'
          );
          this.onSpeak?.(responseText);
          await this.history.addTurn('assistant', responseText, this.llmConfig);
        } catch(e) {
          this.onSpeak?.("I can only help you browse the web. How can I help with this page?");
        }
        this.setState('IDLE', 'Idle');
      } else {
        if (classification.ambiguity === 'ambiguous') {
          this.setState('CLARIFYING', 'Asking for clarification...');
          const q = classification.clarification_question || "Could you be more specific?";
          this.pendingTaskSummary = classification.summary;
          this.onSpeak?.(q);
          await this.history.addTurn('assistant', q, this.llmConfig);
          this.setState('IDLE', 'Idle (Waiting for reply)');
        } else if (classification.risk === 'high') {
          this.setState('CONFIRMING', 'Asking for confirmation...');
          this.pendingTaskSummary = classification.summary;
          const c = `Just to be safe, you want me to ${classification.summary.toLowerCase()}. Should I go ahead?`;
          this.onSpeak?.(c);
          await this.history.addTurn('assistant', c, this.llmConfig);
          this.setState('IDLE', 'Idle (Waiting for confirmation)');
        } else {
          this.pendingTaskSummary = null;
          this.setState('PLANNING', 'Planning execution...');
          await this.executeTask(classification.summary, currentAbortController.signal);
        }
      }
    } catch (err: any) {
      logger.error('AgentManager', 'handleTranscript failed', err);
      console.error(err);
      this.setState('RECOVERING', 'Encountered an error');
      this.onSpeak?.('Sorry, I encountered an error. Please try again.');
      this.setState('IDLE', 'Idle');
    }
  }

  private async executeTask(taskSummary: string, signal: AbortSignal) {
    if (!this.llmConfig) return;

    let stepCount = 0;
    let consecutiveFailures = 0;
    const maxSteps = 10;

    while (stepCount < maxSteps) {
      if (signal.aborted) break;
      stepCount++;
      this.setState('PLANNING', `Planning step ${stepCount}...`);
      
      const ctx = await this.onGetContext?.();
      if (!ctx || signal.aborted) break;

      const action = await determineNextAction(
        taskSummary, ctx.url, ctx.title, ctx.semanticText, ctx.markersText, 
        JSON.stringify(this.history.getHistory()), this.llmConfig, this.bgCtx, signal
      );

      if (signal.aborted) break;

      if (action.action === 'done') {
        this.setState('COMPLETE', 'Task completed');
        this.onSpeak?.(action.thought || action.reason || `Okay, I've finished that.`);
        await this.history.addTurn('assistant', `Task completed: ${action.thought || action.reason}`, this.llmConfig);
        break;
      }

      if (action.action === 'fail') {
        this.setState('RECOVERING', 'Task failed');
        this.onSpeak?.(`I could not complete the task: ${action.reason}`);
        await this.history.addTurn('assistant', `Task failed: ${action.reason}`, this.llmConfig);
        break;
      }

      if (action.action === 'answer') {
        this.setState('COMPLETE', 'Task completed');
        this.onSpeak?.(action.text || action.thought || action.reason);
        await this.history.addTurn('assistant', `Answered user: ${action.text}`, this.llmConfig);
        break;
      }

      this.onSpeak?.(action.thought || action.reason);
      this.setState('EXECUTING', `Executing: ${action.action}`);
      let result: any = false;
      try {
        result = await this.onExecuteAction?.(action);
      } catch (err) {
        logger.error('AgentManager', 'onExecuteAction threw an error', err);
      }
      
      if (!result) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          this.setState('RECOVERING', 'Task aborted');
          this.onSpeak?.('I cannot interact with this page. You might need to refresh the tab.');
          await this.history.addTurn('assistant', '[INTERNAL SYSTEM LOG] Task aborted due to repeated execution failures. Instruct the user to refresh the tab.', this.llmConfig);
          break;
        }
        this.setState('REPLANNING', 'Action failed, recalculating...');
        await this.history.addTurn('assistant', `[INTERNAL SYSTEM LOG] Failed to execute: ${action.action}. Note: If this fails repeatedly, the tab connection might be dead.`, this.llmConfig);
      } else {
        consecutiveFailures = 0;
        const detail = typeof result === 'string' ? `\nResult data:\n${result}` : '';
        await this.history.addTurn('assistant', `[INTERNAL SYSTEM LOG] Successfully executed: ${action.action} on target ${action.target_id || ''} with text/url ${action.text || action.url || ''}. Reason: ${action.reason}${detail}`, this.llmConfig);
      }
      
      // Wait for DOM to settle
      // Handled by content script using waitForDomSettle
    }
    
    if (stepCount >= maxSteps) {
      this.onSpeak?.('I took too many steps and had to stop.');
    }

    this.setState('IDLE', 'Idle');
  }
}
