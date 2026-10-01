import { assertValidDot } from '../geometry/nfhs';
import type {
  Annotation,
  AnnotationLayer,
  AnnotationScope,
  AnnotationVisibility,
  Dot,
  FreeformDocument,
  Identifier,
  SymbolDefinition,
} from './types';

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export type AnnotationRenderContext =
  | Readonly<{ kind: 'static-set'; setId: Identifier }>
  | Readonly<{ kind: 'active-transition'; transitionId: Identifier }>
  | Readonly<{ kind: 'show' }>
  | Readonly<{ kind: 'set-range'; firstSetId: Identifier; lastSetId: Identifier }>;

export type AnnotationAudience = 'editor' | 'director-print' | 'performer-packet';

/**
 * Pure rendering/export seam. Context is explicit so callers cannot accidentally
 * inherit an active editor page; this module never stores selection state.
 */
export interface AnnotationSelection {
  readonly context: AnnotationRenderContext;
  readonly audience: AnnotationAudience;
  /** Required only for individual performer packets. */
  readonly performerId?: Identifier;
}

/** Validates all annotation/layer/symbol structural and cross-reference rules. */
export function validateDocumentAnnotations(
  document: Pick<FreeformDocument, 'annotations' | 'layers' | 'symbols' | 'performers' | 'sets' | 'transitions'>,
): void {
  // `layers` and `symbols` are optional for backwards-compatible documents,
  // but a present value must still be an array.  Do not use `??` here: it
  // would silently normalize schema-invalid `null` at the canonical boundary.
  const layers = document.layers === undefined ? [] : document.layers;
  const symbols = document.symbols === undefined ? [] : document.symbols;
  assertArray(layers, 'Layers');
  assertArray(symbols, 'Symbols');
  assertArray(document.annotations, 'Annotations');

  assertUniqueIds(layers, 'Layer', validateLayer);
  assertUniqueIds(symbols, 'Symbol', validateSymbol);
  assertUniqueIds(document.annotations, 'Annotation', validateAnnotation);

  const layerIds = new Set(layers.map(({ id }) => id));
  const symbolIds = new Set(symbols.map(({ id }) => id));
  const performerIds = new Set(document.performers.map(({ id }) => id));
  const setIds = new Set(document.sets.map(({ id }) => id));
  const transitionIds = new Set(document.transitions.map(({ id }) => id));

  for (const annotation of document.annotations) {
    if (!layerIds.has(annotation.layerId)) {
      throw new Error(`Annotation ${annotation.id} references an unknown layer: ${annotation.layerId}`);
    }
    if (annotation.performerId !== undefined && !performerIds.has(annotation.performerId)) {
      throw new Error(`Annotation ${annotation.id} references an unknown performer: ${annotation.performerId}`);
    }
    if (annotation.kind === 'symbol' && !symbolIds.has(annotation.symbolId)) {
      throw new Error(`Annotation ${annotation.id} references an unknown symbol: ${annotation.symbolId}`);
    }
    validateScopeReference(annotation.id, annotation.scope, setIds, transitionIds);
  }
}

/**
 * Selects valid annotations for one explicit rendering context without mutation.
 * An active transition intentionally excludes both endpoint sets' static marks.
 */
export function selectAnnotations(
  document: Pick<FreeformDocument, 'annotations' | 'layers' | 'performers' | 'sets' | 'transitions'>,
  selection: AnnotationSelection,
): readonly Annotation[] {
  const layers = document.layers === undefined ? [] : document.layers;
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  const applies = scopeMatcher(document, selection.context);

  if (selection.audience === 'performer-packet') {
    if (!selection.performerId) throw new Error('Performer packet selection requires a performer ID.');
    if (!document.performers.some(({ id }) => id === selection.performerId)) {
      throw new Error(`Unknown performer: ${selection.performerId}`);
    }
  }

  const annotations = document.annotations.filter((annotation) => {
    const layer = layersById.get(annotation.layerId);
    if (!layer) throw new Error(`Annotation ${annotation.id} references an unknown layer: ${annotation.layerId}`);
    if (!applies(annotation.scope)) return false;

    switch (selection.audience) {
      case 'editor':
        return annotation.visibility.editor && layer.visible;
      case 'director-print':
        return annotation.visibility.print && layer.print;
      case 'performer-packet':
        return annotation.visibility.performerPacket && annotation.performerId === selection.performerId;
    }
  });
  // Layer array order is the canonical z-order: later layers draw on top.
  // Keep a stable within-layer order from the annotation array.
  return annotations.slice().sort((left, right) => (
    (layersById.get(left.layerId) ? layers.indexOf(layersById.get(left.layerId)!) : 0)
    - (layersById.get(right.layerId) ? layers.indexOf(layersById.get(right.layerId)!) : 0)
  ));
}

