import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { selectAnnotations } from '../document/annotations';
import { validateExportSnapshot } from '../document/export-snapshot-validation';
import type { Annotation, Dot, FreeformDocument, Identifier } from '../document/types';
import { FtlValidationError } from '../timeline/ftl';
import { sampleFtlTransition } from '../timeline/ftl';
import { sampleFloatTransition } from '../timeline/float';
import { calculateFtlStepSizeStatus } from '../timeline/ftl';
import { calculateTransitionStepStatuses } from '../timeline/float';
import { inspectCoordinate } from '../geometry/nfhs';
import {
  type PdfAssets,
  type PdfExportManifest,
  type PdfExportRequest,
  type PdfExportResult,
  type PdfFontAsset,
  type PdfManifestPage,
  type PdfPageContext,
  type PdfBounds,
  type PdfWarning,
  type NoteOverlapWarning,
  DIRECTOR_FIELD_RECT,
  PDF_LANGUAGE,
  PDF_PRODUCER,
  LETTER_LANDSCAPE,
  LETTER_PORTRAIT,
} from './contracts';
import { fieldPoint } from './geometry';

const FIXED_DATE = new Date('2000-01-01T00:00:00.000Z');
/** Fixed director typography/geometry policy, measured with the embedded PDF font. */
const DIRECTOR = Object.freeze({
  dotRadius: 3,
  dotStrokeAllowance: 1,
  rankOffsetX: 5,
  rankBaselineOffsetY: -3,
  rankSize: 8,
  noteSize: 9,
  noteLeading: 11,
  notePadding: 3,
  noteMaxWidth: 144,
  annotationStrokeWidth: 1.25,
  headerTitleSize: 16,
  headerContextSize: 11,
  headerMetaSize: 9,
  headerLeading: 15,
  footerSize: 8,
  footerLeading: 10,
  headerBottom: 492,
  headerTop: 576,
  footerBottom: 36,
  footerTop: 96,
  symbolSize: 14,
});

/** Portrait packet policy. Entry diagrams retain canonical coordinate geometry,
 * which lets packet note warnings report actual rendered dot/label bounds. */
const PACKET = Object.freeze({
  margin: 36,
  top: 756,
  bottom: 42,
  headerSize: 11,
  identitySize: 14,
  bodySize: 9,
  leading: 12,
  entryHeight: 190,
  diagramHeight: 116,
  diagramWidth: 540,
  dotRadius: 3,
  dotStrokeAllowance: 1,
  rankOffsetX: 5,
  rankBaselineOffsetY: -3,
  rankSize: 8,
  noteSize: 8,
  noteLeading: 10,
  notePadding: 3,
  noteMaxWidth: 120,
  annotationStrokeWidth: 1.25,
  symbolSize: 14,
});

interface FontkitGlyph {
  readonly id: number;
  readonly bbox: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
}
interface FontkitFace {
  readonly unitsPerEm: number;
  glyphForCodePoint(codePoint: number): FontkitGlyph;
}
interface FontFace {
  readonly asset: PdfFontAsset;
  readonly face: FontkitFace;
}
interface LoadedFont extends FontFace {
  readonly pdfFont: PDFFont;
}

interface PacketEntry {
  readonly context: PdfPageContext;
  readonly position: Dot;
  readonly annotationIds: readonly Identifier[];
}

interface PacketPlan {
  readonly kind: 'performer-packet';
  readonly performerId: Identifier;
  readonly entries: readonly PacketEntry[];
}

type RenderPlan = PdfManifestPage | PacketPlan;

/**
 * Pure M8.1 foundation: clone, validate, plan, then write a minimal text PDF.
 * Director graphics, annotation drawing, and performer-packet layout deliberately
 * belong to later cards; the plan is their stable renderer seam.
 */
export async function buildPdfExport(
  snapshot: FreeformDocument,
  request: PdfExportRequest,
  assets: PdfAssets,
): Promise<PdfExportResult> {
  let frozenSnapshot: FreeformDocument;
  let frozenRequest: unknown;
  try {
    frozenSnapshot = freezeClone(snapshot);
    frozenRequest = freezeClone(request);
    validateExportSnapshot(frozenSnapshot);
  } catch (error) {
    if (error instanceof FtlValidationError) return failure('document-invalid', 'pdfExport.error.documentInvalid.ftl');
    return failure('document-invalid', 'pdfExport.error.documentInvalid.schema');
  }
  const validatedRequest = validateRuntimeRequest(frozenRequest);
  if (!validatedRequest) return failure('document-invalid', 'pdfExport.error.documentInvalid.schema');

  const plan = validateAndPlan(frozenSnapshot, validatedRequest);
  if ('error' in plan) return plan.error;

  let assetHashes: Awaited<ReturnType<typeof hashesFor>>;
  try {
    assetHashes = await hashesFor(assets.fonts);
  } catch {
    return failure('font-load-failed', 'pdfExport.error.fontLoad');
  }
  if ('error' in assetHashes) return assetHashes.error;

  let loadedFonts: readonly FontFace[];
  try {
    loadedFonts = loadFontFaces(assets.fonts);
  } catch {
    return failure('font-load-failed', 'pdfExport.error.fontLoad');
  }
  const unsupported = firstUnsupportedCharacter(textCandidatesForExport(frozenSnapshot, plan.pages, validatedRequest), loadedFonts);
  if (unsupported) return failure('unsupported-glyph', 'pdfExport.error.unsupportedGlyph', ['glyph not present in embedded font subset']);

  try {
    const rendered = await writePdf(frozenSnapshot, plan.pages, validatedRequest, loadedFonts);
    const manifest: PdfExportManifest = Object.freeze({
      schemaVersion: 'm8.2',
      contentFingerprint: await sha256(canonicalJson(contentForFingerprint(frozenSnapshot))),
      request: validatedRequest,
      pages: rendered.pages,
      language: PDF_LANGUAGE,
      fontAssetHashes: assetHashes.hashes,
      warnings: rendered.warnings,
    });
    return Object.freeze({
      ok: true,
      bytes: rendered.bytes,
      filename: pdfFilename(frozenSnapshot.show.title, validatedRequest),
      manifest,
      warnings: rendered.warnings,
    });
  } catch (error) {
    if (error instanceof NoteLayoutOverflowError) return failure('note-layout-overflow', 'pdfExport.error.noteLayoutOverflow');
    return failure('writer-failed', 'pdfExport.error.writerFailed');
  }
}

export function pdfFilename(title: string, request: PdfExportRequest): string {
  const base = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled-show';
  const scopeRequest = request.scope;
  const scope = scopeRequest.kind === 'full-show' ? 'full-show' : `set-${scopeRequest.firstSetId}-to-${scopeRequest.lastSetId}`;
  return `${base}-${request.kind === 'director' ? 'director' : 'performer-packets'}-${scope}.pdf`;
}

