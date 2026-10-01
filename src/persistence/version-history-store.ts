import type { FreeformDocument } from '../document/types';
import { encodeDocument } from './freeform-file';
import { STORE_HISTORY, requestToPromise, type PersistenceAdapter } from './idb-adapter';
import type { Clock } from './clock';

/** Every immutable checkpoint records why it was taken; `migration-original`
 * is the raw, unmodified byte backup kept before any future migration ever
 * transforms a file (per the M7.1 version-handling decision), distinct from
 * an ordinary current-format `import` checkpoint. */
export type CheckpointSource = 'explicit-save' | 'import' | 'pre-destructive' | 'migration-original';

export interface CheckpointRecord {
  readonly id: string;
  readonly documentId: string;
  readonly createdAt: number;
  readonly sizeBytes: number;
  readonly source: CheckpointSource;
  readonly schemaVersion: string;
  readonly bytes: Uint8Array;
}

export interface VersionHistoryStore {
  /** Encodes and stores a fully valid current-format document as an
   * immutable checkpoint, then prunes this document's history to the
   * retention policy. */
  recordCheckpoint(documentId: string, document: FreeformDocument, source: CheckpointSource): Promise<CheckpointRecord>;
  /** Stores raw bytes verbatim (not necessarily a valid current document —
   * e.g. a future-major file, or a pre-migration original). */
  recordRawCheckpoint(
    documentId: string,
    bytes: Uint8Array,
    source: CheckpointSource,
    schemaVersion: string,
  ): Promise<CheckpointRecord>;
  listCheckpoints(documentId: string): Promise<readonly CheckpointRecord[]>;
}

/** Retain the latest 50 checkpoints OR those from the last 30 days,
 * whichever rule removes a given checkpoint first — i.e. a checkpoint
 * survives only if it is BOTH within the 30-day window AND among the 50
 * most recent for its document. */
export const VERSION_HISTORY_MAX_COUNT = 50;
export const VERSION_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function createVersionHistoryStore(adapter: PersistenceAdapter, clock: Clock): VersionHistoryStore {
  async function insertAndPrune(record: CheckpointRecord): Promise<CheckpointRecord> {
    await adapter.run([STORE_HISTORY], 'readwrite', async (tx) => {
      const store = tx.objectStore(STORE_HISTORY);
      store.put(record);
      const index = store.index('byDocument');
      const all = await requestToPromise(index.getAll(record.documentId) as IDBRequest<CheckpointRecord[]>);
      const cutoff = clock.now() - VERSION_HISTORY_MAX_AGE_MS;
      const keep = all
        .filter((entry) => entry.createdAt >= cutoff)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, VERSION_HISTORY_MAX_COUNT);
      const keepIds = new Set(keep.map((entry) => entry.id));
      for (const entry of all) {
        if (!keepIds.has(entry.id)) store.delete(entry.id);
      }
    });
    return record;
  }

  return {
    async recordCheckpoint(documentId, document, source) {
      const bytes = encodeDocument(document);
      const record: CheckpointRecord = {
        id: checkpointId(documentId, clock.now()),
        documentId,
        createdAt: clock.now(),
        sizeBytes: bytes.byteLength,
        source,
        schemaVersion: document.formatVersion,
        bytes,
      };
      return insertAndPrune(record);
    },
    async recordRawCheckpoint(documentId, bytes, source, schemaVersion) {
      const record: CheckpointRecord = {
        id: checkpointId(documentId, clock.now()),
        documentId,
        createdAt: clock.now(),
        sizeBytes: bytes.byteLength,
        source,
        schemaVersion,
        bytes,
      };
      return insertAndPrune(record);
    },
    async listCheckpoints(documentId) {
      const all = await adapter.run([STORE_HISTORY], 'readonly', (tx) =>
        requestToPromise(tx.objectStore(STORE_HISTORY).index('byDocument').getAll(documentId) as IDBRequest<CheckpointRecord[]>),
      );
      return [...all].sort((a, b) => b.createdAt - a.createdAt);
    },
  };
}

let checkpointSequence = 0;
function checkpointId(documentId: string, timestamp: number): string {
  checkpointSequence += 1;
  return `${documentId}:${timestamp}:${checkpointSequence}`;
}
