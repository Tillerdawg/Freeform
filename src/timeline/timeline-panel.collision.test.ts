// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument } from '../document/types';
import { createTimelinePanel } from './timeline-panel';

function collisionDocument(): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'collision-ui', title: 'Collision UI', totalCounts: 2 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A1', displayName: 'Alpha' }, { id: 'b', rankCode: 'B1', displayName: 'Bravo' }],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 14400, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 2, positions: { a: { x: 14400, y: 0 }, b: { x: 0, y: 0 } } },
    ],
    transitions: [{ id: 'float-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 2, mode: 'float' }],
    annotations: [],
  };
}

function invalidFtlDocument(): FreeformDocument {
  const document = collisionDocument();
  return {
    ...document,
    transitions: [{
      id: 'bad-ftl', fromSetId: 'set-1', toSetId: 'set-2', counts: 2, mode: 'ftl',
      ftl: {
        leaderId: 'a', followerIds: ['b'], offsetUnits: { a: 0, b: 2880 }, distanceUnits: 2880,
        path: [{ x: 0, y: 0 }, { x: 10000, y: 0 }],
        expectedEndPositions: { a: { x: 2880, y: 0 }, b: { x: 5762, y: 0 } },
      },
    }],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 2880, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 2, positions: { a: { x: 2880, y: 0 }, b: { x: 5760, y: 0 } } },
    ],
  };
}

function render(document: FreeformDocument) {
  const store = createCommandStore(document);
  const refresh = vi.fn();
  const status = vi.fn();
  const panel = createTimelinePanel(store, refresh, status);
  const root = documentGlobal.createElement('div');
  root.append(panel.render());
  return { store, refresh, status, panel, root };
}

const documentGlobal = document;

beforeEach(() => { document.body.replaceChildren(); });

describe('collision timeline disclosure', () => {
  it('renders real-store warning data with native labels and no collision-prevented claim', () => {
    const { root } = render(collisionDocument());
    const disclosure = root.querySelector<HTMLDetailsElement>('details.collision-panel');
    expect(disclosure?.open).toBe(true);
    expect(disclosure?.querySelector('summary')?.textContent).toBe('Collision warnings — 1 of 1 pairs');
    expect(root.textContent).toContain('A1 × B1');
    expect(root.textContent).toContain('⚠ Warning');
    expect(root.textContent).toContain('advisory sampled detection');
    expect(root.textContent).not.toContain('collision prevented');
    const threshold = root.querySelector<HTMLInputElement>('#collision-threshold');
    expect(threshold?.min).toBe('1');
    expect(root.querySelector('label[for="collision-threshold"]')?.textContent).toBe('Collision warning threshold (FU)');
  });

  it('updates the real document threshold through the undoable command-store action', () => {
    const { root, store, refresh } = render(collisionDocument());
    const threshold = root.querySelector<HTMLInputElement>('#collision-threshold')!;
    threshold.value = '2000';
    threshold.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(store.getState().document.settings.collisionThresholdUnits).toBe(2000);
    expect(store.getUndoCommands()[0]).toEqual({ type: 'settings.collision-threshold.set', collisionThresholdUnits: 2000 });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('records an explicit reasoned local override without suppressing the computed warning', () => {
    const { root, store, panel } = render(collisionDocument());
    (root.querySelector('button') as HTMLButtonElement); // Ensure the DOM is materialized before choosing the named action.
    [...root.querySelectorAll('button')].find((button) => button.textContent === 'Record override')!.click();
    const editing = panel.render();
    const actor = editing.querySelector<HTMLInputElement>('#override-actor-a-b')!;
    const reason = editing.querySelector<HTMLTextAreaElement>('#override-reason-a-b')!;
    actor.value = 'Local director'; reason.value = 'Sightline is intentionally shared.';
    reason.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(store.getState().document.transitions[0]?.collisionOverrides).toHaveLength(1);
    const after = panel.render();
    expect(after.textContent).toContain('⚠ Warning — override recorded');
    expect(after.textContent).toContain('Override recorded by Local director');
    expect(after.textContent).toContain('Sightline is intentionally shared.');
  });

  it('flags stale audits as not applied after pair motion changes', () => {
    const { store, panel } = render(collisionDocument());
    const original = panel.render();
    [...original.querySelectorAll('button')].find((button) => button.textContent === 'Record override')!.click();
    const editing = panel.render();
    editing.querySelector<HTMLInputElement>('#override-actor-a-b')!.value = 'Local director';
    const reason = editing.querySelector<HTMLTextAreaElement>('#override-reason-a-b')!;
    reason.value = 'Initial geometry.';
    reason.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    store.apply({ type: 'dot.move', setId: 'set-2', performerId: 'a', dot: { x: 12000, y: 0 } });
    expect(panel.render().textContent).toContain('Override recorded for different warning inputs — review.');
  });

  it('refreshes the visible playback state on a tick even while a collision field has focus', () => {
    const { root, panel, refresh } = render(collisionDocument());
    document.body.append(root);
    const threshold = root.querySelector<HTMLInputElement>('#collision-threshold')!;
    threshold.focus();
    let tick: (() => void) | undefined;
    const originalInterval = Object.getOwnPropertyDescriptor(window, 'setInterval');
    const originalClear = Object.getOwnPropertyDescriptor(window, 'clearInterval');
    Object.defineProperty(window, 'setInterval', { configurable: true, value: (handler: TimerHandler): number => {
      if (typeof handler !== 'function') throw new Error('Expected playback timer callback.');
      tick = handler as () => void;
      return 1;
    } });
    Object.defineProperty(window, 'clearInterval', { configurable: true, value: () => undefined });
    try {
      panel.handleKeyDown({ key: ' ', target: root, preventDefault() {} } as unknown as KeyboardEvent);
      refresh.mockClear();
      tick!();
      expect(document.activeElement).toBe(threshold);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      if (originalInterval) Object.defineProperty(window, 'setInterval', originalInterval);
      if (originalClear) Object.defineProperty(window, 'clearInterval', originalClear);
    }
  });

  it('surfaces an actionable collision-analysis failure for invalid persisted FTL', () => {
    const { root } = render(invalidFtlDocument());
    expect(root.textContent).toContain('FTL playback blocked: FTL_END_MISMATCH');
    expect(root.textContent).toContain('Collision analysis unavailable: COLLISION_ANALYSIS_FTL_INVALID');
  });
});
