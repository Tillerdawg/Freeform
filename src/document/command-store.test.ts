import { describe, expect, it } from 'vitest';
import { createCommandStore } from './command-store';
import { validateDocumentSetsAndTransitions } from './sets';
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

  it('creates a manual rank-coded performer with complete set coverage atomically', () => {
    const store = createCommandStore(makeDocument());
    store.apply({
      type: 'performer.create',
      performer: { id: 'performer-2', rankCode: 'T1', displayName: 'Trumpet 1' },
      positionsBySet: { 'set-1': { x: 115200, y: 51200 } },
    });

    expect(store.getState().document.performers).toContainEqual({
      id: 'performer-2', rankCode: 'T1', displayName: 'Trumpet 1',
    });
    expect(store.getState().document.sets[0]?.positions['performer-2']).toEqual({ x: 115200, y: 51200 });
    expect(() => validateDocumentSetsAndTransitions(store.getState().document)).not.toThrow();
    expect(() => validateDocumentSetsAndTransitions(store.undo()!.document)).not.toThrow();
    expect(() => validateDocumentSetsAndTransitions(store.redo()!.document)).not.toThrow();
  });

  it('moves a dot through the command store and supports undo/redo', () => {
    const store = createCommandStore(makeDocument());
    const moved = store.apply({
      type: 'dot.move',
      setId: 'set-1',
      performerId: 'performer-1',
      dot: { x: 122400, y: 44000 },
    });

    expect(moved.document.sets[0]?.positions['performer-1']).toEqual({ x: 122400, y: 44000 });
    expect(store.undo()?.document.sets[0]?.positions['performer-1']).toEqual({ x: 144000, y: 76800 });
    expect(store.redo()?.document.sets[0]?.positions['performer-1']).toEqual({ x: 122400, y: 44000 });
  });

  it('rejects an out-of-bounds dot before it enters document state', () => {
    const store = createCommandStore(makeDocument());

    expect(() => store.apply({
      type: 'dot.move',
      setId: 'set-1',
      performerId: 'performer-1',
      dot: { x: 288001, y: 51200 },
    })).toThrow(/integer FU within x=0\.\.288000 and y=0\.\.153600/);
    expect(store.getState().document.sets[0]?.positions['performer-1']).toEqual({ x: 144000, y: 76800 });
    expect(store.canUndo()).toBe(false);
  });

  it('rejects duplicate rank codes without changing document state', () => {
    const store = createCommandStore(makeDocument());

    expect(() => store.apply({
      type: 'performer.create',
      performer: { id: 'performer-2', rankCode: 'p1', displayName: 'Duplicate' },
      positionsBySet: { 'set-1': { x: 115200, y: 51200 } },
    })).toThrow('Rank code already exists: p1');
    expect(store.getState().document.performers).toHaveLength(1);
  });

  it('creates a fully covered ordered set and supports undo/redo', () => {
    const store = createCommandStore(makeDocument());
    store.apply({
      type: 'set.create',
      set: {
        id: 'set-2', name: 'Set 2', startCount: 16,
        positions: { 'performer-1': { x: 115200, y: 51200 } },
      },
    });

    expect(store.getState().document.sets.map((set) => set.id)).toEqual(['set-1', 'set-2']);
    expect(store.undo()?.document.sets).toHaveLength(1);
    expect(store.redo()?.document.sets[1]?.positions).toEqual({ 'performer-1': { x: 115200, y: 51200 } });
  });

  it('rejects set creation with missing or unknown performer coverage', () => {
    const source = makeDocument();
    const store = createCommandStore({
      ...source,
      performers: [...source.performers, { id: 'performer-2', rankCode: 'P2', displayName: 'Performer 2' }],
      sets: source.sets.map((set) => ({
        ...set,
        positions: { ...set.positions, 'performer-2': { x: 115200, y: 51200 } },
      })),
    });

    expect(() => store.apply({
      type: 'set.create',
      set: { id: 'set-2', name: 'Incomplete', startCount: 16, positions: { 'performer-1': { x: 1, y: 1 } } },
    })).toThrow('Set set-2 must contain exactly one dot for each active performer.');
    expect(() => store.apply({
      type: 'set.create',
      set: {
        id: 'set-2', name: 'Unknown', startCount: 16,
        positions: { 'performer-1': { x: 1, y: 1 }, ghost: { x: 2, y: 2 } },
      },
    })).toThrow('Set set-2 contains an unknown performer dot: ghost');
  });

  it('rejects incomplete performer creation without exposing invalid coverage', () => {
    const store = createCommandStore(makeDocument());
    const initial = store.getState();

    expect(() => store.apply({
      type: 'performer.create',
      performer: { id: 'performer-2', rankCode: 'P2', displayName: 'Performer 2' },
      positionsBySet: {},
    })).toThrow('Creating a performer requires exactly one dot for every existing set.');
    expect(store.getState()).toBe(initial);
    expect(() => validateDocumentSetsAndTransitions(store.getState().document)).not.toThrow();
  });

  it('rejects incomplete document replacement without changing canonical state', () => {
    const store = createCommandStore(makeDocument());
    const initial = store.getState();
    const invalid = {
      ...makeDocument(),
      sets: [{ ...makeDocument().sets[0]!, positions: {} }],
    };

    expect(() => store.apply({ type: 'document.replace', document: invalid })).toThrow(
      'Set set-1 must contain exactly one dot for each active performer.',
    );
    expect(store.getState()).toBe(initial);
    expect(() => validateDocumentSetsAndTransitions(store.getState().document)).not.toThrow();
  });

  it('rejects removal of required performer coverage', () => {
    const store = createCommandStore(makeDocument());

    expect(() => store.apply({ type: 'set.performer.remove', setId: 'set-1', performerId: 'performer-1' }))
      .toThrow('Removing performer coverage would violate the complete-set requirement.');
  });

  it('reorders an unconnected set through a command and supports undo/redo', () => {
    const store = createCommandStore(makeDocument());
    store.apply({ type: 'set.create', set: {
      id: 'set-2', name: 'Set 2', startCount: 16, positions: { 'performer-1': { x: 115200, y: 51200 } },
    } });
    store.apply({ type: 'set.create', set: {
      id: 'set-3', name: 'Set 3', startCount: 32, positions: { 'performer-1': { x: 86400, y: 51200 } },
    } });
    store.apply({ type: 'set.reorder', setId: 'set-3', startCount: 8 });

    expect(store.getState().document.sets.map((set) => set.id)).toEqual(['set-1', 'set-3', 'set-2']);
    expect(store.undo()?.document.sets.map((set) => set.id)).toEqual(['set-1', 'set-2', 'set-3']);
    expect(store.redo()?.document.sets.map((set) => set.id)).toEqual(['set-1', 'set-3', 'set-2']);
  });

  it('reorders sets only with strictly ascending start counts and preserves transition timing', () => {
    const store = createCommandStore(makeDocument());
    store.apply({ type: 'set.create', set: {
      id: 'set-2', name: 'Set 2', startCount: 16, positions: { 'performer-1': { x: 115200, y: 51200 } },
    } });
    store.apply({ type: 'transition.create', transition: {
      id: 'float-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float',
    } });

    expect(() => store.apply({ type: 'set.reorder', setId: 'set-2', startCount: 8 }))
      .toThrow('Transition counts must equal the difference between adjacent set start counts.');
    expect(store.getState().document.sets[1]?.startCount).toBe(16);
  });

  it('rejects a transition that is not adjacent or does not match set count timing', () => {
    const store = createCommandStore(makeDocument());
    store.apply({ type: 'set.create', set: {
      id: 'set-2', name: 'Set 2', startCount: 16, positions: { 'performer-1': { x: 115200, y: 51200 } },
    } });

    expect(() => store.apply({ type: 'transition.create', transition: {
      id: 'float-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 12, mode: 'float',
    } })).toThrow('Transition counts must equal the difference between adjacent set start counts.');
  });

  it('allows at most one transition for each adjacent set gap', () => {
    const store = createCommandStore(makeDocument());
    store.apply({ type: 'set.create', set: {
      id: 'set-2', name: 'Set 2', startCount: 16, positions: { 'performer-1': { x: 115200, y: 51200 } },
    } });
    store.apply({ type: 'transition.create', transition: {
      id: 'float-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float',
    } });

    expect(() => store.apply({ type: 'transition.create', transition: {
      id: 'float-2', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float',
    } })).toThrow('A transition already connects set-1 to set-2.');
  });
});