export async function sha256(bytesOrText: Uint8Array | string): Promise<string> {
  const bytes = typeof bytesOrText === 'string' ? new TextEncoder().encode(bytesOrText) : bytesOrText;
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** Runtime boundary for the public TypeScript union. Callers may supply
 * deserialized/stale data, so an unrecognized discriminant must never fall
 * through to another export kind. The approved copy contract has no generic
 * malformed-request row; schema-invalid is its established defensive route. */
function validateRuntimeRequest(value: unknown): PdfExportRequest | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'director') {
    if (!exactKeys(value, ['kind', 'scope', 'transitionFrames']) || !validScope(value.scope) || !Array.isArray(value.transitionFrames)) return undefined;
    for (const frame of value.transitionFrames) {
      if (!isRecord(frame) || !exactKeys(frame, ['transitionId', 'counts']) || !isIdentifier(frame.transitionId)
        || !Array.isArray(frame.counts) || !frame.counts.every((count) => typeof count === 'number')) return undefined;
    }
    return value as unknown as Extract<PdfExportRequest, { kind: 'director' }>;
  }
  if (value.kind === 'performer-packet') {
    if (!exactKeys(value, ['kind', 'scope', 'performerIds']) || !validScope(value.scope)
      || !Array.isArray(value.performerIds) || !value.performerIds.every(isIdentifier)) return undefined;
    return value as unknown as Extract<PdfExportRequest, { kind: 'performer-packet' }>;
  }
  return undefined;
}

function validScope(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'full-show') return exactKeys(value, ['kind']);
  return value.kind === 'inclusive-set-range' && exactKeys(value, ['kind', 'firstSetId', 'lastSetId'])
    && isIdentifier(value.firstSetId) && isIdentifier(value.lastSetId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function isIdentifier(value: unknown): value is Identifier {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}

function validateAndPlan(document: FreeformDocument, request: PdfExportRequest): { readonly pages: readonly RenderPlan[] } | { readonly error: PdfExportResult } {
  const setRange = selectedSets(document, request);
  if ('error' in setRange) return { error: setRange.error };
  if (request.kind === 'director') {
    const frames = selectedFrames(document, request, new Set(setRange.sets.map(({ id }) => id)));
    if ('error' in frames) return { error: frames.error };
    const staticPages = setRange.sets.map((set) => directorPage(document, { kind: 'static-set', setId: set.id }));
    const transitionPages = frames.frames.map((frame) => directorPage(document, frame));
    return { pages: Object.freeze([...staticPages, ...transitionPages]) };
  }
  if (request.performerIds.length === 0) return { error: failure('validation-failed', 'pdfExport.error.validation.noPerformersSelected') };
  const ids = new Set<string>();
  for (const id of request.performerIds) {
    if (ids.has(id)) return { error: failure('validation-failed', 'pdfExport.error.validation.duplicatePerformerSelected') };
    ids.add(id);
    if (!document.performers.some((performer) => performer.id === id)) return { error: failure('validation-failed', 'pdfExport.error.validation.unknownPerformer') };
  }
  const selected = new Set(request.performerIds);
  const selectedSetIds = new Set(setRange.sets.map(({ id }) => id));
  const transitions = document.transitions.filter((transition) => selectedSetIds.has(transition.fromSetId) && selectedSetIds.has(transition.toSetId));
  return {
    pages: Object.freeze(document.performers.filter(({ id }) => selected.has(id)).map((performer): PacketPlan => {
      const staticEntries = setRange.sets.map((set): PacketEntry => {
        const context: PdfPageContext = { kind: 'static-set', setId: set.id };
        return { context, position: set.positions[performer.id]!, annotationIds: Object.freeze(selectAnnotations(document, { audience: 'performer-packet', performerId: performer.id, context }).map(({ id }) => id)) };
      });
      const transitionEntries = transitions.map((transition): PacketEntry => {
        // Packet requests select transitions by scoped range, not a director-style
        // sampled-count list. The entry's movement count is its authored total.
        const context: PdfPageContext = { kind: 'active-transition', transitionId: transition.id, count: transition.counts };
        const position = transition.mode === 'float'
          ? sampleFloatTransition(document, transition, transition.counts).positions[performer.id]!
          : sampleFtlTransition(document, transition, transition.counts).positions[performer.id]!;
        return { context, position, annotationIds: Object.freeze(selectAnnotations(document, { audience: 'performer-packet', performerId: performer.id, context }).map(({ id }) => id)) };
      });
      return { kind: 'performer-packet', performerId: performer.id, entries: Object.freeze([...staticEntries, ...transitionEntries]) };
    })),
  };
}

function selectedSets(document: FreeformDocument, request: PdfExportRequest): { readonly sets: readonly FreeformDocument['sets'][number][] } | { readonly error: PdfExportResult } {
  const scope = request.scope;
  if (scope.kind === 'full-show') return { sets: document.sets };
  const first = document.sets.findIndex(({ id }) => id === scope.firstSetId);
  const last = document.sets.findIndex(({ id }) => id === scope.lastSetId);
  if (first < 0 || last < 0) return { error: failure('validation-failed', 'pdfExport.error.validation.unknownSet') };
  if (first > last) return { error: failure('validation-failed', 'pdfExport.error.validation.rangeReversed') };
  return { sets: document.sets.slice(first, last + 1) };
}

function selectedFrames(
  document: FreeformDocument,
  request: Extract<PdfExportRequest, { kind: 'director' }>,
  setIds: ReadonlySet<Identifier>,
): { readonly frames: readonly PdfPageContext[] } | { readonly error: PdfExportResult } {
  const requested = new Set<string>();
  const frames: PdfPageContext[] = [];
  for (const requestedTransition of request.transitionFrames) {
    if (requested.has(requestedTransition.transitionId)) return { error: failure('validation-failed', 'pdfExport.error.validation.duplicateTransitionRequest') };
    requested.add(requestedTransition.transitionId);
    const transition = document.transitions.find(({ id }) => id === requestedTransition.transitionId);
    if (!transition) return { error: failure('validation-failed', 'pdfExport.error.validation.unknownTransition') };
    if (!setIds.has(transition.fromSetId) || !setIds.has(transition.toSetId)) return { error: failure('validation-failed', 'pdfExport.error.validation.transitionOutsideRange') };
    if (requestedTransition.counts.length === 0) {
      return { error: failure('validation-failed', 'pdfExport.error.validation.transitionCountBlank') };
    }
    const counts = new Set<number>();
    for (const count of requestedTransition.counts) {
      if (!Number.isFinite(count) || !Number.isInteger(count)) return { error: failure('validation-failed', 'pdfExport.error.validation.transitionCountDecimal') };
      if (count < 0) return { error: failure('validation-failed', 'pdfExport.error.validation.transitionCountNegative') };
      if (count > transition.counts) return { error: failure('validation-failed', 'pdfExport.error.validation.transitionCountOutOfDomain') };
      if (counts.has(count)) return { error: failure('validation-failed', 'pdfExport.error.validation.transitionCountDuplicate') };
      counts.add(count);
      frames.push({ kind: 'active-transition', transitionId: transition.id, count });
    }
  }
  const ordered = frames.slice().sort((left, right) => {
    const leftTransition = left as Extract<PdfPageContext, { kind: 'active-transition' }>;
    const rightTransition = right as Extract<PdfPageContext, { kind: 'active-transition' }>;
    return document.transitions.findIndex(({ id }) => id === leftTransition.transitionId) - document.transitions.findIndex(({ id }) => id === rightTransition.transitionId)
      || leftTransition.count - rightTransition.count;
  });
  return { frames: Object.freeze(ordered) };
}

function directorPage(document: FreeformDocument, context: PdfPageContext): PdfManifestPage {
  return {
    kind: 'director', width: LETTER_LANDSCAPE.width, height: LETTER_LANDSCAPE.height, context,
    setIds: Object.freeze(context.kind === 'static-set' ? [context.setId] : []),
    annotationIds: Object.freeze(selectAnnotations(document, { audience: 'director-print', context }).map(({ id }) => id)),
  };
}

async function hashesFor(fonts: readonly PdfFontAsset[]): Promise<{ readonly hashes: readonly string[] } | { readonly error: PdfExportResult }> {
  if (fonts.length === 0) return { error: failure('font-load-failed', 'pdfExport.error.fontLoad') };
  const hashes: string[] = [];
  for (const asset of fonts) {
    const actual = await sha256(asset.bytes);
    if (actual !== asset.sha256) return { error: failure('font-load-failed', 'pdfExport.error.fontLoad') };
    hashes.push(actual);
  }
  return { hashes: Object.freeze(hashes) };
}

function loadFontFaces(assets: readonly PdfFontAsset[]): readonly FontFace[] {
  return assets.map((asset) => ({
    asset,
    face: fontkit.create(asset.bytes) as unknown as FontkitFace,
  }));
}

class NoteLayoutOverflowError extends Error {}
class DirectorChromeOverflowError extends Error {}

async function writePdf(
  snapshot: FreeformDocument,
  pages: readonly RenderPlan[],
  request: PdfExportRequest,
  fonts: readonly FontFace[],
): Promise<Readonly<{ bytes: Uint8Array; warnings: readonly PdfWarning[]; pages: readonly PdfManifestPage[] }>> {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.registerFontkit(fontkit);
  document.setTitle(snapshot.show.title);
  document.setAuthor('Freeform');
  document.setCreator('Freeform');
  document.setProducer(PDF_PRODUCER);
  document.setLanguage(PDF_LANGUAGE);
  document.setCreationDate(FIXED_DATE);
  document.setModificationDate(FIXED_DATE);
  const embedded = await Promise.all(fonts.map(async ({ asset, face }) => ({
    asset, face, pdfFont: await document.embedFont(asset.bytes, { subset: asset.subset }),
  })));
  const warnings: NoteOverlapWarning[] = [];
  const manifestPages: PdfManifestPage[] = [];
  if (request.kind === 'director') {
    const directorPages = pages as readonly PdfManifestPage[];
    for (const [index, plan] of directorPages.entries()) {
      const page = document.addPage([plan.width, plan.height]);
      const context = plan.context;
      if (!context) throw new Error('Director page requires a context.');
      warnings.push(...renderDirectorPage(page, snapshot, context, index, directorPages.length, embedded));
      manifestPages.push(plan);
    }
  } else {
    const packetPlans = pages as readonly PacketPlan[];
    for (const packet of packetPlans) {
      const layouts = layoutPacket(snapshot, packet, embedded);
      for (const [localIndex, layout] of layouts.entries()) {
        const pageIndex = manifestPages.length;
        const page = document.addPage([LETTER_PORTRAIT.width, LETTER_PORTRAIT.height]);
        warnings.push(...renderPacketPage(page, snapshot, packet, layout, pageIndex, localIndex, layouts.length, embedded));
        manifestPages.push(packetManifestPage(packet.performerId, layout));
      }
    }
  }
  return Object.freeze({
    bytes: await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }),
    warnings: Object.freeze(sortWarnings(warnings)),
    pages: Object.freeze(manifestPages),
  });
}

