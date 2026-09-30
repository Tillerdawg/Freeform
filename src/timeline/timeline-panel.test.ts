import { describe, expect, it } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument } from '../document/types';
import { createTimelinePanel } from './timeline-panel';

function makeDocument(): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Timeline panel', totalCounts: 4 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A', displayName: 'A' }],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 4, positions: { a: { x: 7200, y: 0 } } },
    ],
    transitions: [{ id: 'float-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 4, mode: 'float' }],
    annotations: [],
  };
}

function keyboardEvent(key: string): KeyboardEvent {
  return {
    key,
    target: null,
    preventDefault() {},
  } as unknown as KeyboardEvent;
}

describe('timeline panel keyboard playback', () => {
  it('starts and pauses the playback clock with Space and preserves arrow count navigation', () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const intervals = new Map<number, () => void>();
    const cleared: number[] = [];
    let nextTimerId = 1;
    const fakeWindow = {
      setInterval(handler: TimerHandler): number {
        if (typeof handler !== 'function') throw new Error('Expected a callback timer.');
        const id = nextTimerId++;
        intervals.set(id, handler as () => void);
        return id;
      },
      clearInterval(id: number): void {
        cleared.push(id);
        intervals.delete(id);
      },
    } as unknown as Window & typeof globalThis;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    try {
      let refreshes = 0;
      const panel = createTimelinePanel(createCommandStore(makeDocument()), () => { refreshes += 1; }, () => {});

      panel.handleKeyDown(keyboardEvent('ArrowRight'));
      panel.handleKeyDown(keyboardEvent(' '));
      expect([...intervals.keys()]).toEqual([1]);

      // ArrowRight moved the sample from count 0 to 1, so exactly three clock
      // ticks reach and render the inclusive endpoint at count 4.
      intervals.get(1)!();
      intervals.get(1)!();
      intervals.get(1)!();
      expect(cleared).toEqual([1]);
      expect(refreshes).toBe(5);

      panel.handleKeyDown(keyboardEvent(' '));
      expect([...intervals.keys()]).toEqual([2]);
      panel.handleKeyDown(keyboardEvent(' '));
      expect(cleared).toEqual([1, 2]);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else delete (globalThis as { window?: unknown }).window;
    }
  });
});
