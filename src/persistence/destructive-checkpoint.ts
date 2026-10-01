import type { CommandStore } from '../document/types';
import type { VersionHistoryStore } from './version-history-store';

export type DestructiveOperationResult<T> =
  | Readonly<{ ok: true; result: T }>
  | Readonly<{ ok: false; reason: 'checkpoint-failed'; message: string }>;

/**
 * Minimal hook any bulk/destructive mutation must go through: it records an
 * immutable "pre-destructive" version-history checkpoint of the CURRENT
 * valid document before running `operation`. If the checkpoint write fails
 * for any reason (quota, storage unavailable, IDB error), `operation` is
 * never invoked — a failed safety net must never silently authorize data
 * loss, so the destructive change simply does not happen and the caller
 * gets an actionable reason instead of an unexplained no-op.
 */
export async function runWithDestructiveCheckpoint<T>(
  store: CommandStore,
  documentId: string,
  versionHistory: VersionHistoryStore,
  operation: () => T,
): Promise<DestructiveOperationResult<T>> {
  try {
    await versionHistory.recordCheckpoint(documentId, store.getState().document, 'pre-destructive');
  } catch (error) {
    return { ok: false, reason: 'checkpoint-failed', message: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, result: operation() };
}