interface PacketPageLayout { readonly identity: boolean; readonly entries: readonly PacketEntry[] }

function layoutPacket(document: FreeformDocument, packet: PacketPlan, fonts: readonly LoadedFont[]): readonly PacketPageLayout[] {
  const performer = document.performers.find(({ id }) => id === packet.performerId);
  if (!performer) throw new Error('Unknown packet performer.');
  const notes = performer.notes?.trim() ?? '';
  const identityLines = notes === '' ? 1 : 2 + wrappedLines(notes, PACKET.diagramWidth, PACKET.bodySize, fonts, NoteLayoutOverflowError).length;
  const identityHeight = identityLines * PACKET.leading + 18;
  const capacity = PACKET.top - PACKET.bottom;
  if (identityHeight > capacity) throw new NoteLayoutOverflowError();
  const layouts: PacketPageLayout[] = [];
  let current: PacketEntry[] = [];
  let used = identityHeight;
  for (const entry of packet.entries) {
    if (PACKET.entryHeight > capacity) throw new Error('Packet entry does not fit Letter page.');
    // `used` starts with the first-page identity block.  The first entry must
    // therefore move to a non-identity page when that block leaves insufficient
    // room; testing `current.length` here would overcommit page one.
    if (used + PACKET.entryHeight > capacity) {
      layouts.push({ identity: layouts.length === 0, entries: Object.freeze(current) });
      current = [];
      used = 0;
    }
    current.push(entry);
    used += PACKET.entryHeight;
  }
  layouts.push({ identity: layouts.length === 0, entries: Object.freeze(current) });
  return Object.freeze(layouts);
}

function packetManifestPage(performerId: Identifier, layout: PacketPageLayout): PdfManifestPage {
  const setIds = layout.entries.flatMap(({ context }) => context.kind === 'static-set' ? [context.setId] : []);
  const annotationIds = layout.entries.flatMap((entry) => entry.annotationIds);
  return Object.freeze({
    kind: 'performer-packet', width: LETTER_PORTRAIT.width, height: LETTER_PORTRAIT.height, performerId,
    setIds: Object.freeze(setIds), annotationIds: Object.freeze(annotationIds),
    packetEntries: Object.freeze(layout.entries.map((entry) => Object.freeze({ context: entry.context, annotationIds: entry.annotationIds }))),
  });
}

