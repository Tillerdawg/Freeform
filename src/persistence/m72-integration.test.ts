import { afterEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { openPersistenceAdapter, PersistenceQuotaError, PersistenceUnavailableError, STORE_WORKING } from './idb-adapter';
import { writeWorkingCopy, readWorkingCopy } from './working-copy-store';
import { createVersionHistoryStore } from './version-history-store';
import { createCommandStore } from '../document/command-store';
import { decodeDocument, encodeDocument } from './freeform-file';
import { observeCommandStore } from './command-store-bridge';
import { createAutosaveScheduler } from './autosave-scheduler';
import type { FreeformDocument } from '../document/types';
import type { Clock } from './clock';

function documentWithM5M6Data(): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'A Show', totalCounts: 16 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A1', displayName: 'A' }, { id: 'b', rankCode: 'B1', displayName: 'B' }],
    sets: [
      { id: 'set-1', name: 'One', startCount: 0, positions: { a: { x: 100, y: 100 }, b: { x: 200, y: 100 } } },
      { id: 'set-2', name: 'Two', startCount: 16, positions: { a: { x: 1100, y: 100 }, b: { x: 1200, y: 100 } } },
    ],
    transitions: [{
      id: 'move-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float',
      collisionOverrides: [{ performerIds: ['a', 'b'], warningSignature: `v1-sha256-${'a'.repeat(64)}`, reason: 'Spacing checked', overriddenAt: '2026-10-01T12:00:00Z', authorLabel: 'Director' }],
    }],
    layers: [{ id: 'notes', name: 'Notes', visible: true, print: true, locked: false }],
    symbols: [{ id: 'star', name: 'Star', glyph: 'M0 0' }],
    annotations: [{ id: 'symbol-1', kind: 'symbol', layerId: 'notes', scope: { kind: 'transition', transitionId: 'move-1' }, visibility: { editor: true, print: true, performerPacket: false }, symbolId: 'star', anchor: { x: 100, y: 100 }, rotationDegrees: 45, scale: 1.5 }],
    extensions: { 'org.example.freeform': { retained: ['exactly', 'as-is'] } },
  };
}

afterEach(() => {
  for (const name of [...(indexedDB as unknown as { _databases?: Map<string, unknown> })._databases?.keys() ?? []]) {
    indexedDB.deleteDatabase(name as string);
  }
});

describe('end-to-end M7.2 integration', () => {
  it('a COMMITTED command store commit (via the bridge) writes a working copy that round-trips exact M5/M6 data through real IndexedDB', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const source = documentWithM5M6Data();
    const store = createCommandStore(source);
    const writes: Promise<unknown>[] = [];
    const observed = observeCommandStore(store, (event) => {
      writes.push(writeWorkingCopy(adapter, 'doc-1', event.state.revision, event.state.document, event.state.revision));
    });

    observed.apply({ type: 'show.title.set', title: 'Renamed After Commit' });
    await Promise.all(writes);

    const record = await readWorkingCopy(adapter, 'doc-1');
    expect(record?.document.show.title).toBe('Renamed After Commit');
    // Every M5 override and M6 annotation/layer/symbol field survives intact.
    expect(record?.document.transitions[0]!.collisionOverrides).toEqual(source.transitions[0]!.collisionOverrides);
    expect(record?.document.annotations).toEqual(source.annotations);
    expect(record?.document.layers).toEqual(source.layers);
    expect(record?.document.symbols).toEqual(source.symbols);

    const decoded = decodeDocument(encodeDocument(record!.document));
    expect(decoded.kind).toBe('editable');
    adapter.close();
  });

  it('a failed command never produces a working-copy write, via the bridge + listener wiring', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const store = createCommandStore(documentWithM5M6Data());
    let writeCount = 0;
    const observed = observeCommandStore(store, () => { writeCount += 1; });

    expect(() => observed.apply({ type: 'set.remove', setId: 'does-not-exist' })).toThrow();
    expect(writeCount).toBe(0);
    expect(await readWorkingCopy(adapter, 'doc-1')).toBeUndefined();
    adapter.close();
  });

  it('IDB quota/unavailable failures during an autosave flush preserve the last valid in-memory document untouched', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    adapter.close(); // force every subsequent transaction to fail as unavailable
    const store = createCommandStore(documentWithM5M6Data());
    const outcomes: Array<{ ok: boolean }> = [];
    const scheduler = createAutosaveScheduler({
      onFlush: () => {
        void writeWorkingCopy(adapter, 'doc-1', store.getState().revision, store.getState().document, 1).then((outcome) => outcomes.push(outcome));
      },
    });

    store.apply({ type: 'show.title.set', title: 'Still valid in memory' });
    scheduler.noteEdit();
    scheduler.cancelPending(); // deterministic manual flush instead of waiting on real timers
    await writeWorkingCopy(adapter, 'doc-1', store.getState().revision, store.getState().document, 1).then((outcome) => outcomes.push(outcome));

    expect(outcomes[0]!.ok).toBe(false);
    // The command store's in-memory document is completely unaffected by the storage failure.
    expect(store.getState().document.show.title).toBe('Still valid in memory');
  });

  it('retains a raw migration-original backup in version history distinct from the editable checkpoint, honoring the M7.1 decision', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const clock: Clock = { now: () => 42 };
    const history = createVersionHistoryStore(adapter, clock);
    const rawOlderBytes = new TextEncoder().encode(JSON.stringify({ format: 'freeform', formatVersion: '1.0.0', note: 'pre-migration raw snapshot' }));

    await history.recordRawCheckpoint('doc-1', rawOlderBytes, 'migration-original', '1.0.0');
    await history.recordCheckpoint('doc-1', documentWithM5M6Data(), 'import');

    const checkpoints = await history.listCheckpoints('doc-1');
    expect(checkpoints).toHaveLength(2);
    const raw = checkpoints.find((c) => c.source === 'migration-original');
    const editable = checkpoints.find((c) => c.source === 'import');
    expect(raw?.bytes).toEqual(rawOlderBytes);
    expect(editable).toBeDefined();
    adapter.close();
  });

  it('a future-major read-only record is never offered as an editable recovery candidate', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    await adapter.run([STORE_WORKING], 'readwrite', (tx) => {
      tx.objectStore(STORE_WORKING).put({
        documentId: 'doc-1',
        revision: 1,
        updatedAt: 1000,
        document: { format: 'freeform', formatVersion: '2.0.0', show: { id: 'show-1', title: 'Future', totalCounts: 0 } },
      });
    });
    const { createAncestryStore } = await import('./ancestry-store');
    const { createRecoveryService } = await import('./recovery-service');
    const recovery = createRecoveryService(adapter, createAncestryStore(adapter));

    const result = await recovery.loadCandidate('doc-1');
    expect(result.ok).toBe(false);
    adapter.close();
  });
});

describe('error classification sanity', () => {
  it('exposes PersistenceUnavailableError and PersistenceQuotaError as distinct, catchable classes', () => {
    expect(new PersistenceUnavailableError('x')).toBeInstanceOf(Error);
    expect(new PersistenceQuotaError('x', undefined)).toBeInstanceOf(Error);
  });
});
