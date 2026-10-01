import type {
  CommandStore,
  DocumentCommand,
  DocumentState,
  FreeformDocument,
} from './types';
import { assertValidDot } from '../geometry/nfhs';
import { validateDocumentAnnotations } from './annotations';
import {
  validateCollisionOverride,
  validateCollisionThreshold,
  validateDocumentSetsAndTransitions,
  validateTransition,
  validateOrderedSets,
  validateSetCoverage,
} from './sets';
import { validateDocumentForCommandStore } from '../persistence/freeform-file';

interface HistoryEntry {
  readonly command: DocumentCommand;
  readonly before: DocumentState;
  readonly after: DocumentState;
}

/**
 * The only mutable values in this module are the three history cursors. Every
 * document state exposed to callers is cloned and deeply frozen, so downstream
 * geometry/motion engines can safely treat it as a canonical immutable input.
 */
export function createCommandStore(initialDocument: FreeformDocument): CommandStore {
  let current = makeState(initialDocument, 0);
  let undoHistory: HistoryEntry[] = [];
  let redoHistory: HistoryEntry[] = [];

  return {
    getState: () => current,
    apply(command) {
      const nextDocument = reduce(current.document, command);
      const next = makeState(nextDocument, current.revision + 1);
      undoHistory = [...undoHistory, freeze({ command, before: current, after: next })];
      redoHistory = [];
      current = next;
      return current;
    },
    undo() {
      const entry = undoHistory.at(-1);
      if (!entry) return undefined;

      undoHistory = undoHistory.slice(0, -1);
      redoHistory = [...redoHistory, entry];
      current = entry.before;
      return current;
    },
    redo() {
      const entry = redoHistory.at(-1);
      if (!entry) return undefined;

      redoHistory = redoHistory.slice(0, -1);
      undoHistory = [...undoHistory, entry];
      current = entry.after;
      return current;
    },
    canUndo: () => undoHistory.length > 0,
    canRedo: () => redoHistory.length > 0,
    getUndoCommands: () => undoHistory.map(({ command }) => command),
  };
}

function reduce(document: FreeformDocument, command: DocumentCommand): FreeformDocument {
  switch (command.type) {
    case 'show.title.set':
      return { ...document, show: { ...document.show, title: command.title } };
    case 'show.total-counts.set':
      return { ...document, show: { ...document.show, totalCounts: command.totalCounts } };
    case 'performer.create':
      return addPerformer(document, command);
    case 'performer.remove':
      return removePerformer(document, command.performerId);
    case 'performer.displayName.batchSet':
      return batchSetPerformerDisplayNames(document, command.updates);
    case 'set.create':
      return addSet(document, command.set);
    case 'set.remove':
      return removeSet(document, command.setId);
    case 'set.reorder':
      return reorderSet(document, command.setId, command.startCount);
    case 'set.performer.add':
      return addSetPerformerCoverage(document, command);
    case 'set.performer.remove':
      return removeSetPerformerCoverage(document, command);
    case 'dot.create':
      return placeDot(document, command, false);
    case 'dot.move':
      return placeDot(document, command, true);
    case 'transition.create':
      return addTransition(document, command.transition);
    case 'transition.remove':
      return removeTransition(document, command.transitionId);
    case 'settings.collision-threshold.set':
      return setCollisionThreshold(document, command.collisionThresholdUnits);
    case 'collision.override.record':
      return recordCollisionOverride(document, command.transitionId, command.override);
    case 'annotation.create':
      return createAnnotation(document, command.annotation);
    case 'annotation.update':
      return updateAnnotation(document, command.annotation);
    case 'annotation.remove':
      return removeAnnotation(document, command.annotationId);
    case 'layer.create':
      return createLayer(document, command.layer);
    case 'layer.update':
      return updateLayer(document, command.layer);
    case 'layer.reorder':
      return reorderLayer(document, command.layerId, command.index);
    case 'layer.remove':
      return removeLayer(document, command.layerId);
    case 'symbol.create':
      return createSymbol(document, command.symbol);
    case 'symbol.update':
      return updateSymbol(document, command.symbol);
    case 'symbol.remove':
      return removeSymbol(document, command.symbolId);
    case 'document.replace':
      return command.document;
  }
}