function renderPacketPage(
  page: PDFPage,
  document: FreeformDocument,
  packet: PacketPlan,
  layout: PacketPageLayout,
  pageIndex: number,
  localIndex: number,
  totalPages: number,
  fonts: readonly LoadedFont[],
): readonly NoteOverlapWarning[] {
  const performer = document.performers.find(({ id }) => id === packet.performerId);
  if (!performer) throw new Error('Unknown packet performer.');
  const header = `Show: ${document.show.title}`;
  if (measuredWidth(header, PACKET.bodySize, fonts) > PACKET.diagramWidth) throw new DirectorChromeOverflowError();
  drawText(page, header, PACKET.margin, PACKET.top, PACKET.bodySize, fonts);
  // Page numbering is LOCAL to this performer's own packet (design:93,140):
  // independent performers' packets each number their own pages starting at 1,
  // never a position within the flat multi-performer PDF page sequence.
  drawText(page, `Page ${localIndex + 1} of ${totalPages}`, PACKET.margin, PACKET.bottom - 12, PACKET.bodySize, fonts);
  let y = PACKET.top - 24;
  if (layout.identity) y = drawPacketIdentity(page, performer, y, fonts);
  const warnings: NoteOverlapWarning[] = [];
  for (const entry of layout.entries) {
    warnings.push(...drawPacketEntry(page, document, performer, entry, y, pageIndex, fonts));
    y -= PACKET.entryHeight;
  }
  return warnings;
}

function drawPacketIdentity(page: PDFPage, performer: FreeformDocument['performers'][number], y: number, fonts: readonly LoadedFont[]): number {
  const identity = `${performer.rankCode} — ${performer.displayName}`;
  if (measuredWidth(identity, PACKET.identitySize, fonts) > PACKET.diagramWidth) throw new DirectorChromeOverflowError();
  drawText(page, identity, PACKET.margin, y, PACKET.identitySize, fonts, { vectorArrow: true });
  y -= PACKET.leading + 4;
  const notes = performer.notes?.trim() ?? '';
  if (notes === '') return y - 8;
  drawText(page, 'Notes:', PACKET.margin, y, PACKET.bodySize, fonts);
  y -= PACKET.leading;
  for (const line of wrappedLines(notes, PACKET.diagramWidth, PACKET.bodySize, fonts, NoteLayoutOverflowError)) {
    drawText(page, line, PACKET.margin, y, PACKET.bodySize, fonts);
    y -= PACKET.leading;
  }
  return y - 8;
}

function drawPacketEntry(
  page: PDFPage,
  document: FreeformDocument,
  performer: FreeformDocument['performers'][number],
  entry: PacketEntry,
  top: number,
  pageIndex: number,
  fonts: readonly LoadedFont[],
): readonly NoteOverlapWarning[] {
  const contextText = packetContextText(document, entry.context);
  if (measuredWidth(contextText, PACKET.bodySize, fonts) > PACKET.diagramWidth) throw new DirectorChromeOverflowError();
  drawText(page, contextText, PACKET.margin, top, PACKET.bodySize, fonts, { vectorArrow: true });
  const coordinate = `Coordinate: (${entry.position.x}, ${entry.position.y}) FU — ${inspectCoordinate(entry.position).notation}`;
  if (measuredWidth(coordinate, PACKET.bodySize, fonts) > PACKET.diagramWidth) throw new DirectorChromeOverflowError();
  drawText(page, coordinate, PACKET.margin, top - PACKET.leading, PACKET.bodySize, fonts, { vectorArrow: true });
  if (entry.context.kind === 'active-transition') {
    const movement = packetMovementText(document, performer.id, entry.context.transitionId);
    if (measuredWidth(movement, PACKET.bodySize, fonts) > PACKET.diagramWidth) throw new DirectorChromeOverflowError();
    drawText(page, movement, PACKET.margin, top - 2 * PACKET.leading, PACKET.bodySize, fonts);
  }
  const diagram: PdfBounds = { x: PACKET.margin, y: top - PACKET.entryHeight + 12, width: PACKET.diagramWidth, height: PACKET.diagramHeight };
  page.drawRectangle({ ...diagram, borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.5 });
  const point = fieldPoint(entry.position, document.field, diagram);
  page.drawCircle({ x: point.x, y: point.y, size: PACKET.dotRadius, borderColor: rgb(0, 0, 0), borderWidth: PACKET.dotStrokeAllowance, color: rgb(1, 1, 1) });
  const dotBounds = { x: point.x - PACKET.dotRadius - PACKET.dotStrokeAllowance, y: point.y - PACKET.dotRadius - PACKET.dotStrokeAllowance, width: 2 * (PACKET.dotRadius + PACKET.dotStrokeAllowance), height: 2 * (PACKET.dotRadius + PACKET.dotStrokeAllowance) };
  const rankBounds = measuredInkBounds(performer.rankCode, point.x + PACKET.rankOffsetX, point.y + PACKET.rankBaselineOffsetY, PACKET.rankSize, fonts);
  assertBoundsOnPage(rankBounds, page.getWidth(), page.getHeight());
  drawText(page, performer.rankCode, point.x + PACKET.rankOffsetX, point.y + PACKET.rankBaselineOffsetY, PACKET.rankSize, fonts);
  // PacketEntry.annotationIds is the ordered result of the shared selector.
  // Render every selected kind instead of treating manifest membership as proof
  // that its mark made it into the PDF.
  const symbols = new Map((document.symbols ?? []).map((symbol) => [symbol.id, symbol]));
  const notes: NoteBox[] = [];
  for (const annotationId of entry.annotationIds) {
    const annotation = document.annotations.find((candidate) => candidate.id === annotationId);
    if (!annotation) throw new Error(`Packet annotation ${annotationId} is missing.`);
    switch (annotation.kind) {
      case 'freehand':
        annotation.strokes.forEach((stroke) => drawPolyline(page, stroke, document, false, diagram, PACKET.annotationStrokeWidth));
        break;
      case 'arrow':
        drawPolyline(page, annotation.points, document, true, diagram, PACKET.annotationStrokeWidth);
        break;
      case 'symbol': {
        const glyph = symbols.get(annotation.symbolId)?.glyph;
        if (!glyph) throw new Error(`Unknown symbol ${annotation.symbolId}.`);
        const point = fieldPoint(annotation.anchor, document.field, diagram);
        const rotation = annotation.rotationDegrees ?? 0;
        const symbolBounds = rotateBounds(
          measuredInkBounds(glyph, point.x, point.y, PACKET.symbolSize * (annotation.scale ?? 1), fonts),
          point.x,
          point.y,
          rotation,
        );
        // Field-edge glyphs may extend beyond the diagram border, but never
        // beyond the portrait page where their ink would be clipped.
        assertBoundsOnPage(symbolBounds, page.getWidth(), page.getHeight());
        drawText(page, glyph, point.x, point.y, PACKET.symbolSize * (annotation.scale ?? 1), fonts, { rotate: rotation });
        break;
      }
      case 'label':
      case 'performerNote':
        notes.push(drawPacketNote(page, annotation, document, diagram, fonts));
        break;
    }
  }
  return notes.flatMap((note) => {
    const obstacles = [{ kind: 'dot' as const, bounds: dotBounds }, { kind: 'rank-label' as const, bounds: rankBounds }];
    return obstacles.flatMap((obstacle) => positiveIntersection(note.bounds, obstacle.bounds)
      ? [{ code: 'note-overlap' as const, pageIndex, context: entry.context, annotationId: note.annotationId, performerId: performer.id, obstacleKind: obstacle.kind, noteBounds: roundedBounds(note.bounds), obstacleBounds: roundedBounds(obstacle.bounds) }]
      : []);
  });
}

