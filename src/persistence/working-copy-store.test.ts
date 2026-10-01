import { afterEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { openPersistenceAdapter, PersistenceUnavailableError, STORE_WORKING } from './idb-adapter';
import { readWorkingCopy, writeWorkingCopy } from './working-copy-store';
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

afterEach(() => {
  // fake-indexeddb/auto installs a fresh global indexedDB; reset its
  // in-memory databases between tests so working-copy races stay isolated.
  for (const name of [...(indexedDB as unknown as { _databases?: Map<string, unknown> })._databases?.keys() ?? []]) {
    indexedDB.deleteDatabase(name as string);
  }
});

describe('idb-adapter', () => {
  it('reports PersistenceUnavailableError actionable when indexedDB is absent, never throwing a raw error', async () => {
    await expect(openPersistenceAdapter({ indexedDB: undefined })).rejects.toBeInstanceOf(PersistenceUnavailableError);
  });

  it('opens a real fake-IDB connection and creates the expected object stores', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const names = await adapter.run([STORE_WORKING], 'readonly', (tx) => tx.objectStore(STORE_WORKING).indexNames);
    expect(names).toBeDefined();
    adapter.close();
  });
});

describe('working-copy-store', () => {
  it('writes and reads back a working copy through a real async IDB transaction', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const document = makeDocument();
    const outcome = await writeWorkingCopy(adapter, 'doc-1', 1, document, 1000);
    expect(outcome).toEqual({ ok: true });

    const record = await readWorkingCopy(adapter, 'doc-1');
    expect(record?.document).toEqual(document);
    expect(record?.revision).toBe(1);
    adapter.close();
  });

  it('rejects a stale/out-of-order write and keeps the newer revision intact', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const newer = makeDocument('Newer');
    const older = makeDocument('Older (stale)');

    await writeWorkingCopy(adapter, 'doc-1', 5, newer, 5000);
    const staleOutcome = await writeWorkingCopy(adapter, 'doc-1', 3, older, 3000);

    expect(staleOutcome).toEqual({ ok: false, reason: 'stale-revision', currentRevision: 5 });
    const record = await readWorkingCopy(adapter, 'doc-1');
    expect(record?.document.show.title).toBe('Newer');
    expect(record?.revision).toBe(5);
    adapter.close();
  });

  it('a write that arrives in true race order (later call, lower revision) still cannot replace the newer revision', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    // Simulate two concurrent writers racing: revision 2 is issued first by
    // wall-clock call order but revision 7 settles its transaction first.
    const writeHigh = writeWorkingCopy(adapter, 'doc-1', 7, makeDocument('High'), 7000);
    const writeLow = writeWorkingCopy(adapter, 'doc-1', 2, makeDocument('Low'), 2000);
    const [highResult, lowResult] = await Promise.all([writeHigh, writeLow]);

    expect(highResult.ok).toBe(true);
    expect(lowResult).toEqual({ ok: false, reason: 'stale-revision', currentRevision: 7 });
    const record = await readWorkingCopy(adapter, 'doc-1');
    expect(record?.revision).toBe(7);
    adapter.close();
  });

  it('keeps independent working copies per document so a cross-document switch cannot cross-contaminate', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    await writeWorkingCopy(adapter, 'doc-a', 1, makeDocument('Doc A'), 1000);
    await writeWorkingCopy(adapter, 'doc-b', 1, makeDocument('Doc B'), 1000);

    const a = await readWorkingCopy(adapter, 'doc-a');
    const b = await readWorkingCopy(adapter, 'doc-b');
    expect(a?.document.show.title).toBe('Doc A');
    expect(b?.document.show.title).toBe('Doc B');
    adapter.close();
  });
});
