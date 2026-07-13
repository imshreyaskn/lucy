// src/lib/state-machine.ts
import { logger } from './logger';

export type AgentState =
  | 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'CLASSIFYING'
  | 'RESPONDING' | 'PLANNING' | 'EXECUTING'
  | 'WAITING_FOR_REPLY' | 'WAITING_FOR_WORKER'
  | 'REPLANNING' | 'RECOVERING' | 'COMPLETE';

export type WaitReason = 'clarification' | 'confirmation' | null;

export interface StateSnapshot {
  state: AgentState;
  message: string;
  pendingTask: string | null;
  waitReason: WaitReason;
  stepCount: number;
  consecutiveFailures: number;
  timestamp: number;
}

export interface TransitionEntry {
  from: AgentState;
  to: AgentState;
  message: string;
  timestamp: number;
}

// ponytail: transition table is the single source of truth for valid flows.
// If a transition isn't listed here, it's a bug. Add it explicitly.
const TRANSITIONS: Record<AgentState, AgentState[]> = {
  IDLE:               ['LISTENING', 'CLASSIFYING', 'IDLE'],
  LISTENING:          ['TRANSCRIBING', 'IDLE'],
  TRANSCRIBING:       ['CLASSIFYING', 'IDLE'],
  CLASSIFYING:        ['RESPONDING', 'PLANNING', 'WAITING_FOR_REPLY', 'IDLE', 'RECOVERING'],
  RESPONDING:         ['IDLE', 'RECOVERING'],
  PLANNING:           ['EXECUTING', 'WAITING_FOR_WORKER', 'IDLE', 'RECOVERING', 'COMPLETE'],
  EXECUTING:          ['PLANNING', 'REPLANNING', 'COMPLETE', 'RECOVERING', 'IDLE'],
  WAITING_FOR_REPLY:  ['CLASSIFYING', 'IDLE'],
  WAITING_FOR_WORKER: ['PLANNING', 'COMPLETE', 'RECOVERING', 'IDLE'],
  REPLANNING:         ['PLANNING', 'RECOVERING', 'IDLE'],
  RECOVERING:         ['IDLE'],
  COMPLETE:           ['IDLE'],
};

const MAX_LOG_SIZE = 20;
const WAIT_TIMEOUT_MS = 60_000; // 60s timeout on WAITING_FOR_REPLY

function makeSnapshot(partial?: Partial<StateSnapshot>): StateSnapshot {
  return {
    state: 'IDLE',
    message: 'Idle',
    pendingTask: null,
    waitReason: null,
    stepCount: 0,
    consecutiveFailures: 0,
    timestamp: Date.now(),
    ...partial,
  };
}

export class StateMachine {
  private _current: StateSnapshot;
  private _log: TransitionEntry[] = [];
  private _waitTimer: ReturnType<typeof setTimeout> | null = null;

  /** Called on every transition. Wire this to the UI. */
  public onChange?: (snap: StateSnapshot) => void;

  /** Called when WAITING_FOR_REPLY times out. */
  public onWaitTimeout?: () => void;

  /** Called when exiting EXECUTING or PLANNING — for aborting in-flight work. */
  public onExitBusy?: () => void;

  constructor() {
    this._current = makeSnapshot();
  }

  get current(): StateSnapshot { return this._current; }
  get log(): readonly TransitionEntry[] { return this._log; }

  /**
   * Attempt a state transition. Returns the new snapshot, or null if the
   * transition was invalid (logged + no-op in prod).
   */
  transition(
    to: AgentState,
    updates?: Partial<Omit<StateSnapshot, 'state' | 'timestamp'>>
  ): StateSnapshot | null {
    const from = this._current.state;

    if (from === to && to !== 'IDLE') {
      // Self-transition only allowed for IDLE (re-entering idle is fine)
      // For everything else, just update the message in place
      if (updates?.message) {
        this._current = { ...this._current, message: updates.message, timestamp: Date.now(), ...updates };
        this.onChange?.(this._current);
      }
      return this._current;
    }

    const allowed = TRANSITIONS[from];
    if (!allowed.includes(to)) {
      logger.warn('StateMachine', `Invalid transition: ${from} → ${to}. Allowed: [${allowed.join(', ')}]`);
      return null;
    }

    // If leaving a busy state, fire the exit hook
    if ((from === 'EXECUTING' || from === 'PLANNING' || from === 'REPLANNING') && to !== 'EXECUTING' && to !== 'PLANNING' && to !== 'REPLANNING') {
      this.onExitBusy?.();
    }

    // Clear wait timer if leaving WAITING_FOR_REPLY
    if (from === 'WAITING_FOR_REPLY') {
      this.clearWaitTimer();
    }

    const prev = this._current;
    this._current = makeSnapshot({
      ...prev,
      state: to,
      message: updates?.message ?? '',
      timestamp: Date.now(),
      // Carry forward fields unless explicitly overridden
      pendingTask: updates?.pendingTask !== undefined ? updates.pendingTask : prev.pendingTask,
      waitReason: updates?.waitReason !== undefined ? updates.waitReason : (to === 'WAITING_FOR_REPLY' ? prev.waitReason : null),
      stepCount: updates?.stepCount !== undefined ? updates.stepCount : prev.stepCount,
      consecutiveFailures: updates?.consecutiveFailures !== undefined ? updates.consecutiveFailures : prev.consecutiveFailures,
    });

    // Log the transition
    this._log.push({ from, to, message: this._current.message, timestamp: this._current.timestamp });
    if (this._log.length > MAX_LOG_SIZE) this._log.shift();

    logger.info('StateMachine', `${from} → ${to}`, { message: this._current.message });
    this.onChange?.(this._current);

    // Start wait timer if entering WAITING_FOR_REPLY
    if (to === 'WAITING_FOR_REPLY') {
      this.startWaitTimer();
    }

    return this._current;
  }

  /** Reset everything back to IDLE. Skips transition guards. */
  reset(message = 'Reset') {
    this.clearWaitTimer();
    this._current = makeSnapshot({ message });
    this.onChange?.(this._current);
  }

  private startWaitTimer() {
    this.clearWaitTimer();
    this._waitTimer = setTimeout(() => {
      if (this._current.state === 'WAITING_FOR_REPLY') {
        logger.info('StateMachine', 'WAITING_FOR_REPLY timed out after 60s');
        this.onWaitTimeout?.();
        this.transition('IDLE', { message: 'Idle', pendingTask: null, waitReason: null });
      }
    }, WAIT_TIMEOUT_MS);
  }

  private clearWaitTimer() {
    if (this._waitTimer) {
      clearTimeout(this._waitTimer);
      this._waitTimer = null;
    }
  }
}
