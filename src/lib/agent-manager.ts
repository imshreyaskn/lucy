// src/lib/agent-manager.ts
import { classifyTranscript } from './classifying';
import { determineNextAction } from './planning';
import { HistoryManager } from './history-manager';
import { logger } from './logger';
import { buildFullSystemPrompt } from './system-prompt';
import type { BackgroundContext } from './system-prompt';
import type { LLMConfig } from './litellm-client';
import { callGemini } from './litellm-client';
import { StateMachine } from './state-machine';
import type { AgentState, StateSnapshot, WaitReason } from './state-machine';
import { WorkerAgent } from './worker-agent';

export type { AgentState, StateSnapshot };

export class AgentManager {
  private machine = new StateMachine();
  private history!: HistoryManager;
  private llmConfig: LLMConfig | null = null;
  private bgCtx: BackgroundContext | null = null;
  private taskAbortController: AbortController | null = null;
  
  // Callbacks
  public onStateChange?: (snap: StateSnapshot) => void;
  public onSpeak?: (text: string) => void;
  public onExecuteAction?: (action: any) => Promise<boolean>;
  public onGetContext?: () => Promise<{ url: string; title: string; semanticText: string; markersText: string }>;
  public onGetScreenshot?: () => Promise<string | null>;

  constructor() {
    // Wire state machine hooks
    this.machine.onChange = (snap) => this.onStateChange?.(snap);

    this.machine.onExitBusy = () => {
      // Auto-abort in-flight work when leaving EXECUTING/PLANNING
      if (this.taskAbortController) {
        this.taskAbortController.abort();
        this.taskAbortController = null;
      }
    };

    this.machine.onWaitTimeout = () => {
      this.onSpeak?.('Let me know when you\'re ready.');
    };
  }

  public async configure(config: LLMConfig, bgCtx?: BackgroundContext) {
    this.llmConfig = config;
    if (bgCtx) this.bgCtx = bgCtx;
    this.history = await HistoryManager.create();
  }

  public getState(): AgentState { return this.machine.current.state; }
  public getSnapshot(): StateSnapshot { return this.machine.current; }
  public getTransitionLog() { return this.machine.log; }
  public getBgCtx(): BackgroundContext | null { return this.bgCtx; }
  
  public async clearHistory() {
    // Abort any in-flight task
    if (this.taskAbortController) {
      this.taskAbortController.abort();
      this.taskAbortController = null;
    }
    await this.history.clear();
    this.machine.reset('Memory wiped.');
  }

