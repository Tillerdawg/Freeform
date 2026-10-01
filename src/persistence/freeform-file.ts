import { validateDocumentAnnotations } from '../document/annotations';
import { validateDocumentSetsAndTransitions } from '../document/sets';
import type { CommandStore, FreeformDocument } from '../document/types';
import { validateFtlTransition } from '../timeline/ftl';

export const FREEFORM_FORMAT_VERSION = '1.0.0';
export const FREEFORM_FILE_EXTENSION = '.freeform';

export class FreeformFileError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'FreeformFileError';
  }
}

export interface MigrationReport {
  readonly fromVersion: string;
  readonly toVersion: typeof FREEFORM_FORMAT_VERSION;
  readonly steps: readonly string[];
}

export type DecodeResult =
  | Readonly<{ kind: 'editable'; document: FreeformDocument; originalBytes: Uint8Array; migration?: MigrationReport }>
  | Readonly<{ kind: 'read-only-future-major'; originalBytes: Uint8Array; formatVersion: string; message: string }>;

/**
 * Serializes only a fully valid current-format document. JSON.stringify preserves
 * every supported M5/M6 field and extension value; no persistence-time repair or
 * normalization is permitted.
 */
export function encodeDocument(document: FreeformDocument): Uint8Array {
  validateCurrentDocument(document);
  return new TextEncoder().encode(JSON.stringify(document));
}

/** Parses UTF-8 bytes before validating or migrating them. The returned original
 * bytes are intentionally retained so callers can offer exact backup/export. */
export function decodeDocument(bytes: Uint8Array): DecodeResult {
  const originalBytes = bytes.slice();
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw fileError('INVALID_JSON', `The file is not valid UTF-8 JSON: ${messageOf(error)}`);
  }

  const envelope = requireRecord(value, 'root');
  if (envelope.format !== 'freeform') throw fileError('WRONG_FORMAT', 'The file is not a Freeform document.');
  const version = requireSemver(envelope.formatVersion, 'formatVersion');
  const [major, minor] = version;

  if (major > 1) {
    return {
      kind: 'read-only-future-major',
      originalBytes,
      formatVersion: envelope.formatVersion as string,
      message: `Freeform ${envelope.formatVersion as string} requires a newer application version. It is open read-only; export its original bytes before upgrading.`,
    };
  }
  if (major < 1) throw fileError('UNSUPPORTED_MAJOR', `Format version ${envelope.formatVersion as string} requires a dedicated migration that is not available.`);
  if (minor !== 0 || version[2] !== 0) {
    // There is intentionally no speculative future-minor reader. The registry is
    // the extension point for a future defaultable, deterministic migration.
    throw fileError('UNSUPPORTED_MINOR', `Format version ${envelope.formatVersion as string} has no defined defaultable migration to ${FREEFORM_FORMAT_VERSION}.`);
  }

  validateCurrentDocument(value);
  return { kind: 'editable', document: value as FreeformDocument, originalBytes };
}

/** Validates first, then applies exactly one replace command. Invalid imports cannot
 * change the command store's document, revision, undo history, or redo history. */
export function importIntoStore(store: CommandStore, bytes: Uint8Array): DecodeResult {
  const decoded = decodeDocument(bytes);
  if (decoded.kind === 'editable') store.apply({ type: 'document.replace', document: decoded.document });
  return decoded;
}

/** The runtime equivalent of the normative schema plus cross-document semantics. */
export function validateCurrentDocument(value: unknown): asserts value is FreeformDocument {
  const typed = validateDocument(value, false);

  // Command-store validation deliberately permits stale missing FTL members as
  // an editable, playback-blocked draft after roster removal. A file snapshot
  // has no such draft status, so its FTL graph must be strict.
  for (const transition of typed.transitions) if (transition.mode === 'ftl') validateFtlTransition(typed, transition);
}

/**
 * Validates the entire current structural schema and ordinary authoring
 * semantics at the command-store boundary. It intentionally retains the
 * established stale-FTL draft exception and the pre-setup empty roster/set
 * state; `validateCurrentDocument` rejects both and adds the stricter
 * persistence-only FTL playback check before bytes are written.
 */
export function validateDocumentForCommandStore(value: unknown): FreeformDocument {
  return validateDocument(value, true);
}

