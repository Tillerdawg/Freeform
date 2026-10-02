import type { FreeformDocument } from '../document/types';
import { encodeDocument, FREEFORM_FILE_EXTENSION } from './freeform-file';

export interface FileSystemWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface SaveFileHandle {
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  createWritable(): Promise<FileSystemWritable>;
}

export interface SaveAdapterEnvironment {
  readonly showSaveFilePicker?: (options: {
    suggestedName: string;
    types: readonly { description: string; accept: Record<string, readonly string[]> }[];
  }) => Promise<SaveFileHandle>;
  /** Browser-only download dispatch, injected for testability. It must not resolve
   * until the click/dispatch has happened. */
  readonly download?: (bytes: Uint8Array, filename: string) => void | Promise<void>;
}

export type SaveRequest = Readonly<{
  operation: 'save' | 'save-as';
  title: string;
  activeHandle?: SaveFileHandle;
}>;

export type SaveResult =
  | Readonly<{ ok: true; method: 'file-system-access'; handle: SaveFileHandle; bytes: Uint8Array; filename: string }>
  | Readonly<{ ok: true; method: 'download'; bytes: Uint8Array; filename: string }>
  | Readonly<{ ok: false; reason: 'permission-denied' | 'cancelled' | 'write-failed' | 'download-failed' | 'encode-failed'; message: string }>;

/**
 * A user-gesture boundary calls this function. It validates and creates bytes
 * before choosing I/O; no save result is reported until close() or download
 * dispatch has completed. Callers must leave dirty/checkpoint state unchanged
 * when `ok` is false.
 */
export async function saveExplicitSnapshot(
  document: FreeformDocument,
  request: SaveRequest,
  environment: SaveAdapterEnvironment = defaultSaveEnvironment(),
): Promise<SaveResult> {
  let bytes: Uint8Array;
  try {
    bytes = encodeDocument(document);
  } catch (error) {
    return failure('encode-failed', error);
  }
  const filename = freeformFilename(request.title);

  if (request.operation === 'save' && request.activeHandle) {
    return writeActiveHandle(bytes, filename, request.activeHandle);
  }

  if (request.operation === 'save-as' && environment.showSaveFilePicker) {
    let handle: SaveFileHandle;
    try {
      handle = await environment.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Freeform show file', accept: { 'application/json': [FREEFORM_FILE_EXTENSION] } }],
      });
    } catch (error) {
      return failure(isAbort(error) ? 'cancelled' : 'write-failed', error);
    }
    return writeActiveHandle(bytes, filename, handle);
  }

  if (!environment.download) {
    return { ok: false, reason: 'download-failed', message: 'No download adapter is available in this environment.' };
  }
  try {
    await environment.download(bytes, filename);
    return { ok: true, method: 'download', bytes, filename };
  } catch (error) {
    return failure('download-failed', error);
  }
}

/** Browser implementation kept separate from policy so unit tests do not need DOM. */
export function browserDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function freeformFilename(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled-show';
  return base.toLowerCase().endsWith(FREEFORM_FILE_EXTENSION) ? base : `${base}${FREEFORM_FILE_EXTENSION}`;
}

async function writeActiveHandle(bytes: Uint8Array, filename: string, handle: SaveFileHandle): Promise<SaveResult> {
  try {
    const existingPermission = await handle.queryPermission?.({ mode: 'readwrite' });
    const permission = existingPermission === 'granted' ? 'granted' : await handle.requestPermission?.({ mode: 'readwrite' });
    if (permission !== 'granted') {
      return { ok: false, reason: 'permission-denied', message: 'File write permission was not granted; the working document remains unsaved.' };
    }
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return { ok: true, method: 'file-system-access', handle, bytes, filename };
  } catch (error) {
    return failure(isAbort(error) ? 'cancelled' : 'write-failed', error);
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function failure(reason: Extract<SaveResult, { ok: false }>['reason'], error: unknown): Extract<SaveResult, { ok: false }> {
  return { ok: false, reason, message: error instanceof Error ? error.message : String(error) };
}

function defaultSaveEnvironment(): SaveAdapterEnvironment {
  return {
    showSaveFilePicker: (globalThis as unknown as SaveAdapterEnvironment).showSaveFilePicker,
    download: browserDownload,
  };
}