function packetContextText(document: FreeformDocument, context: PdfPageContext): string {
  if (context.kind === 'static-set') {
    const set = document.sets.find(({ id }) => id === context.setId);
    if (!set) throw new Error('Unknown packet set.');
    return `${set.name} — starts at count ${set.startCount}`;
  }
  const transition = document.transitions.find(({ id }) => id === context.transitionId);
  const from = transition && document.sets.find(({ id }) => id === transition.fromSetId);
  const to = transition && document.sets.find(({ id }) => id === transition.toSetId);
  if (!transition || !from || !to) throw new Error('Unknown packet transition.');
  return `${from.name} → ${to.name} — ${transition.mode.toUpperCase()}, ${context.count} counts`;
}

function packetMovementText(document: FreeformDocument, performerId: Identifier, transitionId: Identifier): string {
  const transition = document.transitions.find(({ id }) => id === transitionId);
  if (!transition) throw new Error('Unknown packet transition.');
  if (transition.mode === 'float') {
    const status = calculateTransitionStepStatuses(document, transition).find((candidate) => candidate.performerId === performerId);
    if (!status) throw new Error('Missing float movement status.');
    return `Movement: ${status.label} over ${transition.counts} counts`;
  }
  const status = calculateFtlStepSizeStatus(transition);
  return `Movement: FTL common ${status.label} over ${transition.counts} counts`;
}

function drawPacketNote(page: PDFPage, annotation: Extract<Annotation, { kind: 'label' | 'performerNote' }>, document: FreeformDocument, diagram: PdfBounds, fonts: readonly LoadedFont[]): NoteBox {
  const point = fieldPoint(annotation.anchor, document.field, diagram);
  const lines = wrappedLines(annotation.text, PACKET.noteMaxWidth - 2 * PACKET.notePadding, PACKET.noteSize, fonts, NoteLayoutOverflowError);
  const width = Math.max(...lines.map((line) => measuredWidth(line, PACKET.noteSize, fonts))) + 2 * PACKET.notePadding;
  const height = lines.length * PACKET.noteLeading + 2 * PACKET.notePadding;
  const bounds = { x: point.x, y: point.y, width, height };
  assertBoundsInRect(bounds, diagram, NoteLayoutOverflowError);
  page.drawRectangle({ ...bounds, color: rgb(1, 1, 1), borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.5 });
  for (const [index, line] of lines.entries()) drawText(page, line, bounds.x + PACKET.notePadding, bounds.y + bounds.height - PACKET.notePadding - PACKET.noteSize - index * PACKET.noteLeading, PACKET.noteSize, fonts);
  return { annotationId: annotation.id, bounds };
}

function drawText(page: PDFPage, text: string, x: number, y: number, size: number, fonts: readonly LoadedFont[], options?: Readonly<{ rotate?: number; vectorArrow?: boolean }>): void {
  // All cursor/line-local geometry below is computed in UNROTATED local space with
  // the same origin convention as measuredInkBounds (cursor advances along the raw
  // x-axis from `x`, vertical offsets are measured from `y`). The single rotation
  // transform below is then applied per-point around anchor (x, y) exactly like
  // rotateBounds rotates the aggregate ink box, so every font run — and the vector
  // arrow fallback glyph — continues along ONE rotated baseline instead of each run
  // rotating individually around its own unrotated cursor position.
  const rotation = options?.rotate ?? 0;
  const radians = rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const toPage = (localX: number, localY: number): { x: number; y: number } => {
    const dx = localX - x;
    const dy = localY - y;
    return { x: x + dx * cosine - dy * sine, y: y + dx * sine + dy * cosine };
  };
  let cursor = x;
  let run = '';
  let current: LoadedFont | undefined;
  const flush = (): void => {
    if (current && run) {
      const origin = toPage(cursor, y);
      page.drawText(run, { x: origin.x, y: origin.y, size, font: current.pdfFont, ...(options?.rotate === undefined ? {} : { rotate: degrees(options.rotate) }) });
      cursor += current.pdfFont.widthOfTextAtSize(run, size);
    }
    run = '';
  };
  for (const character of text) {
    if (isHardLineBreak(character)) throw new Error('Line breaks must be laid out before drawing text.');
    if (character === '→' && options?.vectorArrow) {
      flush();
      const arrowWidth = size;
      const middle = y + size * 0.35;
      const tail = toPage(cursor, middle);
      const tip = toPage(cursor + arrowWidth, middle);
      const barbTop = toPage(cursor + arrowWidth - 3, middle + 2.5);
      const barbBottom = toPage(cursor + arrowWidth - 3, middle - 2.5);
      page.drawLine({ start: tail, end: tip, thickness: 0.8, color: rgb(0, 0, 0) });
      page.drawLine({ start: tip, end: barbTop, thickness: 0.8, color: rgb(0, 0, 0) });
      page.drawLine({ start: tip, end: barbBottom, thickness: 0.8, color: rgb(0, 0, 0) });
      cursor += arrowWidth;
      current = undefined;
      continue;
    }
    const font = fonts.find(({ face }) => face.glyphForCodePoint(character.codePointAt(0)!).id !== 0);
    if (!font) throw new Error('Unsupported glyph.');
    if (current !== font) { flush(); current = font; }
    run += character;
  }
  flush();
}

