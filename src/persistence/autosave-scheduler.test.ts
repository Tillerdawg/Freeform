import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosaveScheduler } from './autosave-scheduler';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('autosave scheduler', () => {
  it('flushes after exactly 2000ms of idle time following a single edit', () => {
    const onFlush = vi.fn();
    const scheduler = createAutosaveScheduler({ onFlush });

    scheduler.noteEdit();
    vi.advanceTimersByTime(1999);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('resets the 2s idle timer on every new edit, deferring flush indefinitely while edits keep arriving under the deadline', () => {
    const onFlush = vi.fn();
    const scheduler = createAutosaveScheduler({ onFlush });

    scheduler.noteEdit();
    vi.advanceTimersByTime(1500);
    scheduler.noteEdit(); // resets idle clock
    vi.advanceTimersByTime(1500);
    expect(onFlush).not.toHaveBeenCalled(); // only 1.5s idle since last edit
    vi.advanceTimersByTime(500);
    expect(onFlush).toHaveBeenCalledTimes(1); // now 2s idle since last edit
  });

  it('flushes at the 30s continuous-edit deadline even when idle never reaches 2s', () => {
    const onFlush = vi.fn();
    const scheduler = createAutosaveScheduler({ onFlush });

    scheduler.noteEdit();
    // Re-edit every 1s for 29 more seconds: idle timer never completes.
    for (let i = 0; i < 29; i += 1) {
      vi.advanceTimersByTime(1000);
      scheduler.noteEdit();
    }
    expect(onFlush).not.toHaveBeenCalled();
    // The deadline timer was armed at t=0 for 30000ms and is never pushed out.
    vi.advanceTimersByTime(1000);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh 30s deadline window only after a flush actually occurs', () => {
    const onFlush = vi.fn();
    const scheduler = createAutosaveScheduler({ onFlush });

    scheduler.noteEdit();
    vi.advanceTimersByTime(30000);
    expect(onFlush).toHaveBeenCalledTimes(1);

    scheduler.noteEdit();
    vi.advanceTimersByTime(1999);
    expect(onFlush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('cancelPending clears both timers without flushing, e.g. before a manual/explicit save', () => {
    const onFlush = vi.fn();
    const scheduler = createAutosaveScheduler({ onFlush });

    scheduler.noteEdit();
    scheduler.cancelPending();
    vi.advanceTimersByTime(60000);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('dispose clears pending timers so a disposed scheduler never flushes after document switch', () => {
    const onFlush = vi.fn();
    const scheduler = createAutosaveScheduler({ onFlush });

    scheduler.noteEdit();
    scheduler.dispose();
    vi.advanceTimersByTime(60000);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('honors custom idle/deadline durations when provided', () => {
    const onFlush = vi.fn();
    const scheduler = createAutosaveScheduler({ onFlush, idleMs: 500, deadlineMs: 2000 });

    scheduler.noteEdit();
    vi.advanceTimersByTime(499);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});