  public async handleTranscript(transcript: string) {
    logger.info('AgentManager', 'Handling transcript', { transcript });

    const snap = this.machine.current;

    // ── Fast path: if waiting for a reply, route through handleReply ──
    if (snap.state === 'WAITING_FOR_REPLY') {
      return this.handleReply(transcript, snap);
    }

    // ── Guard: if busy, interrupt gracefully ──
    if (snap.state !== 'IDLE') {
      // onExitBusy will fire automatically and abort the controller
      this.machine.transition('IDLE', { message: 'Interrupted by new input', pendingTask: null });
    }

    // Fresh abort controller for this task
    const currentAbortController = new AbortController();
    this.taskAbortController = currentAbortController;

    if (!this.llmConfig || !this.llmConfig.geminiApiKey) {
      this.machine.transition('IDLE', { message: 'Error: Missing API Key in Settings' });
      this.onSpeak?.('Please configure your Gemini API Key in the settings menu.');
      return;
    }

    this.machine.transition('CLASSIFYING', { message: 'Thinking...' });
    
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
        this.machine.transition('IDLE', { message: 'Task cancelled.', pendingTask: null });
        this.onSpeak?.('Okay, cancelled.');
        await this.history.addTurn('assistant', 'Action cancelled by user.', this.llmConfig);

      } else if (classification.type === 'confirmation') {
        // Nothing pending to confirm — treat as acknowledgement
        this.machine.transition('IDLE', { message: 'Idle' });
        this.onSpeak?.('Okay.');

      } else if (classification.type === 'generic') {
        this.machine.transition('RESPONDING', { message: 'Replying...', pendingTask: null });
        try {
          const sysPrompt = buildFullSystemPrompt(this.bgCtx);
          const historyMsgs = this.history.getHistory().map((h: any) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
          const llmMessages: any = [
            { role: 'system', content: sysPrompt },
            ...historyMsgs,
            { role: 'user', content: transcript }
          ];
          let responseText = await callGemini(llmMessages, this.llmConfig, false, currentAbortController.signal);
          this.onSpeak?.(responseText);
          await this.history.addTurn('assistant', responseText, this.llmConfig);
        } catch(e) {
          this.onSpeak?.("I can only help you browse the web. How can I help with this page?");
        }
        this.machine.transition('IDLE', { message: 'Idle' });

      } else {
        // classification.type === 'task'
        if (classification.ambiguity === 'ambiguous') {
          const q = classification.clarification_question || "Could you be more specific?";
          this.machine.transition('WAITING_FOR_REPLY', {
            message: 'Waiting for clarification...',
            pendingTask: classification.summary,
            waitReason: 'clarification' as WaitReason,
          });
          this.onSpeak?.(q);
          await this.history.addTurn('assistant', q, this.llmConfig);

        } else if (classification.risk === 'high') {
          const c = `Just to be safe, you want me to ${classification.summary.toLowerCase()}. Should I go ahead?`;
          this.machine.transition('WAITING_FOR_REPLY', {
            message: 'Waiting for confirmation...',
            pendingTask: classification.summary,
            waitReason: 'confirmation' as WaitReason,
          });
          this.onSpeak?.(c);
          await this.history.addTurn('assistant', c, this.llmConfig);

        } else {
          this.machine.transition('PLANNING', { message: 'Planning execution...', pendingTask: null });
          await this.executeTask(classification.summary, currentAbortController.signal);
        }
      }
    } catch (err: any) {
      logger.error('AgentManager', 'handleTranscript failed: ' + (err.stack || err.message || JSON.stringify(err)));
      console.error('handleTranscript failed explicitly:', err);
      this.machine.transition('RECOVERING', { message: 'Encountered an error' });
      this.onSpeak?.('Sorry, I encountered an error. Please try again.');
      this.machine.transition('IDLE', { message: 'Idle' });
    }
  }

  /**
   * Fast-path handler when Lucy is in WAITING_FOR_REPLY.
   * Only classifies for confirmation/cancellation/new-task — doesn't re-enter the full pipeline.
   */
  private async handleReply(transcript: string, snap: StateSnapshot) {
    if (!this.llmConfig || !this.llmConfig.geminiApiKey) return;

    const currentAbortController = new AbortController();
    this.taskAbortController = currentAbortController;

    await this.history.addTurn('user', transcript, this.llmConfig);

    try {
      const ctx = await this.onGetContext?.() || { url: '', title: '', semanticText: '', markersText: '' };
      const historyStr = JSON.stringify(this.history.getHistory().slice(-4));

      // Transition out of WAITING_FOR_REPLY into CLASSIFYING
      this.machine.transition('CLASSIFYING', { message: 'Thinking...' });

      const classification = await classifyTranscript(
        transcript, ctx.url, ctx.title, historyStr, this.llmConfig, this.bgCtx, currentAbortController.signal
      );
      logger.info('AgentManager', 'Reply classification', classification);

      if (classification.type === 'cancellation') {
        this.machine.transition('IDLE', { message: 'Task cancelled.', pendingTask: null, waitReason: null });
        this.onSpeak?.('Okay, cancelled.');
        await this.history.addTurn('assistant', 'Action cancelled by user.', this.llmConfig);

      } else if (classification.type === 'confirmation' && snap.pendingTask) {
        // User confirmed the pending task — execute it
        const taskToExecute = snap.pendingTask;
        this.machine.transition('PLANNING', { message: 'Planning execution...', pendingTask: null, waitReason: null });
        await this.executeTask(taskToExecute, currentAbortController.signal);

      } else if (classification.type === 'task') {
        // User gave a new task instead of confirming — run the new one
        this.machine.transition('PLANNING', { message: 'Planning execution...', pendingTask: null, waitReason: null });
        await this.executeTask(classification.summary, currentAbortController.signal);

      } else {
        // Generic or unexpected — just respond normally
        this.machine.transition('IDLE', { message: 'Idle', pendingTask: null, waitReason: null });
        this.onSpeak?.('Okay.');
      }
    } catch (err: any) {
      logger.error('AgentManager', 'handleReply failed', err);
      this.machine.transition('RECOVERING', { message: 'Encountered an error' });
      this.onSpeak?.('Sorry, I encountered an error. Please try again.');
      this.machine.transition('IDLE', { message: 'Idle' });
    }
  }

  private async executeTask(taskSummary: string, signal: AbortSignal) {
    if (!this.llmConfig || !this.llmConfig.geminiApiKey) return;

    let stepCount = 0;
    let consecutiveFailures = 0;
    const maxSteps = 10;

    while (stepCount < maxSteps) {
      if (signal.aborted) break;
      stepCount++;
      this.machine.transition('PLANNING', {
        message: `Planning step ${stepCount}...`,
        stepCount,
        consecutiveFailures,
      });

      const ctx = await this.onGetContext?.();
      if (!ctx || signal.aborted) break;

      const recentHistoryStr = JSON.stringify(this.history.getHistory().slice(-10));
      // Step 1: text-only plan (fast, cheap)
      let action = await determineNextAction(
        taskSummary, ctx.url, ctx.title, ctx.semanticText, ctx.markersText,
        recentHistoryStr, this.llmConfig, this.bgCtx, signal
      );

      // Step 2: if planner says it needs a screenshot, re-plan with vision model
      if (action.needs_screenshot && this.onGetScreenshot && this.llmConfig.visionEnabled) {
        this.machine.transition('PLANNING', { message: 'Analyzing screen...', stepCount });
        logger.info('AgentManager', `Step ${stepCount}: vision re-plan requested`);
        const screenshot = await this.onGetScreenshot();
        if (screenshot) {
          action = await determineNextAction(
            taskSummary, ctx.url, ctx.title, ctx.semanticText, ctx.markersText,
            recentHistoryStr, this.llmConfig, this.bgCtx, signal,
            false, screenshot
          );
        }
      }

      if (signal.aborted) break;

      if (action.action === 'done') {
        this.machine.transition('COMPLETE', { message: 'Task completed', stepCount });
        this.onSpeak?.(action.thought || action.reason || `Okay, I've finished that.`);
        await this.history.addTurn('assistant', `Task completed: ${action.thought || action.reason}`, this.llmConfig);
        break;
      }

      if (action.action === 'fail') {
        this.machine.transition('RECOVERING', { message: 'Task failed', stepCount });
        this.onSpeak?.(`I could not complete the task: ${action.reason}`);
        await this.history.addTurn('assistant', `Task failed: ${action.reason}`, this.llmConfig);
        break;
      }

      if (action.action === 'answer') {
        this.machine.transition('COMPLETE', { message: 'Task completed', stepCount });
        this.onSpeak?.(action.text || action.thought || action.reason);
        await this.history.addTurn('assistant', `Answered user: ${action.text}`, this.llmConfig);
        break;
      }

      if (action.action === 'spawn_worker' && action.text) {
        this.machine.transition('WAITING_FOR_WORKER', {
          message: 'Delegating to background worker...',
          stepCount,
          consecutiveFailures,
        });
        this.onSpeak?.(action.thought || "I've assigned a worker to look into that. Give me a moment...");
        
        const worker = new WorkerAgent(`worker-${stepCount}`, this.llmConfig, this.bgCtx);
        worker.onExecuteAction = this.onExecuteAction;
        worker.onGetContext = this.onGetContext;
        worker.onGetScreenshot = this.onGetScreenshot;
        worker.onStateChange = (snap) => {
          logger.info(`AgentManager`, `Worker state: ${snap.state} - ${snap.message}`);
        };
        
        await worker.init();
        const workerResult = await worker.executeTask(action.text);
        
        await this.history.addTurn('assistant', `[INTERNAL SYSTEM LOG] Worker reported:\n${workerResult}`, this.llmConfig);
        
        // Loop continues so Coordinator can evaluate the result and answer the user
        continue;
      }

      this.onSpeak?.(action.thought || action.reason);
      this.machine.transition('EXECUTING', {
        message: `Executing: ${action.action}`,
        stepCount,
        consecutiveFailures,
      });

      let result: any = false;
      try {
        result = await this.onExecuteAction?.(action);
      } catch (err) {
        logger.error('AgentManager', 'onExecuteAction threw an error', err);
      }
      
      if (!result) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          this.machine.transition('RECOVERING', {
            message: 'Task aborted',
            stepCount,
            consecutiveFailures,
          });
          this.onSpeak?.('I cannot interact with this page. You might need to refresh the tab.');
          await this.history.addTurn('assistant', '[INTERNAL SYSTEM LOG] Task aborted due to repeated execution failures. Instruct the user to refresh the tab.', this.llmConfig);
          break;
        }
        this.machine.transition('REPLANNING', {
          message: 'Action failed, recalculating...',
          stepCount,
          consecutiveFailures,
        });
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

    this.machine.transition('IDLE', { message: 'Idle', stepCount: 0, consecutiveFailures: 0 });
  }
}
