import type { FreeformDocument } from '../document/types';
import type { AncestryStore, FileBaseline } from './ancestry-store';
import { decodeDocument, type DecodeResult } from './freeform-file';
import { discardWorkingCopy, readWorkingCopy, type WorkingCopyRecord } from './working-copy-store';
import type { PersistenceAdapter } from './idb-adapter';

/**
 * A candidate is only ever surfaced when the IndexedDB working copy is
 * genuinely newer than the document's explicit-file ancestry baseline (or
 * there is no baseline at all, meaning the document was never saved/opened
 * as a file). "Newer" is a strict timestamp comparison: equal timestamps do
 * NOT produce a candidate, because the working copy is then known to match
 * the file, not to carry unsaved edits beyond it.
 */
export interface RecoveryCandidate {
  readonly documentId: string;
  readonly title: string;
  readonly source: 'indexeddb-working-copy';
  readonly timestamp: number;
  readonly schemaVersion: string;
}

export type CandidateLoadResult =
  | Readonly<{ ok: true; document: FreeformDocument }>
  | Readonly<{ ok: false; reason: 'invalid'; message: string }>
  | Readonly<{ ok: false; reason: 'not-found' }>;

export interface RecoveryService {
  /** Lists candidates across every document whose working copy is strictly
   * newer than its ancestry baseline (or has none). Candidates are ordered
   * newest-first so the most urgent recovery decision surfaces first. */
  listCandidates(documentIds: readonly string[]): Promise<readonly RecoveryCandidate[]>;
  /** Validates the stored working copy before returning it; a corrupted or
   * schema-invalid record is reported, never silently loaded, and the
   * caller's current valid in-memory document is left completely alone. */
  loadCandidate(documentId: string): Promise<CandidateLoadResult>;
  /** The caller has confirmed replacing current working state; this does not
   * itself apply the document — it is the validation+fetch step the caller
   * uses immediately before issuing its own `document.replace` command. */
  confirmReplace(documentId: string): Promise<CandidateLoadResult>;
  /** Exports the raw working-copy bytes for backup without touching
   * ancestry or discarding anything. */
  exportBackupBytes(documentId: string): Promise<Uint8Array | undefined>;
  /** Discards a candidate (deletes only this document's working copy),
   * leaving any explicit file and version history completely untouched. */
  discardCandidate(documentId: string): Promise<void>;
}

export function createRecoveryService(adapter: PersistenceAdapter, ancestry: AncestryStore): RecoveryService {
  async function loadValidated(documentId: string): Promise<CandidateLoadResult> {
    const record = await readWorkingCopy(adapter, documentId);
    if (!record) return { ok: false, reason: 'not-found' };
    try {
      const decoded: DecodeResult = decodeDocument(new TextEncoder().encode(JSON.stringify(record.document)));
      if (decoded.kind !== 'editable') {
        return { ok: false, reason: 'invalid', message: 'The stored working copy is a future-major, read-only document and cannot be loaded as a recovery candidate.' };
      }
      return { ok: true, document: decoded.document };
    } catch (error) {
      return { ok: false, reason: 'invalid', message: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    async listCandidates(documentIds) {
      const candidates: RecoveryCandidate[] = [];
      for (const documentId of documentIds) {
        const [working, baseline] = await Promise.all([
          readWorkingCopy(adapter, documentId),
          ancestry.getBaseline(documentId),
        ]);
        if (!working) continue;
        if (isNewerThanBaseline(working, baseline)) {
          candidates.push({
            documentId,
            title: working.document.show.title,
            source: 'indexeddb-working-copy',
            timestamp: working.updatedAt,
            schemaVersion: working.document.formatVersion,
          });
        }
      }
      return candidates.sort((a, b) => b.timestamp - a.timestamp);
    },
    loadCandidate: loadValidated,
    confirmReplace: loadValidated,
    async exportBackupBytes(documentId) {
      const record = await readWorkingCopy(adapter, documentId);
      return record ? new TextEncoder().encode(JSON.stringify(record.document)) : undefined;
    },
    async discardCandidate(documentId) {
      await discardWorkingCopy(adapter, documentId);
    },
  };
}

function isNewerThanBaseline(working: WorkingCopyRecord, baseline: FileBaseline | undefined): boolean {
  if (!baseline) return true;
  return working.updatedAt > baseline.timestamp;
}