function validateDocument(value: unknown, allowEmptyAuthoringRoster: boolean): FreeformDocument {
  const document = requireRecord(value, 'root');
  exactKeys(document, ['$schema', 'format', 'formatVersion', 'show', 'field', 'settings', 'performers', 'sets', 'transitions', 'annotations', 'layers', 'symbols', 'extensions'],
    ['format', 'formatVersion', 'show', 'field', 'settings', 'performers', 'sets', 'transitions', 'annotations']);
  if (document.format !== 'freeform') throw fileError('SCHEMA', 'format must be "freeform".');
  if (document.formatVersion !== FREEFORM_FORMAT_VERSION) throw fileError('SCHEMA', `formatVersion must be ${FREEFORM_FORMAT_VERSION}.`);
  if (document.$schema !== undefined) uri(document.$schema, '$schema');
  validateShow(document.show);
  validateField(document.field);
  validateSettings(document.settings);
  validatePerformers(document.performers, allowEmptyAuthoringRoster);
  validateSets(document.sets, allowEmptyAuthoringRoster);
  validateTransitionsStructure(document.transitions);
  validateAnnotationsStructure(document.annotations);
  if (document.layers !== undefined) validateLayers(document.layers);
  if (document.symbols !== undefined) validateSymbols(document.symbols);
  if (document.extensions !== undefined) validateExtensions(document.extensions);

  // Existing runtime validators provide the semantic authority shared by editor
  // commands: positions/topology/FU, FTL equations, M5 audit and M6 references.
  const typed = document as unknown as FreeformDocument;
  validateDocumentSetsAndTransitions(typed);
  validateDocumentAnnotations(typed);
  unique(typed.performers.map(({ id }) => id), 'performer IDs');
  unique(typed.performers.map(({ rankCode }) => rankCode.toLocaleLowerCase('en-US')), 'performer rank codes (case-insensitively)');
  return typed;
}

function validateShow(value: unknown): void {
  const show = requireRecord(value, 'show');
  exactKeys(show, ['id', 'title', 'totalCounts', 'createdAt', 'updatedAt'], ['id', 'title', 'totalCounts']);
  id(show.id, 'show.id'); string(show.title, 1, 200, 'show.title'); integer(show.totalCounts, 0, undefined, 'show.totalCounts');
  if (show.createdAt !== undefined) isoDate(show.createdAt, 'show.createdAt');
  if (show.updatedAt !== undefined) isoDate(show.updatedAt, 'show.updatedAt');
}

function validateField(value: unknown): void {
  const field = requireRecord(value, 'field');
  exactKeys(field, ['preset', 'unitsPerYard', 'lengthUnits', 'widthUnits', 'frontHashY', 'backHashY'], ['preset', 'unitsPerYard', 'lengthUnits', 'widthUnits', 'frontHashY', 'backHashY']);
  const expected = { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 };
  for (const [key, expectedValue] of Object.entries(expected)) if (field[key] !== expectedValue) throw fileError('SCHEMA', `field.${key} must equal ${expectedValue}.`);
}

function validateSettings(value: unknown): void {
  const settings = requireRecord(value, 'settings');
  exactKeys(settings, ['collisionThresholdUnits'], ['collisionThresholdUnits']);
  integer(settings.collisionThresholdUnits, 1, 28800, 'settings.collisionThresholdUnits');
}

function validatePerformers(value: unknown, allowEmpty: boolean): void {
  const performers = array(value, 'performers', allowEmpty ? 0 : 1);
  for (const performerValue of performers) {
    const performer = requireRecord(performerValue, 'performer');
    exactKeys(performer, ['id', 'rankCode', 'displayName', 'section', 'notes'], ['id', 'rankCode', 'displayName']);
    id(performer.id, 'performer.id');
    if (typeof performer.rankCode !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(performer.rankCode)) throw fileError('SCHEMA', 'performer.rankCode is invalid.');
    string(performer.displayName, 1, 120, 'performer.displayName');
    if (performer.section !== undefined) string(performer.section, 0, 80, 'performer.section');
    if (performer.notes !== undefined) string(performer.notes, 0, 10000, 'performer.notes');
  }
}

