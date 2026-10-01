import { afterEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { openPersistenceAdapter } from './idb-adapter';
import { createVersionHistoryStore } from './version-history-store';
import { runWithDestructiveCheckpoint } from './destructive-checkpoint';
import { createCommandStore } from '../document/command-store';
import type { Clock } from './clock';
import type { FreeformDocument } from '../document/types';

function makeDocument(): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'A Show', totalCounts: 0 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A1', displayName: 'A' }],
    sets: [{ id: 'set-1', name: 'One', startCount: 0, positions: { a: { x: 0, y: 0 } } }],
    transitions: [], annotations: [],
  };
}

const clock: Clock = { now: () => 1000 };

afterEach(() => {
  for (const name of [...(indexedDB as unknown as { _databases?: Map<string, unknown> })._databases?.keys() ?? []]) {
    indexedDB.deleteDatabase(name as string);
  }
});

describe('destructive-operation checkpoint hook', () => {
  it('records a pre-destructive checkpoint of the CURRENT document before running the operation', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const history = createVersionHistoryStore(adapter, clock);
    const store = createCommandStore(makeDocument());
    store.apply({ type: 'show.title.set', title: 'Before Destructive Op' });

    let operationRan = false;
    const result = await runWithDestructiveCheckpoint(store, 'doc-1', history, () => {
      operationRan = true;
      return 'bulk-op-result';
    });

    expect(result).toEqual({ ok: true, result: 'bulk-op-result' });
    expect(operationRan).toBe(true);
    const checkpoints = await history.listCheckpoints('doc-1');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.source).toBe('pre-destructive');
    adapter.close();
  });

  it('never runs the destructive operation when the checkpoint write fails, and reports the reason', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    adapter.close(); // force every subsequent transaction to fail
    const history = createVersionHistoryStore(adapter, clock);
    const store = createCommandStore(makeDocument());

    let operationRan = false;
    const result = await runWithDestructiveCheckpoint(store, 'doc-1', history, () => {
      operationRan = true;
      return 'should-not-happen';
    });

    expect(result.ok).toBe(false);
    expect(operationRan).toBe(false);
  });
});

describe('command-store-bridge', () => {
  it('notifies the listener on every successful apply/undo/redo, carrying the exact command on apply', async () => {
    const store = createCommandStore(makeDocument());
    const events: string[] = [];
    const { observeCommandStore } = await import('./command-store-bridge');
    const observed = observeCommandStore(store, (event) => {
      events.push(`${event.kind}:${event.state.revision}`);
    });

    observed.apply({ type: 'show.title.set', title: 'First' });
    observed.apply({ type: 'show.title.set', title: 'Second' });
    observed.undo();
    observed.redo();

    expect(events).toEqual(['apply:1', 'apply:2', 'undo:1', 'redo:2']);
  });

  it('does not notify the listener when a command is rejected, so a failed command produces no snapshot', async () => {
    const store = createCommandStore(makeDocument());
    const events: string[] = [];
    const { observeCommandStore } = await import('./command-store-bridge');
    const observed = observeCommandStore(store, (event) => events.push(event.kind));

    expect(() => observed.apply({ type: 'set.remove', setId: 'unknown-set' })).toThrow();
    expect(events).toEqual([]);
  });

  it('does not notify on undo/redo when history is unavailable (returns undefined)', async () => {
    const store = createCommandStore(makeDocument());
    const events: string[] = [];
    const { observeCommandStore } = await import('./command-store-bridge');
    const observed = observeCommandStore(store, (event) => events.push(event.kind));

    observed.undo();
    observed.redo();
    expect(events).toEqual([]);
  });
});
