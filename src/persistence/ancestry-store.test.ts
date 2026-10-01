import { afterEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { openPersistenceAdapter } from './idb-adapter';
import { createAncestryStore } from './ancestry-store';

afterEach(() => {
  for (const name of [...(indexedDB as unknown as { _databases?: Map<string, unknown> })._databases?.keys() ?? []]) {
    indexedDB.deleteDatabase(name as string);
  }
});

describe('ancestry store', () => {
  it('returns undefined baseline when none has ever been recorded', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    expect(await ancestry.getBaseline('doc-1')).toBeUndefined();
    adapter.close();
  });

  it('records and retrieves a file-system-access baseline', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    await ancestry.setBaseline({ documentId: 'doc-1', title: 'Show', source: 'file-system-access', timestamp: 1000, schemaVersion: '1.0.0' });
    expect(await ancestry.getBaseline('doc-1')).toMatchObject({ source: 'file-system-access', timestamp: 1000 });
    adapter.close();
  });

  it('records a successful download-fallback baseline identically to a direct write semantically', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    await ancestry.setBaseline({ documentId: 'doc-1', title: 'Show', source: 'download', timestamp: 2000, schemaVersion: '1.0.0' });
    expect(await ancestry.getBaseline('doc-1')).toMatchObject({ source: 'download', timestamp: 2000 });
    adapter.close();
  });

  it('overwrites the baseline for a document on a newer save without disturbing other documents', async () => {
    const adapter = await openPersistenceAdapter({ indexedDB });
    const ancestry = createAncestryStore(adapter);
    await ancestry.setBaseline({ documentId: 'doc-1', title: 'Show', source: 'file-system-access', timestamp: 1000, schemaVersion: '1.0.0' });
    await ancestry.setBaseline({ documentId: 'doc-2', title: 'Other', source: 'import', timestamp: 500, schemaVersion: '1.0.0' });
    await ancestry.setBaseline({ documentId: 'doc-1', title: 'Show', source: 'file-system-access', timestamp: 3000, schemaVersion: '1.0.0' });

    expect(await ancestry.getBaseline('doc-1')).toMatchObject({ timestamp: 3000 });
    expect(await ancestry.getBaseline('doc-2')).toMatchObject({ timestamp: 500 });
    adapter.close();
  });
});