function addSet(document: FreeformDocument, set: FreeformDocument['sets'][number]): FreeformDocument {
  if (document.sets.some((candidate) => candidate.id === set.id)) {
    throw new Error(`Set ID already exists: ${set.id}`);
  }
  validateSetCoverage(document.performers, set);
  const next = { ...document, sets: [...document.sets, set].sort((left, right) => left.startCount - right.startCount) };
  validateOrderedSets(next);
  return next;
}

function removeSet(document: FreeformDocument, setId: string): FreeformDocument {
  if (!document.sets.some((set) => set.id === setId)) throw new Error(`Unknown set: ${setId}`);
  if (document.sets.length === 1) throw new Error('A document must retain at least one set.');
  if (document.transitions.some((transition) => transition.fromSetId === setId || transition.toSetId === setId)) {
    throw new Error(`Remove transitions connected to set ${setId} before removing it.`);
  }
  if (document.annotations.some((annotation) => annotation.scope.kind === 'set' && annotation.scope.setId === setId)) {
    throw new Error(`Remove annotations scoped to set ${setId} before removing it.`);
  }
  return { ...document, sets: document.sets.filter((set) => set.id !== setId) };
}

function reorderSet(document: FreeformDocument, setId: string, startCount: number): FreeformDocument {
  if (!Number.isInteger(startCount) || startCount < 0) {
    throw new Error('Set start count must be a nonnegative integer.');
  }
  if (!document.sets.some((set) => set.id === setId)) throw new Error(`Unknown set: ${setId}`);
  const next = {
    ...document,
    sets: document.sets
      .map((set) => set.id === setId ? { ...set, startCount } : set)
      .sort((left, right) => left.startCount - right.startCount),
  };
  validateOrderedSets(next);
  for (const transition of next.transitions) validateTransition(next, transition);
  return next;
}

function addSetPerformerCoverage(
  document: FreeformDocument,
  command: Extract<DocumentCommand, { readonly type: 'set.performer.add' }>,
): FreeformDocument {
  assertValidDot(command.dot);
  if (!document.performers.some((performer) => performer.id === command.performerId)) {
    throw new Error(`Unknown performer: ${command.performerId}`);
  }
  const set = document.sets.find((candidate) => candidate.id === command.setId);
  if (!set) throw new Error(`Unknown set: ${command.setId}`);
  if (command.performerId in set.positions) {
    throw new Error(`Set ${set.id} already contains a dot for performer: ${command.performerId}`);
  }
  return {
    ...document,
    sets: document.sets.map((candidate) => candidate.id === set.id
      ? { ...candidate, positions: { ...candidate.positions, [command.performerId]: command.dot } }
      : candidate),
  };
}

function removeSetPerformerCoverage(
  document: FreeformDocument,
  command: Extract<DocumentCommand, { readonly type: 'set.performer.remove' }>,
): FreeformDocument {
  const set = document.sets.find((candidate) => candidate.id === command.setId);
  if (!set) throw new Error(`Unknown set: ${command.setId}`);
  if (!(command.performerId in set.positions)) {
    throw new Error(`Set ${set.id} has no dot for performer: ${command.performerId}`);
  }
  throw new Error('Removing performer coverage would violate the complete-set requirement.');
}

function addTransition(document: FreeformDocument, transition: FreeformDocument['transitions'][number]): FreeformDocument {
  if (document.transitions.some((candidate) => candidate.id === transition.id)) {
    throw new Error(`Transition ID already exists: ${transition.id}`);
  }
  if (document.transitions.some((candidate) => candidate.fromSetId === transition.fromSetId && candidate.toSetId === transition.toSetId)) {
    throw new Error(`A transition already connects ${transition.fromSetId} to ${transition.toSetId}.`);
  }
  validateTransition(document, transition);
  return { ...document, transitions: [...document.transitions, transition] };
}

