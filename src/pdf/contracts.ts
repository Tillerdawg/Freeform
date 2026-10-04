import type { FreeformDocument, Identifier } from '../document/types';

export const PDF_LANGUAGE = 'en-US';
export const PDF_PRODUCER = 'Freeform PDF export';
export const LETTER_PORTRAIT = Object.freeze({ width: 612, height: 792 });
export const LETTER_LANDSCAPE = Object.freeze({ width: 792, height: 612 });
export const DIRECTOR_FIELD_RECT = Object.freeze({ x: 36, y: 102, width: 720, height: 384 });

export type PdfScope =
  | Readonly<{ kind: 'full-show' }>
  | Readonly<{ kind: 'inclusive-set-range'; firstSetId: Identifier; lastSetId: Identifier }>;

export interface PdfTransitionFrameRequest {
  readonly transitionId: Identifier;
  readonly counts: readonly number[];
}

export type PdfExportRequest =
  | Readonly<{ kind: 'director'; scope: PdfScope; transitionFrames: readonly PdfTransitionFrameRequest[] }>
  | Readonly<{ kind: 'performer-packet'; performerIds: readonly Identifier[]; scope: PdfScope }>;

export interface PdfFontAsset {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly sourceUrl: string;
  readonly license: string;
  /**
   * Whether to embed this font as a fontkit subset (true) or full/complete (false).
   * Full embed is required for fonts whose glyphs trigger @pdf-lib/fontkit's TTFSubset
   * last-glyph-last-byte truncation bug (see evidence/m8-pdf-foundation/qualification.json);
   * such fonts must also supply raw TTF/OTF bytes, not WOFF, since pdf-lib's full-embed
   * path does not unwrap a WOFF container.
   */
  readonly subset: boolean;
}

export interface PdfAssets {
  readonly fonts: readonly PdfFontAsset[];
}

export type PdfPageContext =
  | Readonly<{ kind: 'static-set'; setId: Identifier }>
  | Readonly<{ kind: 'active-transition'; transitionId: Identifier; count: number }>;

export interface PdfManifestPage {
  readonly kind: 'director' | 'performer-packet';
  readonly width: number;
  readonly height: number;
  readonly context?: PdfPageContext;
  readonly performerId?: Identifier;
  readonly setIds: readonly Identifier[];
  readonly annotationIds: readonly Identifier[];
  /** Packet pages can carry multiple independently scoped entries. */
  readonly packetEntries?: readonly Readonly<{
    readonly context: PdfPageContext;
    readonly annotationIds: readonly Identifier[];
  }>[];
}

export interface PdfExportManifest {
  readonly schemaVersion: 'm8.2';
  readonly contentFingerprint: string;
  readonly request: PdfExportRequest;
  readonly pages: readonly PdfManifestPage[];
  readonly language: typeof PDF_LANGUAGE;
  readonly fontAssetHashes: readonly string[];
  /** Semantic rendering evidence. Director exports have only calculated warnings. */
  readonly warnings: readonly PdfWarning[];
}

export interface PdfBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FoundationLayoutWarning {
  readonly code: 'foundation-layout-not-rendered';
  readonly detail: string;
}

/** A calculated, advisory intersection between a rendered note box and a mark. */
export interface NoteOverlapWarning {
  readonly code: 'note-overlap';
  readonly pageIndex: number;
  readonly context: PdfPageContext;
  readonly annotationId: Identifier;
  readonly performerId: Identifier;
  readonly obstacleKind: 'dot' | 'rank-label';
  readonly noteBounds: PdfBounds;
  readonly obstacleBounds: PdfBounds;
}

export type PdfWarning = FoundationLayoutWarning | NoteOverlapWarning;

export type PdfExportErrorCode =
  | 'validation-failed'
  | 'document-invalid'
  | 'unsupported-glyph'
  | 'font-load-failed'
  | 'writer-failed'
  | 'note-layout-overflow'
  | 'blob-unavailable'
  | 'url-unavailable'
  | 'download-dispatch-failed'
  | 'cancelled';

export type PdfExportResult =
  | Readonly<{ ok: true; bytes: Uint8Array; filename: string; manifest: PdfExportManifest; warnings: readonly PdfWarning[] }>
  | Readonly<{ ok: false; code: PdfExportErrorCode; messageKey: string; detail: readonly string[] }>;

export type PdfBuildInput = Readonly<{ snapshot: FreeformDocument; request: PdfExportRequest; assets: PdfAssets }>;