function scopeMatcher(
  document: Pick<FreeformDocument, 'sets' | 'transitions'>,
  context: AnnotationRenderContext,
): (scope: AnnotationScope) => boolean {
  switch (context.kind) {
    case 'show':
      return (scope) => scope.kind === 'show';
    case 'static-set': {
      assertKnownId(document.sets.map(({ id }) => id), context.setId, 'set');
      return (scope) => scope.kind === 'show' || (scope.kind === 'set' && scope.setId === context.setId);
    }
    case 'active-transition': {
      assertKnownId(document.transitions.map(({ id }) => id), context.transitionId, 'transition');
      return (scope) => scope.kind === 'show'
        || (scope.kind === 'transition' && scope.transitionId === context.transitionId);
    }
    case 'set-range': {
      const firstIndex = document.sets.findIndex(({ id }) => id === context.firstSetId);
      const lastIndex = document.sets.findIndex(({ id }) => id === context.lastSetId);
      if (firstIndex < 0) throw new Error(`Unknown set: ${context.firstSetId}`);
      if (lastIndex < 0) throw new Error(`Unknown set: ${context.lastSetId}`);
      if (firstIndex > lastIndex) throw new Error('Set range must follow document order.');
      const setIds = new Set(document.sets.slice(firstIndex, lastIndex + 1).map(({ id }) => id));
      const transitionIds = new Set(document.transitions
        .filter((transition) => setIds.has(transition.fromSetId) && setIds.has(transition.toSetId))
        .map(({ id }) => id));
      return (scope) => scope.kind === 'show'
        || (scope.kind === 'set' && setIds.has(scope.setId))
        || (scope.kind === 'transition' && transitionIds.has(scope.transitionId));
    }
  }
}

function validateLayer(value: AnnotationLayer): void {
  const layer = assertRecord(value, 'Layer');
  assertExactKeys(layer, ['id', 'name', 'visible', 'print', 'locked'], 'Layer');
  assertId(layer.id, 'Layer ID');
  assertString(layer.name, 1, 120, 'Layer name');
  assertBoolean(layer.visible, 'Layer visible');
  assertBoolean(layer.print, 'Layer print');
  assertBoolean(layer.locked, 'Layer locked');
}

function validateSymbol(value: SymbolDefinition): void {
  const symbol = assertRecord(value, 'Symbol');
  assertExactKeys(symbol, ['id', 'name', 'glyph'], 'Symbol');
  assertId(symbol.id, 'Symbol ID');
  assertString(symbol.name, 1, 120, 'Symbol name');
  assertString(symbol.glyph, 1, 8000, 'Symbol glyph');
}

function validateAnnotation(value: Annotation): void {
  const annotation = assertRecord(value, 'Annotation');
  const kind = annotation.kind;
  if (typeof kind !== 'string') throw new Error('Annotation kind must be a string.');
  const commonKeys = ['id', 'kind', 'layerId', 'scope', 'visibility', 'performerId'];
  switch (kind) {
    case 'freehand':
      assertExactKeys(annotation, [...commonKeys, 'strokes'], 'Freehand annotation');
      validateAnnotationBase(annotation);
      validateStrokes(annotation.strokes);
      return;
    case 'arrow':
      assertExactKeys(annotation, [...commonKeys, 'points'], 'Arrow annotation');
      validateAnnotationBase(annotation);
      validatePolyline(annotation.points, 'Arrow points');
      return;
    case 'symbol':
      assertExactKeys(annotation, [...commonKeys, 'symbolId', 'anchor', 'rotationDegrees', 'scale'], 'Symbol annotation');
      validateAnnotationBase(annotation);
      assertId(annotation.symbolId, 'Symbol annotation symbol ID');
      validateDot(annotation.anchor, 'Symbol annotation anchor');
      if (annotation.rotationDegrees !== undefined) assertFiniteNumber(annotation.rotationDegrees, 0, 360, false, 'Symbol rotationDegrees');
      if (annotation.scale !== undefined) assertFiniteNumber(annotation.scale, 0, undefined, true, 'Symbol scale');
      return;
    case 'label':
      assertExactKeys(annotation, [...commonKeys, 'text', 'anchor'], 'Label annotation');
      validateAnnotationBase(annotation);
      assertString(annotation.text, 1, 10000, 'Label text');
      validateDot(annotation.anchor, 'Label anchor');
      return;
    case 'performerNote':
      assertExactKeys(annotation, [...commonKeys, 'text', 'anchor'], 'Performer note annotation');
      validateAnnotationBase(annotation);
      if (annotation.performerId === undefined) throw new Error('Performer note annotations require a performer ID.');
      assertString(annotation.text, 1, 10000, 'Performer note text');
      validateDot(annotation.anchor, 'Performer note anchor');
      return;
    default:
      throw new Error(`Unknown annotation kind: ${kind}`);
  }
}

