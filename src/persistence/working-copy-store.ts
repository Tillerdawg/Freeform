import type { FreeformDocument } from '../document/types';
import {
  PersistenceQuotaError,
  PersistenceUnavailableError,
  STORE_WORKING,
  requestToPromise,
  type PersistenceAdapter,
} from './idb-adapter';

/** One record per document: the continuously-refreshed mirror of the
 * in-memory document, keyed by `documentId` so switching the active document
 * never risks mixing records. */
export interface WorkingCopyRecord {
  readonly documentId: string;
  readonly revision: number;
  readonly document: FreeformDocument;
  readonly updatedAt: number;
}

export type WriteOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: 'stale-revision'; currentRevision: number }>
  | Readonly<{ ok: false; reason: 'unavailable'; message: string }>
  | Readonly<{ ok: false; reason: 'quota-exceeded'; message: string }>
  | Readonly<{ ok: false; reason: 'storage-error'; message: string }>;

/**
 * Writes the working copy for one document, but only if `revision` is newer
 * than whatever is already stored. This is the single ordering guard that
 * makes a slow or out-of-order write unable to clobber a newer one — no
 * matter which caller (idle debounce, deadline flush, explicit save) races
 * to write last, the highest revision always wins and an older write simply
 * reports `stale-revision` instead of corrupting the record.
 *
 * A failure here never touches the in-memory document or command-store
 * state; it only means this particular durability layer did not confirm the
 * write, which the caller must report honestly rather than claim success.
 */
export async function writeWorkingCopy(
  adapter: PersistenceAdapter,
  documentId: string,
  revision: number,
  document: FreeformDocument,
  updatedAt: number,
): Promise<WriteOutcome> {
  try {
    return await adapter.run([STORE_WORKING], 'readwrite', async (tx) => {
      const store = tx.objectStore(STORE_WORKING);
      const existing = (await requestToPromise(
        store.get(documentId) as IDBRequest<WorkingCopyRecord | undefined>,
      ));
      if (existing && existing.revision >= revision) {
        return { ok: false, reason: 'stale-revision', currentRevision: existing.revision } as const;
      }
      store.put({ documentId, revision, document, updatedAt } satisfies WorkingCopyRecord);
      return { ok: true } as const;
    });
  } catch (error) {
    if (error instanceof PersistenceUnavailableError) return { ok: false, reason: 'unavailable', message: error.message };
    if (error instanceof PersistenceQuotaError) return { ok: false, reason: 'quota-exceeded', message: error.message };
    return { ok: false, reason: 'storage-error', message: error instanceof Error ? error.message : String(error) };
  }
}

export async function readWorkingCopy(
  adapter: PersistenceAdapter,
  documentId: string,
): Promise<WorkingCopyRecord | undefined> {
  return adapter.run([STORE_WORKING], 'readonly', (tx) =>
    requestToPromise(tx.objectStore(STORE_WORKING).get(documentId) as IDBRequest<WorkingCopyRecord | undefined>),
  );
}

/** Removes only this document's working-copy record. Used by the recovery
 * service's "discard candidate" action; it never touches version history or
 * any other document's record. */
export async function discardWorkingCopy(adapter: PersistenceAdapter, documentId: string): Promise<void> {
  await adapter.run([STORE_WORKING], 'readwrite', (tx) => {
    tx.objectStore(STORE_WORKING).delete(documentId);
  });
}