function validateSets(value: unknown, allowEmptyPositions: boolean): void {
  const sets = array(value, 'sets', allowEmptyPositions ? 0 : 1);
  for (const setValue of sets) {
    const set = requireRecord(setValue, 'set');
    exactKeys(set, ['id', 'name', 'startCount', 'positions'], ['id', 'name', 'startCount', 'positions']);
    id(set.id, 'set.id'); string(set.name, 1, 120, 'set.name'); integer(set.startCount, 0, undefined, 'set.startCount');
    const positions = requireRecord(set.positions, 'set.positions');
    if (!allowEmptyPositions && Object.keys(positions).length === 0) throw fileError('SCHEMA', 'set.positions must not be empty.');
    for (const [performerId, dotValue] of Object.entries(positions)) { id(performerId, 'set.position performer ID'); dot(dotValue, 'set.position'); }
  }
}

function validateTransitionsStructure(value: unknown): void {
  for (const transitionValue of array(value, 'transitions')) {
    const transition = requireRecord(transitionValue, 'transition');
    exactKeys(transition, ['id', 'fromSetId', 'toSetId', 'counts', 'mode', 'ftl', 'notes', 'collisionOverrides'], ['id', 'fromSetId', 'toSetId', 'counts', 'mode']);
    id(transition.id, 'transition.id'); id(transition.fromSetId, 'transition.fromSetId'); id(transition.toSetId, 'transition.toSetId'); integer(transition.counts, 1, undefined, 'transition.counts');
    if (transition.mode !== 'float' && transition.mode !== 'ftl') throw fileError('SCHEMA', 'transition.mode must be float or ftl.');
    if (transition.mode === 'ftl' && transition.ftl === undefined) throw fileError('SCHEMA', 'An FTL transition requires ftl.');
    if (transition.mode === 'float' && transition.ftl !== undefined) throw fileError('SCHEMA', 'A float transition must not include ftl.');
    if (transition.ftl !== undefined) ftl(transition.ftl);
    if (transition.notes !== undefined) string(transition.notes, 0, 10000, 'transition.notes');
    if (transition.collisionOverrides !== undefined) collisionOverrides(transition.collisionOverrides);
  }
}

function ftl(value: unknown): void {
  const ftlValue = requireRecord(value, 'ftl');
  exactKeys(ftlValue, ['leaderId', 'followerIds', 'offsetUnits', 'distanceUnits', 'path', 'expectedEndPositions'], ['leaderId', 'followerIds', 'offsetUnits', 'distanceUnits', 'path']);
  id(ftlValue.leaderId, 'ftl.leaderId');
  for (const follower of array(ftlValue.followerIds, 'ftl.followerIds', 1)) id(follower, 'ftl.followerId');
  const offsets = requireRecord(ftlValue.offsetUnits, 'ftl.offsetUnits');
  for (const [performerId, offset] of Object.entries(offsets)) { id(performerId, 'ftl.offset performer ID'); integer(offset, 0, undefined, 'ftl.offset'); }
  integer(ftlValue.distanceUnits, 1, undefined, 'ftl.distanceUnits'); polyline(ftlValue.path, 'ftl.path');
  if (ftlValue.expectedEndPositions !== undefined) for (const [performerId, dotValue] of Object.entries(requireRecord(ftlValue.expectedEndPositions, 'ftl.expectedEndPositions'))) { id(performerId, 'ftl.expectedEndPositions performer ID'); dot(dotValue, 'ftl.expectedEndPositions'); }
}

function collisionOverrides(value: unknown): void {
  for (const overrideValue of array(value, 'collisionOverrides')) {
    const override = requireRecord(overrideValue, 'collision override');
    exactKeys(override, ['performerIds', 'warningSignature', 'reason', 'overriddenAt', 'authorLabel'], ['performerIds', 'warningSignature', 'reason', 'overriddenAt', 'authorLabel']);
    const performers = array(override.performerIds, 'collision override performerIds', 2);
    if (performers.length !== 2) throw fileError('SCHEMA', 'collision override performerIds must have exactly two IDs.');
    id(performers[0], 'collision override performer ID'); id(performers[1], 'collision override performer ID');
    if (typeof override.warningSignature !== 'string' || !/^v1-sha256-[a-f0-9]{64}$/.test(override.warningSignature)) throw fileError('SCHEMA', 'collision override warningSignature is invalid.');
    string(override.reason, 1, 1000, 'collision override reason'); isoDate(override.overriddenAt, 'collision override overriddenAt'); string(override.authorLabel, 1, 120, 'collision override authorLabel');
  }
}

