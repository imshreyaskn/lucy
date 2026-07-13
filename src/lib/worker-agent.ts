// src/lib/worker-agent.ts
import { determineNextAction } from './planning';
import { HistoryManager } from './history-manager';
import { logger } from './logger';
import { StateMachine } from './state-machine';
import type { StateSnapshot } from './state-machine';
import type { BackgroundContext } from './system-prompt';
import type { LLMConfig } from './litellm-client';

export class WorkerAgent {
  public readonly id: string;
  private machine = new StateMachine();
  private history!: HistoryManager;
  private llmConfig: LLMConfig;
  private bgCtx: BackgroundContext | null;
  private abortController: AbortController | null = null;
  
  // Callbacks injected by Coordinator
  public onStateChange?: (snap: StateSnapshot) => void;
  public onExecuteAction?: (action: any) => Promise<boolean>;
  public onGetContext?: () => Promise<{ url: string; title: string; semanticText: string; markersText: string }>;
  public onGetScreenshot?: () => Promise<string | null>;

  constructor(id: string, config: LLMConfig, bgCtx: BackgroundContext | null = null) {
    this.id = id;
    this.llmConfig = config;
    this.bgCtx = bgCtx;

    this.machine.onChange = (snap) => this.onStateChange?.(snap);
    this.machine.onExitBusy = () => {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    };
  }

  public async init() {
    this.history = await HistoryManager.create();
  }

  public abort() {
    this.machine.transition('RECOVERING', { message: 'Aborted by Coordinator' });
    this.machine.transition('IDLE', { message: 'Idle', stepCount: 0, consecutiveFailures: 0 });
  }

  /**
   * Executes a specific sub-task in the background.
   * Resolves with a string summary of the result.
   */
  public async executeTask(taskSummary: string): Promise<string> {
    logger.info(`WorkerAgent[${this.id}]`, `Starting task: ${taskSummary}`);
    
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    let stepCount = 0;
    let consecutiveFailures = 0;
    const maxSteps = 15; // Workers can do slightly deeper dives
    
    // Inject the initial instruction into the worker's empty history
    await this.history.addTurn('user', `Worker Instructions:\n${taskSummary}`, this.llmConfig);

    while (stepCount < maxSteps) {
      if (signal.aborted) return 'Task aborted by coordinator.';
      
      stepCount++;
      this.machine.transition('PLANNING', {
        message: `Planning step ${stepCount}...`,
        stepCount,
        consecutiveFailures,
      });

      const ctx = await this.onGetContext?.();
      if (!ctx || signal.aborted) return 'Task aborted (no context).';

      let action = await determineNextAction(
        taskSummary, ctx.url, ctx.title, ctx.semanticText, ctx.markersText,
        JSON.stringify(this.history.getHistory()), this.llmConfig, this.bgCtx, signal
      );

      if (action.needs_screenshot && this.onGetScreenshot) {
        this.machine.transition('PLANNING', { message: 'Analyzing screen...', stepCount });
        const screenshot = await this.onGetScreenshot();
        if (screenshot) {
          action = await determineNextAction(
            taskSummary, ctx.url, ctx.title, ctx.semanticText, ctx.markersText,
            JSON.stringify(this.history.getHistory()), this.llmConfig, this.bgCtx, signal,
            false, screenshot
          );
        }
      }

      if (signal.aborted) return 'Task aborted by coordinator.';

      if (action.action === 'done' || action.action === 'answer') {
        this.machine.transition('COMPLETE', { message: 'Task completed', stepCount });
        const result = action.text || action.thought || action.reason || 'Completed successfully.';
        await this.history.addTurn('assistant', `Task completed: ${result}`, this.llmConfig);
        return result;
      }

      if (action.action === 'fail') {
        this.machine.transition('RECOVERING', { message: 'Task failed', stepCount });
        const result = `Failed: ${action.reason}`;
        await this.history.addTurn('assistant', result, this.llmConfig);
        return result;
      }

      // We don't support spawning workers from workers right now
      if (action.action === 'spawn_worker') {
        this.machine.transition('RECOVERING', { message: 'Task failed', stepCount });
        return 'Failed: Workers cannot spawn other workers.';
      }

      this.machine.transition('EXECUTING', {
        message: `Executing: ${action.action}`,
        stepCount,
        consecutiveFailures,
      });

      let result: any = false;
      try {
        result = await this.onExecuteAction?.(action);
      } catch (err) {
        logger.error(`WorkerAgent[${this.id}]`, 'onExecuteAction threw an error', err);
      }
      
      if (!result) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          this.machine.transition('RECOVERING', {
            message: 'Task aborted',
            stepCount,
            consecutiveFailures,
          });
          return 'Failed: Cannot interact with page (repeated execution failures).';
        }
        this.machine.transition('REPLANNING', {
          message: 'Action failed, recalculating...',
          stepCount,
          consecutiveFailures,
        });
        await this.history.addTurn('assistant', `[INTERNAL SYSTEM LOG] Failed to execute: ${action.action}.`, this.llmConfig);
      } else {
        consecutiveFailures = 0;
        const detail = typeof result === 'string' ? `\nResult data:\n${result}` : '';
        await this.history.addTurn('assistant', `[INTERNAL SYSTEM LOG] Successfully executed: ${action.action} on target ${action.target_id || ''} with text/url ${action.text || action.url || ''}. Reason: ${action.reason}${detail}`, this.llmConfig);
      }
    }
    
    this.machine.transition('RECOVERING', { message: 'Max steps reached' });
    return 'Failed: Reached maximum allowed steps before completion.';
  }
}