function validateAnnotationBase(annotation: Record<string, unknown>): void {
  assertId(annotation.id, 'Annotation ID');
  assertId(annotation.layerId, 'Annotation layer ID');
  validateScope(annotation.scope);
  validateVisibility(annotation.visibility);
  if (annotation.performerId !== undefined) assertId(annotation.performerId, 'Annotation performer ID');
  const visibility = annotation.visibility as AnnotationVisibility;
  if (visibility.performerPacket && annotation.performerId === undefined) {
    throw new Error('Performer packet visibility requires a performer ID.');
  }
}

function validateScope(value: unknown): asserts value is AnnotationScope {
  const scope = assertRecord(value, 'Annotation scope');
  switch (scope.kind) {
    case 'set':
      assertExactKeys(scope, ['kind', 'setId'], 'Set annotation scope');
      assertId(scope.setId, 'Annotation set scope ID');
      return;
    case 'transition':
      assertExactKeys(scope, ['kind', 'transitionId'], 'Transition annotation scope');
      assertId(scope.transitionId, 'Annotation transition scope ID');
      return;
    case 'show':
      assertExactKeys(scope, ['kind'], 'Show annotation scope');
      return;
    default:
      throw new Error('Annotation scope kind must be set, transition, or show.');
  }
}

function validateVisibility(value: unknown): asserts value is AnnotationVisibility {
  const visibility = assertRecord(value, 'Annotation visibility');
  assertExactKeys(visibility, ['editor', 'print', 'performerPacket'], 'Annotation visibility');
  assertBoolean(visibility.editor, 'Annotation editor visibility');
  assertBoolean(visibility.print, 'Annotation print visibility');
  assertBoolean(visibility.performerPacket, 'Annotation performer packet visibility');
}

function validateStrokes(value: unknown): void {
  assertArray(value, 'Freehand strokes');
  if (value.length < 1) throw new Error('Freehand strokes must contain at least one polyline.');
  for (const [index, stroke] of value.entries()) validatePolyline(stroke, `Freehand stroke ${index}`);
}

function validatePolyline(value: unknown, label: string): void {
  assertArray(value, label);
  if (value.length < 2) throw new Error(`${label} must contain at least two dots.`);
  for (const dot of value) validateDot(dot, label);
}

function validateDot(value: unknown, label: string): asserts value is Dot {
  const dot = assertRecord(value, label);
  assertExactKeys(dot, ['x', 'y'], label);
  assertValidDot(dot as unknown as Dot);
}

function validateScopeReference(
  annotationId: string,
  scope: AnnotationScope,
  setIds: ReadonlySet<string>,
  transitionIds: ReadonlySet<string>,
): void {
  if (scope.kind === 'set' && !setIds.has(scope.setId)) {
    throw new Error(`Annotation ${annotationId} references an unknown set scope: ${scope.setId}`);
  }
  if (scope.kind === 'transition' && !transitionIds.has(scope.transitionId)) {
    throw new Error(`Annotation ${annotationId} references an unknown transition scope: ${scope.transitionId}`);
  }
}

function assertUniqueIds<T extends { readonly id: Identifier }>(
  values: readonly T[],
  label: string,
  validate: (value: T) => void,
): void {
  const ids = new Set<string>();
  for (const value of values) {
    validate(value);
    if (ids.has(value.id)) throw new Error(`${label} ID already exists: ${value.id}`);
    ids.add(value.id);
  }
}

function assertKnownId(ids: readonly string[], id: string, label: string): void {
  if (!ids.includes(id)) throw new Error(`Unknown ${label}: ${id}`);
}

function assertId(value: unknown, label: string): asserts value is Identifier {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
}

function assertString(value: unknown, minimum: number, maximum: number, label: string): asserts value is string {
  // JSON Schema's string length is measured in Unicode code points. JavaScript
  // String.length counts UTF-16 code units, so use the iterable instead.
  const length = typeof value === 'string' ? Array.from(value).length : 0;
  if (typeof value !== 'string' || length < minimum || length > maximum) {
    throw new Error(`${label} must contain ${minimum} through ${maximum} characters.`);
  }
}

function assertFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number | undefined,
  exclusiveMinimum: boolean,
  label: string,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || (exclusiveMinimum ? value <= minimum : value < minimum)
    || (maximum !== undefined && value >= maximum)) {
    throw new Error(`${label} is out of range.`);
  }
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
}

function assertArray(value: unknown, label: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, permitted: readonly string[], label: string): void {
  const permittedKeys = new Set(permitted);
  for (const key of Object.keys(value)) {
    if (!permittedKeys.has(key)) throw new Error(`${label} contains unsupported property: ${key}`);
  }
}