function renderDirectorPage(
  page: PDFPage,
  document: FreeformDocument,
  context: PdfPageContext,
  pageIndex: number,
  pageCount: number,
  fonts: readonly LoadedFont[],
): readonly NoteOverlapWarning[] {
  const contextText = directorContextText(document, context);
  drawDirectorChrome(page, document.show.title, contextText, context.kind, pageIndex + 1, pageCount, fonts);
  drawField(page, document, fonts);
  const positions = directorPositions(document, context);
  const obstacles = drawPerformers(page, document, positions, fonts);
  const noteBoxes = drawAnnotations(page, document, context, fonts);
  return noteBoxes.flatMap((note) => obstacles.flatMap((obstacle) => (
    positiveIntersection(note.bounds, obstacle.bounds)
      ? [{ code: 'note-overlap' as const, pageIndex, context, annotationId: note.annotationId, performerId: obstacle.performerId,
        obstacleKind: obstacle.kind, noteBounds: roundedBounds(note.bounds), obstacleBounds: roundedBounds(obstacle.bounds) }]
      : []
  )));
}

function directorContextText(document: FreeformDocument, context: PdfPageContext): string {
  if (context.kind === 'static-set') {
    const set = document.sets.find(({ id }) => id === context.setId);
    if (!set) throw new Error('Unknown static set.');
    return `${set.name} — starts at count ${set.startCount}`;
  }
  const transition = document.transitions.find(({ id }) => id === context.transitionId);
  if (!transition) throw new Error('Unknown transition.');
  const from = document.sets.find(({ id }) => id === transition.fromSetId);
  const to = document.sets.find(({ id }) => id === transition.toSetId);
  if (!from || !to) throw new Error('Transition endpoints are missing.');
  return `${from.name} → ${to.name}, count ${context.count} of ${transition.counts}`;
}

function drawDirectorChrome(page: PDFPage, title: string, contextText: string, kind: PdfPageContext['kind'], displayPage: number, totalPages: number, fonts: readonly LoadedFont[]): void {
  const header = [
    ...wrappedLines(title, 720, DIRECTOR.headerTitleSize, fonts),
    ...wrappedLines(contextText, 720, DIRECTOR.headerContextSize, fonts),
    kind === 'static-set' ? 'Static set' : 'Transition',
  ];
  if (header.length * DIRECTOR.headerLeading > DIRECTOR.headerTop - DIRECTOR.headerBottom) throw new DirectorChromeOverflowError();
  let y = DIRECTOR.headerTop - DIRECTOR.headerTitleSize;
  for (const [index, line] of header.entries()) {
    const size = index === 0 ? DIRECTOR.headerTitleSize : index === header.length - 1 ? DIRECTOR.headerMetaSize : DIRECTOR.headerContextSize;
    drawText(page, line, 36, y, size, fonts, { vectorArrow: true });
    y -= DIRECTOR.headerLeading;
  }
  const footer = ['Freeform — Director pages', contextText, `Page ${displayPage} of ${totalPages}`].flatMap((line) => wrappedLines(line, 720, DIRECTOR.footerSize, fonts));
  if (footer.length * DIRECTOR.footerLeading > DIRECTOR.footerTop - DIRECTOR.footerBottom) throw new DirectorChromeOverflowError();
  y = DIRECTOR.footerTop - DIRECTOR.footerSize;
  for (const line of footer) { drawText(page, line, 36, y, DIRECTOR.footerSize, fonts, { vectorArrow: true }); y -= DIRECTOR.footerLeading; }
}

