import { afterEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { openPersistenceAdapter, STORE_WORKING } from './idb-adapter';
import { writeWorkingCopy } from './working-copy-store';
import { createAncestryStore } from './ancestry-store';
import { createRecoveryService } from './recovery-service';
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
  for (const name of [...(indexedDB as unknown as { _databases?: Map<string, unknown> })._databases?.keys() ?? []]) {
    indexedDB.deleteDatabase(name as string);
  }
});

describe('recovery service', () => {
  it('lists a candidate when the working copy has no ancestry baseline at all', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);

    await writeWorkingCopy(adapter, 'doc-1', 1, makeDocument('Never saved'), 5000);
    const candidates = await recovery.listCandidates(['doc-1']);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ documentId: 'doc-1', title: 'Never saved', source: 'indexeddb-working-copy', timestamp: 5000, schemaVersion: '1.0.0' });
    adapter.close();
  });

  it('lists a candidate when the working copy is strictly newer than the explicit-file baseline', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);

    await ancestry.setBaseline({ documentId: 'doc-1', title: 'Saved', source: 'file-system-access', timestamp: 1000, schemaVersion: '1.0.0' });
    await writeWorkingCopy(adapter, 'doc-1', 2, makeDocument('Newer edits'), 2000);

    const candidates = await recovery.listCandidates(['doc-1']);
    expect(candidates).toHaveLength(1);
    adapter.close();
  });

  it('does NOT list a candidate when the working copy exactly matches the baseline timestamp', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);

    await ancestry.setBaseline({ documentId: 'doc-1', title: 'Saved', source: 'download', timestamp: 1000, schemaVersion: '1.0.0' });
    await writeWorkingCopy(adapter, 'doc-1', 1, makeDocument('In sync'), 1000);

    expect(await recovery.listCandidates(['doc-1'])).toHaveLength(0);
    adapter.close();
  });

  it('does NOT list a candidate when the working copy is older than or equal to the baseline', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);

    await ancestry.setBaseline({ documentId: 'doc-1', title: 'Saved', source: 'file-system-access', timestamp: 9000, schemaVersion: '1.0.0' });
    await writeWorkingCopy(adapter, 'doc-1', 1, makeDocument('Stale'), 1000);

    expect(await recovery.listCandidates(['doc-1'])).toHaveLength(0);
    adapter.close();
  });

  it('a successful download fallback counts as a baseline exactly like a direct write', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);

    await ancestry.setBaseline({ documentId: 'doc-1', title: 'Saved', source: 'download', timestamp: 5000, schemaVersion: '1.0.0' });
    await writeWorkingCopy(adapter, 'doc-1', 1, makeDocument('Not newer'), 4000);

    expect(await recovery.listCandidates(['doc-1'])).toHaveLength(0);
    adapter.close();
  });

  it('orders multiple candidates newest-first', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);

    await writeWorkingCopy(adapter, 'doc-old', 1, makeDocument('Older candidate'), 1000);
    await writeWorkingCopy(adapter, 'doc-new', 1, makeDocument('Newer candidate'), 9000);

    const candidates = await recovery.listCandidates(['doc-old', 'doc-new']);
    expect(candidates.map((c) => c.documentId)).toEqual(['doc-new', 'doc-old']);
    adapter.close();
  });

  it('loadCandidate returns not-found when there is no working copy for the document', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);

    expect(await recovery.loadCandidate('missing-doc')).toEqual({ ok: false, reason: 'not-found' });
    adapter.close();
  });

  it('loadCandidate validates before returning, rejecting a corrupted record instead of silently loading it', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);

    // Write a corrupted record directly (bypassing the codec) to simulate
    // storage-layer corruption that writeWorkingCopy would never produce on
    // its own.
    await adapter.run([STORE_WORKING], 'readwrite', (tx) => {
      tx.objectStore(STORE_WORKING).put({ documentId: 'doc-1', revision: 1, updatedAt: 1000, document: { format: 'freeform', formatVersion: '1.0.0', show: { id: 'x' } } });
    });

    const result = await recovery.loadCandidate('doc-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
    adapter.close();
  });

  it('loadCandidate / confirmReplace return the valid document on success without mutating any store', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);
    const document = makeDocument('Good candidate');
    await writeWorkingCopy(adapter, 'doc-1', 1, document, 1000);

    const loaded = await recovery.loadCandidate('doc-1');
    expect(loaded).toEqual({ ok: true, document });
    const confirmed = await recovery.confirmReplace('doc-1');
    expect(confirmed).toEqual({ ok: true, document });
    adapter.close();
  });

  it('exportBackupBytes returns valid encoded bytes without discarding the candidate', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);
    const document = makeDocument('Exportable');
    await writeWorkingCopy(adapter, 'doc-1', 1, document, 1000);

    const bytes = await recovery.exportBackupBytes('doc-1');
    expect(bytes).toBeDefined();
    expect(JSON.parse(new TextDecoder().decode(bytes!)).show.title).toBe('Exportable');

    // Still present after export — export never discards.
    expect(await recovery.loadCandidate('doc-1')).toMatchObject({ ok: true });
    adapter.close();
  });

  it('discardCandidate removes only this document working copy, leaving others intact', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    const recovery = createRecoveryService(adapter, ancestry);
    await writeWorkingCopy(adapter, 'doc-1', 1, makeDocument('Discard me'), 1000);
    await writeWorkingCopy(adapter, 'doc-2', 1, makeDocument('Keep me'), 1000);

    await recovery.discardCandidate('doc-1');

    expect(await recovery.loadCandidate('doc-1')).toEqual({ ok: false, reason: 'not-found' });
    expect(await recovery.loadCandidate('doc-2')).toMatchObject({ ok: true });
    adapter.close();
  });
});