function validateLayers(value: unknown): void {
  for (const layerValue of array(value, 'layers')) {
    const layer = requireRecord(layerValue, 'layer'); exactKeys(layer, ['id', 'name', 'visible', 'print', 'locked'], ['id', 'name', 'visible', 'print', 'locked']);
    id(layer.id, 'layer.id'); string(layer.name, 1, 120, 'layer.name'); boolean(layer.visible, 'layer.visible'); boolean(layer.print, 'layer.print'); boolean(layer.locked, 'layer.locked');
  }
}

function validateSymbols(value: unknown): void {
  for (const symbolValue of array(value, 'symbols')) {
    const symbol = requireRecord(symbolValue, 'symbol'); exactKeys(symbol, ['id', 'name', 'glyph'], ['id', 'name', 'glyph']);
    id(symbol.id, 'symbol.id'); string(symbol.name, 1, 120, 'symbol.name'); string(symbol.glyph, 1, 8000, 'symbol.glyph');
  }
}

function validateAnnotationsStructure(value: unknown): void {
  for (const annotationValue of array(value, 'annotations')) {
    const annotation = requireRecord(annotationValue, 'annotation');
    const common = ['id', 'kind', 'layerId', 'scope', 'visibility', 'performerId'];
    const extras: Record<string, readonly string[]> = { freehand: ['strokes'], arrow: ['points'], symbol: ['symbolId', 'anchor', 'rotationDegrees', 'scale'], label: ['text', 'anchor'], performerNote: ['text', 'anchor'] };
    const requiredExtras: Record<string, readonly string[]> = { freehand: ['strokes'], arrow: ['points'], symbol: ['symbolId', 'anchor'], label: ['text', 'anchor'], performerNote: ['text', 'anchor'] };
    if (typeof annotation.kind !== 'string' || !(annotation.kind in extras)) throw fileError('SCHEMA', 'annotation.kind is invalid.');
    exactKeys(annotation, [...common, ...extras[annotation.kind]!], ['id', 'kind', 'layerId', 'scope', 'visibility', ...requiredExtras[annotation.kind]!]);
    id(annotation.id, 'annotation.id'); id(annotation.layerId, 'annotation.layerId'); if (annotation.performerId !== undefined) id(annotation.performerId, 'annotation.performerId');
    scope(annotation.scope); visibility(annotation.visibility);
    if ((annotation.visibility as Record<string, unknown>).performerPacket === true && annotation.performerId === undefined) throw fileError('SCHEMA', 'performerPacket annotations require performerId.');
    switch (annotation.kind) {
      case 'freehand': for (const stroke of array(annotation.strokes, 'annotation.strokes', 1)) polyline(stroke, 'annotation.stroke'); break;
      case 'arrow': polyline(annotation.points, 'annotation.points'); break;
      case 'symbol': id(annotation.symbolId, 'annotation.symbolId'); dot(annotation.anchor, 'annotation.anchor'); if (annotation.rotationDegrees !== undefined) number(annotation.rotationDegrees, 0, 360, false, 'annotation.rotationDegrees'); if (annotation.scale !== undefined) number(annotation.scale, 0, undefined, true, 'annotation.scale'); break;
      case 'label': string(annotation.text, 1, 10000, 'annotation.text'); dot(annotation.anchor, 'annotation.anchor'); break;
      case 'performerNote': if (annotation.performerId === undefined) throw fileError('SCHEMA', 'performerNote requires performerId.'); string(annotation.text, 1, 10000, 'annotation.text'); dot(annotation.anchor, 'annotation.anchor'); break;
    }
  }
}

function validateExtensions(value: unknown): void {
  // The 1.0 schema permits arbitrary extension keys and values. Reverse-DNS
  // namespacing becomes mandatory when a future-minor migration is registered,
  // because then it distinguishes ignorable additive fields from known data.
  requireRecord(value, 'extensions');
}