function removeTransition(document: FreeformDocument, transitionId: string): FreeformDocument {
  const transition = document.transitions.find((candidate) => candidate.id === transitionId);
  if (!transition) {
    throw new Error(`Unknown transition: ${transitionId}`);
  }
  if (document.annotations.some((annotation) => annotation.scope.kind === 'transition' && annotation.scope.transitionId === transitionId)) {
    throw new Error(`Remove annotations scoped to transition ${transitionId} before removing it.`);
  }
  if (transition.notes !== undefined && transition.notes.length > 0) {
    throw new Error(`Transition ${transitionId} has notes; remove them explicitly before removing the transition.`);
  }
  if ((transition.collisionOverrides?.length ?? 0) > 0) {
    throw new Error(`Transition ${transitionId} has collision overrides; remove them explicitly before removing the transition.`);
  }
  return { ...document, transitions: document.transitions.filter((transition) => transition.id !== transitionId) };
}

function setCollisionThreshold(document: FreeformDocument, collisionThresholdUnits: number): FreeformDocument {
  validateCollisionThreshold(collisionThresholdUnits);
  return { ...document, settings: { ...document.settings, collisionThresholdUnits } };
}

function recordCollisionOverride(
  document: FreeformDocument,
  transitionId: string,
  override: Extract<DocumentCommand, { readonly type: 'collision.override.record' }>['override'],
): FreeformDocument {
  validateCollisionOverride(document.performers, override);
  const transition = document.transitions.find(({ id }) => id === transitionId);
  if (!transition) throw new Error(`Unknown transition: ${transitionId}`);
  const normalized = {
    ...override,
    reason: override.reason.trim(),
    authorLabel: override.authorLabel.trim(),
  };
  const collisionOverrides = [
    ...(transition.collisionOverrides ?? []).filter((existing) => !(
      existing.performerIds[0] === normalized.performerIds[0]
      && existing.performerIds[1] === normalized.performerIds[1]
      && existing.warningSignature === normalized.warningSignature
    )),
    normalized,
  ];
  return {
    ...document,
    transitions: document.transitions.map((candidate) => candidate.id === transitionId
      ? { ...candidate, collisionOverrides }
      : candidate),
  };
}

function addPerformer(
  document: FreeformDocument,
  command: Extract<DocumentCommand, { readonly type: 'performer.create' }>,
): FreeformDocument {
  const { performer, positionsBySet } = command;
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(performer.id)) {
    throw new Error(`Invalid performer ID: ${performer.id}`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(performer.rankCode)) {
    throw new Error(`Invalid rank code: ${performer.rankCode}`);
  }
  if (performer.displayName.trim().length === 0) {
    throw new Error('Performer display name is required.');
  }
  if (document.performers.some((candidate) => candidate.id === performer.id)) {
    throw new Error(`Performer ID already exists: ${performer.id}`);
  }
  if (document.performers.some((candidate) => candidate.rankCode.toLowerCase() === performer.rankCode.toLowerCase())) {
    throw new Error(`Rank code already exists: ${performer.rankCode}`);
  }
  const expectedSetIds = new Set(document.sets.map(({ id }) => id));
  const coveredSetIds = Object.keys(positionsBySet);
  if (coveredSetIds.length !== expectedSetIds.size || coveredSetIds.some((setId) => !expectedSetIds.has(setId))) {
    throw new Error('Creating a performer requires exactly one dot for every existing set.');
  }
  for (const setId of expectedSetIds) {
    const dot = positionsBySet[setId];
    if (!dot) throw new Error(`Creating performer ${performer.id} is missing a dot for set: ${setId}`);
    assertValidDot(dot);
  }
  return {
    ...document,
    performers: [...document.performers, performer],
    sets: document.sets.map((set) => ({
      ...set,
      positions: { ...set.positions, [performer.id]: positionsBySet[set.id]! },
    })),
  };
}

function removePerformer(document: FreeformDocument, performerId: string): FreeformDocument {
  if (!document.performers.some((performer) => performer.id === performerId)) {
    throw new Error(`Unknown performer: ${performerId}`);
  }
  if (document.annotations.some((annotation) => annotation.performerId === performerId)) {
    throw new Error(`Remove annotations associated with performer ${performerId} before removing the performer.`);
  }
  return {
    ...document,
    performers: document.performers.filter((performer) => performer.id !== performerId),
    sets: document.sets.map((set) => ({
      ...set,
      positions: Object.fromEntries(Object.entries(set.positions).filter(([id]) => id !== performerId)),
    })),
  };
}

