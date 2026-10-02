import type { FreeformDocument } from '../document/types';
import type { Clock } from './clock';
import { encodeDocument } from './freeform-file';
import { freeformFilename } from './save-adapter';

/**
 * Backup is a user-named, downloadable/filesystem `.freeform` snapshot,
 * distinct from autosave (IndexedDB, unnamed) and version history
 * (immutable checkpoints). It never assumes background disk overwrite: a
 * filesystem write only ever happens through an already-granted directory
 * handle that was obtained from a prior user gesture, exactly like
 * `save-adapter`'s explicit-file handle model.
 */
export interface BackupDirectoryHandle {
  /** A cached native handle may lose its grant after selection. */
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
  }>;
  keys(): AsyncIterableIterator<string>;
  removeEntry(name: string): Promise<void>;
}

export type BackupResult =
  | Readonly<{ ok: true; method: 'filesystem'; filename: string }>
  | Readonly<{ ok: true; method: 'download'; filename: string }>
  | Readonly<{ ok: false; reason: 'no-destination' | 'write-failed' | 'encode-failed'; message: string }>;

export interface BackupReminderState {
  readonly documentId: string;
  readonly lastPromptedAt?: number;
  readonly unsavedOriginSince?: number;
}

export const BACKUP_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const BACKUP_RETENTION_COUNT = 10;
/** Every backup this service writes carries this infix so retention pruning
 * only ever matches files this service itself created — never an unrelated
 * file a user happens to have in the chosen destination. */
const BACKUP_NAME_INFIX = '.freeform-backup-';

export interface BackupService {
  /** True exactly once per rolling 24h window of unsaved-origin editing,
   * i.e. `reminder.unsavedOriginSince` is set and at least
   * `BACKUP_REMINDER_INTERVAL_MS` has passed since `lastPromptedAt` (or no
   * prompt has ever been recorded for this stretch). */
  shouldPromptForBackup(reminder: BackupReminderState): boolean;
  /** Writes a named backup to the previously chosen destination handle if
   * one is active and permitted; otherwise falls back to a browser
   * download. A denied/revoked permission is reported honestly as a
   * download fallback, never as a silent background filesystem write. */
  writeBackup(
    document: FreeformDocument,
    destination: BackupDirectoryHandle | undefined,
    download: (bytes: Uint8Array, filename: string) => void | Promise<void>,
  ): Promise<BackupResult>;
}

export function createBackupService(clock: Clock): BackupService {
  return {
    shouldPromptForBackup(reminder) {
      if (reminder.unsavedOriginSince === undefined) return false;
      if (reminder.lastPromptedAt === undefined) return true;
      return clock.now() - reminder.lastPromptedAt >= BACKUP_REMINDER_INTERVAL_MS;
    },
    async writeBackup(document, destination, download) {
      let bytes: Uint8Array;
      try {
        bytes = encodeDocument(document);
      } catch (error) {
        return { ok: false, reason: 'encode-failed', message: error instanceof Error ? error.message : String(error) };
      }
      const filename = backupFilename(document.show.title, clock.now());

      if (destination) {
        // A stored handle is not a stored authorization. A revoked grant must
        // take the non-destructive download path before any write or prune.
        if (!await hasCurrentWritePermission(destination)) return downloadBackup(bytes, filename, download);
        try {
          const fileHandle = await destination.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(bytes);
          await writable.close();
          // Retention deletes data, so it receives its own current-grant gate.
          if (await hasCurrentWritePermission(destination)) await enforceRetention(destination, document.show.title);
          return { ok: true, method: 'filesystem', filename };
        } catch (error) {
          return { ok: false, reason: 'write-failed', message: error instanceof Error ? error.message : String(error) };
        }
      }

      return downloadBackup(bytes, filename, download);
    },
  };
}

async function hasCurrentWritePermission(destination: BackupDirectoryHandle): Promise<boolean> {
  // Non-native test doubles and unsupported browsers have no query method;
  // their actual write remains guarded by the catch below. A handle that can
  // report denial, however, is never used.
  return (await destination.queryPermission?.({ mode: 'readwrite' })) !== 'denied';
}

async function downloadBackup(
  bytes: Uint8Array,
  filename: string,
  download: (bytes: Uint8Array, filename: string) => void | Promise<void>,
): Promise<BackupResult> {
  try {
    await download(bytes, filename);
    return { ok: true, method: 'download', filename };
  } catch (error) {
    return { ok: false, reason: 'write-failed', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Backup filenames are deterministic and ordered: `<base>.freeform-backup-<ISO
 * millis>.freeform`. The infix makes ownership unambiguous and the
 * millisecond timestamp makes lexical sort equal chronological sort, so
 * retention pruning never needs to parse an unrelated filename. */
function backupFilename(title: string, timestamp: number): string {
  const base = freeformFilename(title).replace(/\.freeform$/, '');
  return `${base}${BACKUP_NAME_INFIX}${timestamp}.freeform`;
}

function ownedBackupPrefix(title: string): string {
  return `${freeformFilename(title).replace(/\.freeform$/, '')}${BACKUP_NAME_INFIX}`;
}

async function enforceRetention(destination: BackupDirectoryHandle, title: string): Promise<void> {
  const prefix = ownedBackupPrefix(title);
  const owned: string[] = [];
  for await (const name of destination.keys()) {
    if (name.startsWith(prefix) && name.endsWith('.freeform')) owned.push(name);
  }
  owned.sort().reverse(); // newest timestamp first, lexical == chronological
  for (const stale of owned.slice(BACKUP_RETENTION_COUNT)) {
    await destination.removeEntry(stale);
  }
}