function scope(value: unknown): void { const scopeValue = requireRecord(value, 'annotation.scope'); if (scopeValue.kind === 'set') { exactKeys(scopeValue, ['kind', 'setId'], ['kind', 'setId']); id(scopeValue.setId, 'annotation.scope.setId'); } else if (scopeValue.kind === 'transition') { exactKeys(scopeValue, ['kind', 'transitionId'], ['kind', 'transitionId']); id(scopeValue.transitionId, 'annotation.scope.transitionId'); } else if (scopeValue.kind === 'show') exactKeys(scopeValue, ['kind'], ['kind']); else throw fileError('SCHEMA', 'annotation.scope.kind is invalid.'); }
function visibility(value: unknown): void { const flags = requireRecord(value, 'annotation.visibility'); exactKeys(flags, ['editor', 'print', 'performerPacket'], ['editor', 'print', 'performerPacket']); boolean(flags.editor, 'annotation.visibility.editor'); boolean(flags.print, 'annotation.visibility.print'); boolean(flags.performerPacket, 'annotation.visibility.performerPacket'); }
function polyline(value: unknown, label: string): void { for (const point of array(value, label, 2)) dot(point, label); }
function dot(value: unknown, label: string): void { const point = requireRecord(value, label); exactKeys(point, ['x', 'y'], ['x', 'y']); integer(point.x, 0, 288000, `${label}.x`); integer(point.y, 0, 153600, `${label}.y`); }
function requireRecord(value: unknown, label: string): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw fileError('SCHEMA', `${label} must be an object.`); return value as Record<string, unknown>; }
function array(value: unknown, label: string, min = 0): unknown[] { if (!Array.isArray(value) || value.length < min) throw fileError('SCHEMA', `${label} must be an array with at least ${min} item(s).`); return value; }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw fileError('SCHEMA', `Unexpected property: ${key}.`); for (const key of required) if (!(key in value)) throw fileError('SCHEMA', `Missing required property: ${key}.`); }
function id(value: unknown, label: string): void { if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) throw fileError('SCHEMA', `${label} is not a valid identifier.`); }
function string(value: unknown, min: number, max: number | undefined, label: string): void { const length = typeof value === 'string' ? Array.from(value).length : 0; if (typeof value !== 'string' || length < min || (max !== undefined && length > max)) throw fileError('SCHEMA', `${label} must be a string${min > 0 ? ` with at least ${min} character(s)` : ''}.`); }
function integer(value: unknown, min: number, max: number | undefined, label: string): void { if (!Number.isInteger(value) || (value as number) < min || (max !== undefined && (value as number) > max)) throw fileError('SCHEMA', `${label} must be an integer in range.`); }
function number(value: unknown, min: number, max: number | undefined, exclusiveMin: boolean, label: string): void { if (typeof value !== 'number' || !Number.isFinite(value) || (exclusiveMin ? value <= min : value < min) || (max !== undefined && value >= max)) throw fileError('SCHEMA', `${label} is out of range.`); }
function boolean(value: unknown, label: string): void { if (typeof value !== 'boolean') throw fileError('SCHEMA', `${label} must be a boolean.`); }
function isoDate(value: unknown, label: string): void {
  if (typeof value !== 'string') throw fileError('SCHEMA', `${label} must be an ISO date-time.`);
  // Match Ajv's RFC3339 date-time behavior, including lower-case separators,
  // arbitrary fractional precision, offsets, and a legal leap second. Native
  // Date.parse cannot be the authority here because it normalizes bad dates.
  const match = /^(\d{4})-(\d\d)-(\d\d)[Tt ](\d\d):(\d\d):(\d\d)(?:[.](\d+))?([Zz]|[+-](\d\d):(\d\d))$/.exec(value);
  if (!match) throw fileError('SCHEMA', `${label} must be an ISO date-time.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, zoneHourText, zoneMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const zoneHour = zone === 'Z' || zone === 'z' ? 0 : Number(zoneHourText);
  const zoneMinute = zone === 'Z' || zone === 'z' ? 0 : Number(zoneMinuteText);
  const daysInMonth = month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 60
    || (second === 60 && (hour !== 23 || minute !== 59)) || zoneHour > 23 || zoneMinute > 59) {
    throw fileError('SCHEMA', `${label} must be an ISO date-time.`);
  }
}
function uri(value: unknown, label: string): void { if (typeof value !== 'string') throw fileError('SCHEMA', `${label} must be a URI.`); try { new URL(value); } catch { throw fileError('SCHEMA', `${label} must be a URI.`); } }
function unique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw fileError('SEMANTIC', `Duplicate ${label}.`); }
function requireSemver(value: unknown, label: string): readonly [number, number, number] { if (typeof value !== 'string') throw fileError('INVALID_VERSION', `${label} must be a semantic version.`); const match = /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/.exec(value); if (!match) throw fileError('INVALID_VERSION', `${label} must be a semantic version without prerelease metadata.`); return [Number(match[1]), Number(match[2]), Number(match[3])]; }
function fileError(code: string, message: string): FreeformFileError { return new FreeformFileError(message, code); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