function drawField(page: PDFPage, document: FreeformDocument, fonts: readonly LoadedFont[]): void {
  const rect = DIRECTOR_FIELD_RECT;
  page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  for (let yard = 5; yard < 100; yard += 5) {
    const x = rect.x + rect.width * yard / 100;
    page.drawLine({ start: { x, y: rect.y }, end: { x, y: rect.y + rect.height }, thickness: yard === 50 ? 1 : 0.5, color: rgb(0.65, 0.65, 0.65) });
  }
  for (const yFU of [document.field.frontHashY, document.field.backHashY]) {
    const y = fieldPoint({ x: 0, y: yFU }, document.field).y;
    page.drawLine({ start: { x: rect.x, y }, end: { x: rect.x + rect.width, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  }
  // Field numbers use the same embedded, selectable text path as all other labels.
  for (let yard = 10; yard <= 50; yard += 10) {
    const x = rect.x + rect.width * yard / 100;
    drawText(page, String(yard === 50 ? 50 : yard), x - 4, rect.y + rect.height / 2 - 3, 7, fonts);
    if (yard !== 50) drawText(page, String(yard), rect.x + rect.width - (x - rect.x) - 4, rect.y + rect.height / 2 - 3, 7, fonts);
  }
}

function directorPositions(document: FreeformDocument, context: PdfPageContext): Readonly<Record<Identifier, Dot>> {
  if (context.kind === 'static-set') {
    const set = document.sets.find(({ id }) => id === context.setId);
    if (!set) throw new Error('Unknown static set.');
    return set.positions;
  }
  const transition = document.transitions.find(({ id }) => id === context.transitionId);
  if (!transition) throw new Error('Unknown transition.');
  return transition.mode === 'float'
    ? sampleFloatTransition(document, transition, context.count).positions
    : sampleFtlTransition(document, transition, context.count).positions;
}

interface Obstacle { readonly performerId: Identifier; readonly kind: 'dot' | 'rank-label'; readonly bounds: PdfBounds }
interface NoteBox { readonly annotationId: Identifier; readonly bounds: PdfBounds }

function drawPerformers(page: PDFPage, document: FreeformDocument, positions: Readonly<Record<Identifier, Dot>>, fonts: readonly LoadedFont[]): readonly Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const performer of document.performers) {
    const dot = positions[performer.id];
    if (!dot) throw new Error(`Missing position for ${performer.id}.`);
    const point = fieldPoint(dot, document.field);
    page.drawCircle({ x: point.x, y: point.y, size: DIRECTOR.dotRadius, borderColor: rgb(0, 0, 0), borderWidth: DIRECTOR.dotStrokeAllowance, color: rgb(1, 1, 1) });
    obstacles.push({ performerId: performer.id, kind: 'dot', bounds: { x: point.x - DIRECTOR.dotRadius - DIRECTOR.dotStrokeAllowance, y: point.y - DIRECTOR.dotRadius - DIRECTOR.dotStrokeAllowance, width: 2 * (DIRECTOR.dotRadius + DIRECTOR.dotStrokeAllowance), height: 2 * (DIRECTOR.dotRadius + DIRECTOR.dotStrokeAllowance) } });
    const x = point.x + DIRECTOR.rankOffsetX;
    const baseline = point.y + DIRECTOR.rankBaselineOffsetY;
    const rankBounds = measuredInkBounds(performer.rankCode, x, baseline, DIRECTOR.rankSize, fonts);
    assertBoundsOnPage(rankBounds, page.getWidth(), page.getHeight());
    drawText(page, performer.rankCode, x, baseline, DIRECTOR.rankSize, fonts);
    obstacles.push({ performerId: performer.id, kind: 'rank-label', bounds: rankBounds });
  }
  return obstacles;
}

function drawAnnotations(page: PDFPage, document: FreeformDocument, context: PdfPageContext, fonts: readonly LoadedFont[]): readonly NoteBox[] {
  const selected = selectAnnotations(document, { audience: 'director-print', context });
  const symbols = new Map((document.symbols ?? []).map((symbol) => [symbol.id, symbol]));
  const notes: NoteBox[] = [];
  for (const annotation of selected) {
    switch (annotation.kind) {
      case 'freehand': annotation.strokes.forEach((stroke) => drawPolyline(page, stroke, document, false)); break;
      case 'arrow': drawPolyline(page, annotation.points, document, true); break;
      case 'symbol': {
        const glyph = symbols.get(annotation.symbolId)?.glyph;
        if (!glyph) throw new Error(`Unknown symbol ${annotation.symbolId}.`);
        const point = fieldPoint(annotation.anchor, document.field);
        const rotation = annotation.rotationDegrees ?? 0;
        const symbolBounds = rotateBounds(
          measuredInkBounds(glyph, point.x, point.y, DIRECTOR.symbolSize * (annotation.scale ?? 1), fonts),
          point.x,
          point.y,
          rotation,
        );
        assertBoundsOnPage(symbolBounds, page.getWidth(), page.getHeight());
        drawText(page, glyph, point.x, point.y, DIRECTOR.symbolSize * (annotation.scale ?? 1), fonts, { rotate: rotation });
        break;
      }
      case 'label': notes.push(drawNoteBox(page, annotation, document, fonts)); break;
      case 'performerNote': notes.push(drawNoteBox(page, annotation, document, fonts)); break;
    }
  }
  return notes;
}

function drawPolyline(
  page: PDFPage,
  points: readonly Dot[],
  document: FreeformDocument,
  arrow: boolean,
  rect: PdfBounds = DIRECTOR_FIELD_RECT,
  thickness = DIRECTOR.annotationStrokeWidth,
): void {
  for (let index = 1; index < points.length; index += 1) {
    const start = fieldPoint(points[index - 1]!, document.field, rect);
    const end = fieldPoint(points[index]!, document.field, rect);
    page.drawLine({ start, end, thickness, color: rgb(0.1, 0.1, 0.1) });
  }
  if (!arrow) return;
  const start = fieldPoint(points.at(-2)!, document.field, rect);
  const end = fieldPoint(points.at(-1)!, document.field, rect);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  for (const delta of [-Math.PI / 6, Math.PI / 6]) page.drawLine({ start: end, end: { x: end.x - 8 * Math.cos(angle + delta), y: end.y - 8 * Math.sin(angle + delta) }, thickness, color: rgb(0.1, 0.1, 0.1) });
}

function drawNoteBox(page: PDFPage, annotation: Extract<Annotation, { kind: 'label' | 'performerNote' }>, document: FreeformDocument, fonts: readonly LoadedFont[]): NoteBox {
  const point = fieldPoint(annotation.anchor, document.field);
  const lines = wrappedLines(annotation.text, DIRECTOR.noteMaxWidth - 2 * DIRECTOR.notePadding, DIRECTOR.noteSize, fonts, NoteLayoutOverflowError);
  const width = Math.max(...lines.map((line) => measuredWidth(line, DIRECTOR.noteSize, fonts))) + 2 * DIRECTOR.notePadding;
  const height = lines.length * DIRECTOR.noteLeading + 2 * DIRECTOR.notePadding;
  const bounds = { x: point.x, y: point.y, width, height };
  if (bounds.x < DIRECTOR_FIELD_RECT.x || bounds.y < DIRECTOR_FIELD_RECT.y || bounds.x + bounds.width > DIRECTOR_FIELD_RECT.x + DIRECTOR_FIELD_RECT.width || bounds.y + bounds.height > DIRECTOR_FIELD_RECT.y + DIRECTOR_FIELD_RECT.height) throw new NoteLayoutOverflowError();
  page.drawRectangle({ ...bounds, color: rgb(1, 1, 1), borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.5 });
  for (const [index, line] of lines.entries()) drawText(page, line, bounds.x + DIRECTOR.notePadding, bounds.y + bounds.height - DIRECTOR.notePadding - DIRECTOR.noteSize - index * DIRECTOR.noteLeading, DIRECTOR.noteSize, fonts);
  return { annotationId: annotation.id, bounds };
}

/**
 * Preserve every authored printable character. Hard line controls are layout
 * controls (CRLF, CR, and LF become one explicit line boundary); soft wraps
 * retain the whitespace character at the end of the preceding line instead
 * of normalizing it away.
 */
function wrappedLines(text: string, maxWidth: number, size: number, fonts: readonly LoadedFont[], overflow = DirectorChromeOverflowError): readonly string[] {
  const result: string[] = [];
  for (const paragraph of normalizedHardBreaks(text).split('\n')) {
    if (paragraph === '') { result.push(''); continue; }
    const characters = [...paragraph];
    let remaining = 0;
    while (remaining < characters.length) {
      let lineEnd = remaining;
      let lastBreak = -1;
      while (lineEnd < characters.length) {
        const candidate = characters.slice(remaining, lineEnd + 1).join('');
        if (measuredWidth(candidate, size, fonts) > maxWidth) break;
        lineEnd += 1;
        if (characters[lineEnd - 1] === ' ') lastBreak = lineEnd;
      }
      if (lineEnd === characters.length) {
        result.push(characters.slice(remaining).join(''));
        break;
      }
      if (lastBreak <= remaining) throw new overflow();
      result.push(characters.slice(remaining, lastBreak).join(''));
      remaining = lastBreak;
    }
  }
  return result;
}

function measuredWidth(text: string, size: number, fonts: readonly LoadedFont[]): number {
  let width = 0;
  let run = '';
  let current: LoadedFont | undefined;
  const flush = (): void => {
    if (current) width += current.pdfFont.widthOfTextAtSize(run, size);
    run = '';
  };
  for (const character of text) {
    if (isHardLineBreak(character)) throw new Error('Line breaks must be laid out before measuring text.');
    if (character === '→') { flush(); current = undefined; width += size; continue; }
    const font = fontForCharacter(character, fonts);
    if (current !== font) { flush(); current = font; }
    run += character;
  }
  flush();
  return width;
}

/** Returns visual glyph ink bounds at the exact PDF text origin/baseline. */
function measuredInkBounds(text: string, x: number, baseline: number, size: number, fonts: readonly LoadedFont[]): PdfBounds {
  let cursor = x;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  let run = '';
  let current: LoadedFont | undefined;
  const flush = (): void => {
    if (!current || run === '') return;
    const characters = [...run];
    for (const [index, character] of characters.entries()) {
      const glyph = current.face.glyphForCodePoint(character.codePointAt(0)!);
      const scale = size / current.face.unitsPerEm;
      const prefixWidth = current.pdfFont.widthOfTextAtSize(characters.slice(0, index).join(''), size);
      const glyphX = cursor + prefixWidth;
      minimumX = Math.min(minimumX, glyphX + glyph.bbox.minX * scale);
      minimumY = Math.min(minimumY, baseline + glyph.bbox.minY * scale);
      maximumX = Math.max(maximumX, glyphX + glyph.bbox.maxX * scale);
      maximumY = Math.max(maximumY, baseline + glyph.bbox.maxY * scale);
    }
    cursor += current.pdfFont.widthOfTextAtSize(run, size);
    run = '';
  };
  for (const character of text) {
    if (isHardLineBreak(character) || character === '→') throw new Error('Unexpected control in measured text.');
    const font = fontForCharacter(character, fonts);
    if (current !== font) { flush(); current = font; }
    run += character;
  }
  flush();
  if (!Number.isFinite(minimumX) || !Number.isFinite(minimumY) || !Number.isFinite(maximumX) || !Number.isFinite(maximumY)) throw new Error('Unable to measure text ink bounds.');
  return { x: minimumX, y: minimumY, width: maximumX - minimumX, height: maximumY - minimumY };
}

function fontForCharacter(character: string, fonts: readonly LoadedFont[]): LoadedFont {
  const font = fonts.find(({ face }) => face.glyphForCodePoint(character.codePointAt(0)!).id !== 0);
  if (!font) throw new Error('Unsupported glyph.');
  return font;
}

function rotateBounds(bounds: PdfBounds, originX: number, originY: number, rotationDegrees: number): PdfBounds {
  const radians = rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const points = [
    [bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
    [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height],
  ].map(([x, y]) => ({ x: originX + (x - originX) * cosine - (y - originY) * sine, y: originY + (x - originX) * sine + (y - originY) * cosine }));
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function assertBoundsOnPage(bounds: PdfBounds, width: number, height: number): void {
  if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width || bounds.y + bounds.height > height) throw new Error('Text ink would be clipped by the page.');
}

function assertBoundsInRect(bounds: PdfBounds, rect: PdfBounds, overflow: new () => Error = DirectorChromeOverflowError): void {
  if (bounds.x < rect.x || bounds.y < rect.y || bounds.x + bounds.width > rect.x + rect.width || bounds.y + bounds.height > rect.y + rect.height) throw new overflow();
}

function isHardLineBreak(character: string): boolean {
  return character === '\n' || character === '\r';
}

function normalizedHardBreaks(text: string): string {
  return text.replace(/\r\n?|\n/gu, '\n');
}

function positiveIntersection(left: PdfBounds, right: PdfBounds): boolean {
  return Math.min(left.x + left.width, right.x + right.width) > Math.max(left.x, right.x)
    && Math.min(left.y + left.height, right.y + right.height) > Math.max(left.y, right.y);
}

function roundedBounds(bounds: PdfBounds): PdfBounds {
  const round = (value: number): number => Math.round(value * 100) / 100;
  return { x: round(bounds.x), y: round(bounds.y), width: round(bounds.width), height: round(bounds.height) };
}

function sortWarnings(warnings: readonly NoteOverlapWarning[]): readonly NoteOverlapWarning[] {
  return Object.freeze(warnings.slice().sort((left, right) => left.pageIndex - right.pageIndex || left.annotationId.localeCompare(right.annotationId) || left.performerId.localeCompare(right.performerId) || left.obstacleKind.localeCompare(right.obstacleKind)));
}

function firstUnsupportedCharacter(text: readonly string[], fonts: readonly FontFace[]): string | undefined {
  return text.flatMap((value) => [...value]).find((character) => !isHardLineBreak(character) && !fonts.some(({ face }) => face.glyphForCodePoint(character.codePointAt(0)!).id !== 0));
}

function textCandidatesForExport(document: FreeformDocument, pages: readonly RenderPlan[], request: PdfExportRequest): readonly string[] {
  if (request.kind === 'performer-packet') {
    const candidates = ['Show:', 'Page', 'of', 'Notes:', 'Coordinate:', 'FU', 'Movement:', document.show.title];
    for (const packet of pages as readonly PacketPlan[]) {
      const performer = document.performers.find(({ id }) => id === packet.performerId);
      if (!performer) continue;
      candidates.push(performer.rankCode, performer.displayName, performer.notes ?? '');
      for (const entry of packet.entries) {
        candidates.push(packetContextText(document, entry.context).replace(' → ', ' '), inspectCoordinate(entry.position).notation);
        if (entry.context.kind === 'active-transition') candidates.push(packetMovementText(document, performer.id, entry.context.transitionId));
        for (const annotationId of entry.annotationIds) {
          const annotation = document.annotations.find(({ id }) => id === annotationId);
          if (annotation?.kind === 'label' || annotation?.kind === 'performerNote') candidates.push(annotation.text);
          if (annotation?.kind === 'symbol') candidates.push(document.symbols?.find(({ id }) => id === annotation.symbolId)?.glyph ?? annotation.symbolId);
        }
      }
    }
    return candidates;
  }
  const candidates = ['Freeform — Director pages', 'Static set', 'Transition', ...document.performers.map(({ rankCode }) => rankCode)];
  for (const page of pages as readonly PdfManifestPage[]) {
    if (!page.context) continue;
    candidates.push(document.show.title, directorContextText(document, page.context).replace(' → ', ' '), `Page ${pages.indexOf(page) + 1} of ${pages.length}`);
    for (const annotation of selectAnnotations(document, { audience: 'director-print', context: page.context })) {
      if (annotation.kind === 'label' || annotation.kind === 'performerNote') candidates.push(annotation.text);
      if (annotation.kind === 'symbol') candidates.push(document.symbols?.find(({ id }) => id === annotation.symbolId)?.glyph ?? annotation.symbolId);
    }
  }
  return candidates;
}

function contentForFingerprint(document: FreeformDocument): unknown {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...show } = document.show;
  return { ...document, show };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function freezeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function failure(code: Extract<PdfExportResult, { ok: false }>['code'], messageKey: string, detail: readonly string[] = []): Extract<PdfExportResult, { ok: false }> {
  return Object.freeze({ ok: false, code, messageKey, detail: Object.freeze([...detail]) });
}
