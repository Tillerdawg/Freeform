import { afterEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { openPersistenceAdapter } from './idb-adapter';
import {
  createVersionHistoryStore,
  VERSION_HISTORY_MAX_AGE_MS,
  VERSION_HISTORY_MAX_COUNT,
} from './version-history-store';
import type { Clock } from './clock';
import type { FreeformDocument } from '../document/types';

function makeDocument(title = 'A Show'): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'show-1', title, totalCounts: 0 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A1', displayName: 'A' }],
    sets: [{ id: 'set-1', name: 'One', startCount: 0, positions: { a: { x: 0, y: 0 } } }],
    transitions: [], annotations: [],
  };
}

function fakeClock(initial: number): Clock & { set(value: number): void } {
  let current = initial;
  return { now: () => current, set: (value) => { current = value; } };
}

afterEach(() => {
  for (const name of [...(indexedDB as unknown as { _databases?: Map<string, unknown> })._databases?.keys() ?? []]) {
    indexedDB.deleteDatabase(name as string);
  }
});

describe('version history store', () => {
  it('records an explicit-save checkpoint with timestamp/size/source/schema metadata', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const clock = fakeClock(1_000_000);
    const history = createVersionHistoryStore(adapter, clock);

    const record = await history.recordCheckpoint('doc-1', makeDocument(), 'explicit-save');
    expect(record.source).toBe('explicit-save');
    expect(record.createdAt).toBe(1_000_000);
    expect(record.schemaVersion).toBe('1.0.0');
    expect(record.sizeBytes).toBeGreaterThan(0);

    const all = await history.listCheckpoints('doc-1');
    expect(all).toHaveLength(1);
    adapter.close();
  });

  it('retains exactly the latest 50 checkpoints when the 50-count boundary is crossed within 30 days', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const clock = fakeClock(0);
    const history = createVersionHistoryStore(adapter, clock);

    for (let i = 0; i < 52; i += 1) {
      clock.set(i * 1000); // all well within 30 days of each other
      await history.recordCheckpoint('doc-1', makeDocument(`Checkpoint ${i}`), 'import');
    }

    const all = await history.listCheckpoints('doc-1');
    expect(all).toHaveLength(VERSION_HISTORY_MAX_COUNT);
    // The oldest two (i=0,1) must have been pruned; the newest (i=51) kept.
    expect(all[0]!.createdAt).toBe(51000);
    expect(all.find((entry) => entry.createdAt === 0)).toBeUndefined();
    expect(all.find((entry) => entry.createdAt === 1000)).toBeUndefined();
    expect(all.find((entry) => entry.createdAt === 2000)).toBeDefined();
    adapter.close();
  });

  it('prunes a checkpoint older than exactly 30 days even when fewer than 50 exist', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const clock = fakeClock(0);
    const history = createVersionHistoryStore(adapter, clock);

    await history.recordCheckpoint('doc-1', makeDocument('Old'), 'explicit-save');
    // Advance to exactly 30 days + 1ms later and write a second checkpoint,
    // which triggers the prune pass with "now" at that later time.
    clock.set(VERSION_HISTORY_MAX_AGE_MS + 1);
    await history.recordCheckpoint('doc-1', makeDocument('New'), 'explicit-save');

    const all = await history.listCheckpoints('doc-1');
    expect(all).toHaveLength(1);
    expect(all[0]!.createdAt).toBe(VERSION_HISTORY_MAX_AGE_MS + 1);
    adapter.close();
  });

  it('keeps a checkpoint at exactly the 30-day boundary (cutoff is inclusive)', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const clock = fakeClock(0);
    const history = createVersionHistoryStore(adapter, clock);

    await history.recordCheckpoint('doc-1', makeDocument('Boundary'), 'explicit-save');
    clock.set(VERSION_HISTORY_MAX_AGE_MS); // exactly 30 days later, not over
    await history.recordCheckpoint('doc-1', makeDocument('Trigger prune'), 'explicit-save');

    const all = await history.listCheckpoints('doc-1');
    expect(all).toHaveLength(2);
    expect(all.find((entry) => entry.createdAt === 0)).toBeDefined();
    adapter.close();
  });

  it('keeps version history for separate documents independent', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const clock = fakeClock(0);
    const history = createVersionHistoryStore(adapter, clock);

    await history.recordCheckpoint('doc-a', makeDocument('A'), 'explicit-save');
    await history.recordCheckpoint('doc-b', makeDocument('B'), 'explicit-save');

    expect(await history.listCheckpoints('doc-a')).toHaveLength(1);
    expect(await history.listCheckpoints('doc-b')).toHaveLength(1);
    adapter.close();
  });

  it('records a raw migration-original checkpoint verbatim without requiring a valid current document', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const clock = fakeClock(5000);
    const history = createVersionHistoryStore(adapter, clock);
    const rawBytes = new TextEncoder().encode('{"format":"freeform","formatVersion":"0.9.0"}');

    const record = await history.recordRawCheckpoint('doc-1', rawBytes, 'migration-original', '0.9.0');
    expect(record.source).toBe('migration-original');
    expect(record.schemaVersion).toBe('0.9.0');
    expect(record.bytes).toEqual(rawBytes);
    adapter.close();
  });
});
