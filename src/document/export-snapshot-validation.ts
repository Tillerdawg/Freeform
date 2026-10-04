import { validateDocumentAnnotations } from './annotations';
import { isAjvRfc3339DateTime } from './rfc3339';
import { validateDocumentSetsAndTransitions } from './sets';
import { isAjvUri } from './uri';
import type { FreeformDocument } from './types';
import { validateFtlTransition } from '../timeline/ftl';

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * Validates an immutable export snapshot without involving persistence or a command
 * store. This mirrors the strict persisted-document boundary: export never repairs
 * malformed input or converts it into a different document.
 */
export function validateExportSnapshot(value: unknown): asserts value is FreeformDocument {
  const document = record(value, 'document');
  exactKeys(document, ['$schema', 'format', 'formatVersion', 'show', 'field', 'settings', 'performers', 'sets', 'transitions', 'annotations', 'layers', 'symbols', 'extensions'],
    ['format', 'formatVersion', 'show', 'field', 'settings', 'performers', 'sets', 'transitions', 'annotations']);
  if (document.format !== 'freeform' || document.formatVersion !== '1.0.0') throw new Error('Unsupported document format.');
  if (document.$schema !== undefined) uri(document.$schema, '$schema');
  validateShow(document.show);
  validateField(document.field);
  validateSettings(document.settings);
  validatePerformers(document.performers);
  validateSets(document.sets);
  validateTransitions(document.transitions);
  if (document.layers !== undefined) validateLayers(document.layers);
  if (document.symbols !== undefined) validateSymbols(document.symbols);
  if (document.extensions !== undefined) record(document.extensions, 'extensions');

  const typed = document as unknown as FreeformDocument;
  validateDocumentSetsAndTransitions(typed);
  validateDocumentAnnotations(typed);
  for (const transition of typed.transitions) if (transition.mode === 'ftl') validateFtlTransition(typed, transition);
  unique(typed.performers.map(({ id }) => id), 'performer IDs');
  unique(typed.performers.map(({ rankCode }) => rankCode.toLocaleLowerCase('en-US')), 'performer rank codes');
}

function validateShow(value: unknown): void {
  const show = record(value, 'show');
  exactKeys(show, ['id', 'title', 'totalCounts', 'createdAt', 'updatedAt'], ['id', 'title', 'totalCounts']);
  id(show.id, 'show.id'); string(show.title, 1, 200, 'show.title'); integer(show.totalCounts, 0, undefined, 'show.totalCounts');
  if (show.createdAt !== undefined) dateTime(show.createdAt, 'show.createdAt');
  if (show.updatedAt !== undefined) dateTime(show.updatedAt, 'show.updatedAt');
}

function validateField(value: unknown): void {
  const field = record(value, 'field');
  exactKeys(field, ['preset', 'unitsPerYard', 'lengthUnits', 'widthUnits', 'frontHashY', 'backHashY'], ['preset', 'unitsPerYard', 'lengthUnits', 'widthUnits', 'frontHashY', 'backHashY']);
  const expected = { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 };
  for (const [key, expectedValue] of Object.entries(expected)) if (field[key] !== expectedValue) throw new Error(`field.${key} is invalid.`);
}

function validateSettings(value: unknown): void {
  const settings = record(value, 'settings');
  exactKeys(settings, ['collisionThresholdUnits'], ['collisionThresholdUnits']);
  integer(settings.collisionThresholdUnits, 1, 28800, 'settings.collisionThresholdUnits');
}

function validatePerformers(value: unknown): void {
  for (const performerValue of array(value, 'performers', 1)) {
    const performer = record(performerValue, 'performer');
    exactKeys(performer, ['id', 'rankCode', 'displayName', 'section', 'notes'], ['id', 'rankCode', 'displayName']);
    id(performer.id, 'performer.id');
    if (typeof performer.rankCode !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(performer.rankCode)) throw new Error('performer.rankCode is invalid.');
    string(performer.displayName, 1, 120, 'performer.displayName');
    if (performer.section !== undefined) string(performer.section, 0, 80, 'performer.section');
    if (performer.notes !== undefined) string(performer.notes, 0, 10000, 'performer.notes');
  }
}

function validateSets(value: unknown): void {
  for (const setValue of array(value, 'sets', 1)) {
    const set = record(setValue, 'set');
    exactKeys(set, ['id', 'name', 'startCount', 'positions'], ['id', 'name', 'startCount', 'positions']);
    id(set.id, 'set.id'); string(set.name, 1, 120, 'set.name'); integer(set.startCount, 0, undefined, 'set.startCount');
    const positions = record(set.positions, 'set.positions');
    if (Object.keys(positions).length === 0) throw new Error('set.positions must not be empty.');
    for (const [performerId, dotValue] of Object.entries(positions)) { id(performerId, 'set.position performer ID'); dot(dotValue, 'set.position'); }
  }
}

