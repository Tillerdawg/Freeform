/**
 * Pure autosave timing logic — no IndexedDB, no document knowledge. It
 * decides WHEN to flush, not HOW; the caller's `onFlush` performs the actual
 * durability write. Kept pure and timer-injectable so fake-timer tests can
 * assert exact 2s idle / 30s deadline boundaries without real delays.
 */
export interface AutosaveTimers {
  readonly setTimeout: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface AutosaveSchedulerOptions {
  /** Idle debounce in ms; default 2000 per spec §6. */
  readonly idleMs?: number;
  /** Absolute deadline in ms during continuous editing; default 30000 per spec §6. */
  readonly deadlineMs?: number;
  readonly onFlush: () => void;
  readonly timers?: AutosaveTimers;
}

export interface AutosaveScheduler {
  /** Call once per committed edit. Resets the idle timer on every call; the
   * deadline timer is armed only when a burst starts (no timers currently
   * pending) and is never pushed out further, which bounds worst-case
   * staleness at `deadlineMs` no matter how often edits keep arriving. */
  noteEdit(): void;
  /** Cancels any pending timers without flushing — used when the caller is
   * about to flush manually or switch away from this document. */
  cancelPending(): void;
  dispose(): void;
}

const DEFAULT_IDLE_MS = 2000;
const DEFAULT_DEADLINE_MS = 30000;

export function createAutosaveScheduler(options: AutosaveSchedulerOptions): AutosaveScheduler {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const timers: AutosaveTimers = options.timers ?? { setTimeout, clearTimeout };

  let idleHandle: ReturnType<typeof setTimeout> | undefined;
  let deadlineHandle: ReturnType<typeof setTimeout> | undefined;

  function clearIdle(): void {
    if (idleHandle !== undefined) {
      timers.clearTimeout(idleHandle);
      idleHandle = undefined;
    }
  }

  function clearDeadline(): void {
    if (deadlineHandle !== undefined) {
      timers.clearTimeout(deadlineHandle);
      deadlineHandle = undefined;
    }
  }

  function flush(): void {
    clearIdle();
    clearDeadline();
    options.onFlush();
  }

  return {
    noteEdit() {
      clearIdle();
      idleHandle = timers.setTimeout(flush, idleMs);
      if (deadlineHandle === undefined) {
        deadlineHandle = timers.setTimeout(flush, deadlineMs);
      }
    },
    cancelPending() {
      clearIdle();
      clearDeadline();
    },
    dispose() {
      clearIdle();
      clearDeadline();
    },
  };
}