function batchSetPerformerDisplayNames(
  document: FreeformDocument,
  updates: Readonly<Record<string, string>>,
): FreeformDocument {
  for (const [performerId, displayName] of Object.entries(updates)) {
    if (!document.performers.some((performer) => performer.id === performerId)) {
      throw new Error(`Unknown performer: ${performerId}`);
    }
    if (displayName.trim().length === 0) {
      throw new Error('Performer display name is required.');
    }
  }
  return {
    ...document,
    performers: document.performers.map((performer) => (
      Object.prototype.hasOwnProperty.call(updates, performer.id)
        ? { ...performer, displayName: updates[performer.id]! }
        : performer
    )),
  };
}

function createAnnotation(
  document: FreeformDocument,
  annotation: FreeformDocument['annotations'][number],
): FreeformDocument {
  if (document.annotations.some((candidate) => candidate.id === annotation.id)) {
    throw new Error(`Annotation ID already exists: ${annotation.id}`);
  }
  assertLayerUnlocked(document, annotation.layerId);
  return { ...document, annotations: [...document.annotations, annotation] };
}

function updateAnnotation(
  document: FreeformDocument,
  annotation: FreeformDocument['annotations'][number],
): FreeformDocument {
  const existing = document.annotations.find((candidate) => candidate.id === annotation.id);
  if (!existing) throw new Error(`Unknown annotation: ${annotation.id}`);
  assertLayerUnlocked(document, existing.layerId);
  assertLayerUnlocked(document, annotation.layerId);
  return {
    ...document,
    annotations: document.annotations.map((candidate) => candidate.id === annotation.id ? annotation : candidate),
  };
}

function removeAnnotation(document: FreeformDocument, annotationId: string): FreeformDocument {
  const annotation = document.annotations.find((candidate) => candidate.id === annotationId);
  if (!annotation) throw new Error(`Unknown annotation: ${annotationId}`);
  assertLayerUnlocked(document, annotation.layerId);
  return { ...document, annotations: document.annotations.filter((candidate) => candidate.id !== annotationId) };
}

function createLayer(document: FreeformDocument, layer: NonNullable<FreeformDocument['layers']>[number]): FreeformDocument {
  const layers = document.layers ?? [];
  if (layers.some((candidate) => candidate.id === layer.id)) throw new Error(`Layer ID already exists: ${layer.id}`);
  return { ...document, layers: [...layers, layer] };
}

function updateLayer(document: FreeformDocument, layer: NonNullable<FreeformDocument['layers']>[number]): FreeformDocument {
  const layers = document.layers ?? [];
  const existing = layers.find((candidate) => candidate.id === layer.id);
  if (!existing) throw new Error(`Unknown layer: ${layer.id}`);
  if (existing.locked && !isOnlyUnlock(existing, layer)) {
    throw new Error(`Layer ${layer.id} is locked; unlock it before editing its properties.`);
  }
  return { ...document, layers: layers.map((candidate) => candidate.id === layer.id ? layer : candidate) };
}

function reorderLayer(document: FreeformDocument, layerId: string, index: number): FreeformDocument {
  const layers = document.layers ?? [];
  const currentIndex = layers.findIndex((candidate) => candidate.id === layerId);
  if (currentIndex < 0) throw new Error(`Unknown layer: ${layerId}`);
  assertLayerUnlocked(document, layerId);
  if (!Number.isInteger(index) || index < 0 || index >= layers.length) {
    throw new Error('Layer reorder index must name an existing layer position.');
  }
  const reordered = [...layers];
  const [layer] = reordered.splice(currentIndex, 1);
  reordered.splice(index, 0, layer!);
  return { ...document, layers: reordered };
}