function validateTransitions(value: unknown): void {
  for (const transitionValue of array(value, 'transitions')) {
    const transition = record(transitionValue, 'transition');
    exactKeys(transition, ['id', 'fromSetId', 'toSetId', 'counts', 'mode', 'ftl', 'notes', 'collisionOverrides'], ['id', 'fromSetId', 'toSetId', 'counts', 'mode']);
    id(transition.id, 'transition.id'); id(transition.fromSetId, 'transition.fromSetId'); id(transition.toSetId, 'transition.toSetId'); integer(transition.counts, 1, undefined, 'transition.counts');
    if (transition.mode !== 'float' && transition.mode !== 'ftl') throw new Error('transition.mode is invalid.');
    if (transition.mode === 'ftl' && transition.ftl === undefined) throw new Error('FTL transition requires ftl.');
    if (transition.mode === 'float' && transition.ftl !== undefined) throw new Error('Float transition cannot include ftl.');
    if (transition.ftl !== undefined) validateFtl(transition.ftl);
    if (transition.notes !== undefined) string(transition.notes, 0, 10000, 'transition.notes');
    if (transition.collisionOverrides !== undefined) validateCollisionOverrides(transition.collisionOverrides);
  }
}

function validateFtl(value: unknown): void {
  const ftl = record(value, 'ftl');
  exactKeys(ftl, ['leaderId', 'followerIds', 'offsetUnits', 'distanceUnits', 'path', 'expectedEndPositions'], ['leaderId', 'followerIds', 'offsetUnits', 'distanceUnits', 'path']);
  id(ftl.leaderId, 'ftl.leaderId');
  for (const follower of array(ftl.followerIds, 'ftl.followerIds', 1)) id(follower, 'ftl.followerId');
  for (const [performerId, offset] of Object.entries(record(ftl.offsetUnits, 'ftl.offsetUnits'))) { id(performerId, 'ftl.offset performer ID'); integer(offset, 0, undefined, 'ftl.offset'); }
  integer(ftl.distanceUnits, 1, undefined, 'ftl.distanceUnits'); polyline(ftl.path, 'ftl.path');
  if (ftl.expectedEndPositions !== undefined) for (const [performerId, position] of Object.entries(record(ftl.expectedEndPositions, 'ftl.expectedEndPositions'))) { id(performerId, 'ftl.expectedEndPositions performer ID'); dot(position, 'ftl.expectedEndPositions'); }
}

function validateCollisionOverrides(value: unknown): void {
  for (const overrideValue of array(value, 'collisionOverrides')) {
    const override = record(overrideValue, 'collision override');
    exactKeys(override, ['performerIds', 'warningSignature', 'reason', 'overriddenAt', 'authorLabel'], ['performerIds', 'warningSignature', 'reason', 'overriddenAt', 'authorLabel']);
    const performerIds = array(override.performerIds, 'collision override performerIds', 2);
    if (performerIds.length !== 2) throw new Error('collision override performerIds must contain two IDs.');
    id(performerIds[0], 'collision override performer ID'); id(performerIds[1], 'collision override performer ID');
    if (typeof override.warningSignature !== 'string' || !/^v1-sha256-[a-f0-9]{64}$/.test(override.warningSignature)) throw new Error('collision override warningSignature is invalid.');
    string(override.reason, 1, 1000, 'collision override reason'); dateTime(override.overriddenAt, 'collision override overriddenAt'); string(override.authorLabel, 1, 120, 'collision override authorLabel');
  }
}

function validateLayers(value: unknown): void {
  for (const layerValue of array(value, 'layers')) {
    const layer = record(layerValue, 'layer'); exactKeys(layer, ['id', 'name', 'visible', 'print', 'locked'], ['id', 'name', 'visible', 'print', 'locked']);
    id(layer.id, 'layer.id'); string(layer.name, 1, 120, 'layer.name'); boolean(layer.visible, 'layer.visible'); boolean(layer.print, 'layer.print'); boolean(layer.locked, 'layer.locked');
  }
}

function validateSymbols(value: unknown): void {
  for (const symbolValue of array(value, 'symbols')) {
    const symbol = record(symbolValue, 'symbol'); exactKeys(symbol, ['id', 'name', 'glyph'], ['id', 'name', 'glyph']);
    id(symbol.id, 'symbol.id'); string(symbol.name, 1, 120, 'symbol.name'); string(symbol.glyph, 1, 8000, 'symbol.glyph');
  }
}

function dot(value: unknown, label: string): void { const point = record(value, label); exactKeys(point, ['x', 'y'], ['x', 'y']); integer(point.x, 0, 288000, `${label}.x`); integer(point.y, 0, 153600, `${label}.y`); }
function polyline(value: unknown, label: string): void { for (const point of array(value, label, 2)) dot(point, label); }
function record(value: unknown, label: string): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown>; }
function array(value: unknown, label: string, min = 0): readonly unknown[] { if (!Array.isArray(value) || value.length < min) throw new Error(`${label} is invalid.`); return value; }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unexpected property: ${key}.`); for (const key of required) if (!(key in value)) throw new Error(`Missing required property: ${key}.`); }
function id(value: unknown, label: string): void { if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`); }
function string(value: unknown, min: number, max: number, label: string): void { const length = typeof value === 'string' ? Array.from(value).length : 0; if (typeof value !== 'string' || length < min || length > max) throw new Error(`${label} is invalid.`); }
function integer(value: unknown, min: number, max: number | undefined, label: string): void { if (!Number.isInteger(value) || (value as number) < min || (max !== undefined && (value as number) > max)) throw new Error(`${label} is invalid.`); }
function boolean(value: unknown, label: string): void { if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`); }
function dateTime(value: unknown, label: string): void { if (typeof value !== 'string' || !isAjvRfc3339DateTime(value)) throw new Error(`${label} is invalid.`); }
function uri(value: unknown, label: string): void { if (!isAjvUri(value)) throw new Error(`${label} is invalid.`); }
function unique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`); }
