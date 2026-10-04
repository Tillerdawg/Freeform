import type { PdfExportErrorCode } from './contracts';

export interface PdfDownloadEnvironment {
  readonly Blob?: typeof Blob;
  readonly URL?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  readonly document?: Pick<Document, 'body' | 'createElement'>;
}

export type PdfDownloadResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: Extract<PdfExportErrorCode, 'blob-unavailable' | 'url-unavailable' | 'download-dispatch-failed' | 'cancelled'> }>;

/**
 * Browser-only dispatch. An anchor click has no observable native-picker cancel signal,
 * so "cancel" at this layer means the caller aborted before dispatch (e.g. the user
 * dismissed the export while async PDF bytes were already built) rather than a browser
 * save-dialog cancel, which this adapter cannot observe.
 */
export function downloadPdf(
  bytes: Uint8Array,
  filename: string,
  environment: PdfDownloadEnvironment = globalThis,
  options: Readonly<{ cancelled?: boolean }> = {},
): PdfDownloadResult {
  if (options.cancelled) return { ok: false, code: 'cancelled' };
  const BlobConstructor = environment.Blob;
  if (!BlobConstructor) return { ok: false, code: 'blob-unavailable' };
  let blob: Blob;
  try {
    blob = new BlobConstructor([bytes], { type: 'application/pdf' });
  } catch {
    return { ok: false, code: 'blob-unavailable' };
  }
  const urlApi = environment.URL;
  if (!urlApi) return { ok: false, code: 'url-unavailable' };
  let objectUrl: string;
  try {
    objectUrl = urlApi.createObjectURL(blob);
  } catch {
    return { ok: false, code: 'url-unavailable' };
  }
  let anchor: HTMLAnchorElement | undefined;
  let dispatched = false;
  try {
    const page = environment.document;
    if (!page?.body) return { ok: false, code: 'download-dispatch-failed' };
    anchor = page.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    page.body.append(anchor);
    anchor.click();
    dispatched = true;
    return { ok: true };
  } catch {
    return { ok: false, code: 'download-dispatch-failed' };
  } finally {
    // Dispatch success is not retroactively a failure because best-effort DOM/URL
    // cleanup failed.  Conversely, cleanup must still run after append or click
    // throws so an invisible appended anchor is never retained when removable.
    try { anchor?.remove(); } catch { /* cleanup has no observable contract */ }
    // A same-turn revoke can race Chromium's navigation/download handoff. Keep
    // the object URL alive through the current task after a successful click;
    // failed setup/dispatch still cleans it synchronously.
    if (dispatched) setTimeout(() => { try { urlApi.revokeObjectURL(objectUrl); } catch { /* cleanup has no observable contract */ } }, 0);
    else try { urlApi.revokeObjectURL(objectUrl); } catch { /* cleanup has no observable contract */ }
  }
}
