import { describe, expect, it } from 'vitest';
import { createCommandStore } from './command-store';
import type { FreeformDocument } from './types';

function makeDocument(): FreeformDocument {
  return {
    format: 'freeform',
    formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Original Title', totalCounts: 0 },
    field: {
      preset: 'NFHS_11_PLAYER',
      unitsPerYard: 2880,
      lengthUnits: 288000,
      widthUnits: 153600,
      frontHashY: 51200,
      backHashY: 102400,
    },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'performer-1', rankCode: 'P1', displayName: 'Performer 1' }],
    sets: [{
      id: 'set-1',
      name: 'Set 1',
      startCount: 0,
      positions: { 'performer-1': { x: 144000, y: 76800 } },
    }],
    transitions: [],
    annotations: [],
  };
}

describe('document command store', () => {
  it('applies schema-compatible document commands immutably', () => {
    const source = makeDocument();
    const store = createCommandStore(source);
    const initial = store.getState();

    const next = store.apply({ type: 'show.title.set', title: 'First Movement' });

    expect(initial.document.show.title).toBe('Original Title');
    expect(next.document.show.title).toBe('First Movement');
    expect(next.document).not.toBe(initial.document);
    expect(next.revision).toBe(1);
    expect(Object.isFrozen(next.document)).toBe(true);
    expect(store.getUndoCommands()).toEqual([{ type: 'show.title.set', title: 'First Movement' }]);
  });

  it('undoes and redoes command history', () => {
    const store = createCommandStore(makeDocument());
    store.apply({ type: 'show.title.set', title: 'First Movement' });
    store.apply({ type: 'show.total-counts.set', totalCounts: 128 });

    expect(store.undo()?.document.show).toMatchObject({ title: 'First Movement', totalCounts: 0 });
    expect(store.undo()?.document.show).toMatchObject({ title: 'Original Title', totalCounts: 0 });
    expect(store.canUndo()).toBe(false);

    expect(store.redo()?.document.show).toMatchObject({ title: 'First Movement', totalCounts: 0 });
    expect(store.redo()?.document.show).toMatchObject({ title: 'First Movement', totalCounts: 128 });
    expect(store.canRedo()).toBe(false);
  });

  it('clears redo history when a new command branches after undo', () => {
    const store = createCommandStore(makeDocument());
    store.apply({ type: 'show.title.set', title: 'First Movement' });
    store.apply({ type: 'show.total-counts.set', totalCounts: 128 });

    store.undo();
    store.apply({ type: 'show.title.set', title: 'Replacement Title' });

    expect(store.canRedo()).toBe(false);
    expect(store.redo()).toBeUndefined();
    expect(store.getState().document.show).toMatchObject({ title: 'Replacement Title', totalCounts: 0 });
  });

  it('reports unavailable undo and redo without changing the state', () => {
    const store = createCommandStore(makeDocument());
    const initial = store.getState();

    expect(store.undo()).toBeUndefined();
    expect(store.redo()).toBeUndefined();
    expect(store.getState()).toBe(initial);
  });
});