function removeLayer(document: FreeformDocument, layerId: string): FreeformDocument {
  const layers = document.layers ?? [];
  if (!layers.some((candidate) => candidate.id === layerId)) throw new Error(`Unknown layer: ${layerId}`);
  assertLayerUnlocked(document, layerId);
  if (document.annotations.some((annotation) => annotation.layerId === layerId)) {
    throw new Error(`Remove annotations from layer ${layerId} before removing the layer.`);
  }
  return { ...document, layers: layers.filter((candidate) => candidate.id !== layerId) };
}

function createSymbol(document: FreeformDocument, symbol: NonNullable<FreeformDocument['symbols']>[number]): FreeformDocument {
  const symbols = document.symbols ?? [];
  if (symbols.some((candidate) => candidate.id === symbol.id)) throw new Error(`Symbol ID already exists: ${symbol.id}`);
  return { ...document, symbols: [...symbols, symbol] };
}

function updateSymbol(document: FreeformDocument, symbol: NonNullable<FreeformDocument['symbols']>[number]): FreeformDocument {
  const symbols = document.symbols ?? [];
  if (!symbols.some((candidate) => candidate.id === symbol.id)) throw new Error(`Unknown symbol: ${symbol.id}`);
  return { ...document, symbols: symbols.map((candidate) => candidate.id === symbol.id ? symbol : candidate) };
}

function removeSymbol(document: FreeformDocument, symbolId: string): FreeformDocument {
  const symbols = document.symbols ?? [];
  if (!symbols.some((candidate) => candidate.id === symbolId)) throw new Error(`Unknown symbol: ${symbolId}`);
  if (document.annotations.some((annotation) => annotation.kind === 'symbol' && annotation.symbolId === symbolId)) {
    throw new Error(`Remove symbol annotations using ${symbolId} before removing the symbol.`);
  }
  return { ...document, symbols: symbols.filter((candidate) => candidate.id !== symbolId) };
}

function assertLayerUnlocked(document: FreeformDocument, layerId: string): void {
  const layer = (document.layers ?? []).find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Unknown layer: ${layerId}`);
  if (layer.locked) throw new Error(`Layer ${layerId} is locked.`);
}

function isOnlyUnlock(
  existing: NonNullable<FreeformDocument['layers']>[number],
  replacement: NonNullable<FreeformDocument['layers']>[number],
): boolean {
  return replacement.locked === false
    && existing.id === replacement.id
    && existing.name === replacement.name
    && existing.visible === replacement.visible
    && existing.print === replacement.print;
}

function placeDot(
  document: FreeformDocument,
  command: Extract<DocumentCommand, { readonly type: 'dot.create' | 'dot.move' }>,
  mustAlreadyExist: boolean,
): FreeformDocument {
  assertValidDot(command.dot);
  if (!document.performers.some((performer) => performer.id === command.performerId)) {
    throw new Error(`Unknown performer: ${command.performerId}`);
  }

  const set = document.sets.find((candidate) => candidate.id === command.setId);
  if (!set) throw new Error(`Unknown set: ${command.setId}`);

  const hasExistingDot = command.performerId in set.positions;
  if (mustAlreadyExist && !hasExistingDot) {
    throw new Error(`Cannot move missing dot for performer: ${command.performerId}`);
  }
  if (!mustAlreadyExist && hasExistingDot) {
    throw new Error(`Dot already exists for performer: ${command.performerId}`);
  }

  return {
    ...document,
    sets: document.sets.map((candidate) => candidate.id === command.setId
      ? { ...candidate, positions: { ...candidate.positions, [command.performerId]: command.dot } }
      : candidate),
  };
}

function makeState(document: FreeformDocument, revision: number): DocumentState {
  // This is the canonical-state boundary. Every successful initialization,
  // replacement, command application, undo, and redo exposes a fully covered
  // ordered set graph rather than a document that callers must validate later.
  // Preserve established semantic diagnostics before adding persistence's
  // complete structural-schema gate for external replacement documents.
  validateDocumentSetsAndTransitions(document);
  validateDocumentAnnotations(document);
  validateDocumentForCommandStore(document);
  return freeze({ document: clone(document), revision });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      freeze(nestedValue);
    }
  }
  return value;
}
