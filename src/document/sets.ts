import { assertValidDot } from '../geometry/nfhs';
import type { FreeformDocument, Identifier, SetPage, Transition } from './types';

/** Validates the semantic set and float-topology invariants required for authoring. */
export function validateSetCoverage(
  performers: readonly { readonly id: Identifier }[],
  set: SetPage,
): void {
  const performerIds = new Set(performers.map(({ id }) => id));
  const positionIds = Object.keys(set.positions);

  if (positionIds.length !== performerIds.size) {
    throw new Error(`Set ${set.id} must contain exactly one dot for each active performer.`);
  }
  for (const performerId of positionIds) {
    if (!performerIds.has(performerId)) {
      throw new Error(`Set ${set.id} contains an unknown performer dot: ${performerId}`);
    }
    assertValidDot(set.positions[performerId]!);
  }
  for (const performerId of performerIds) {
    if (!(performerId in set.positions)) {
      throw new Error(`Set ${set.id} is missing a dot for performer: ${performerId}`);
    }
  }
}

export function validateOrderedSets(document: Pick<FreeformDocument, 'performers' | 'sets'>): void {
  const ids = new Set<string>();
  let previousStartCount = -1;
  for (const set of document.sets) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(set.id)) {
      throw new Error(`Invalid set ID: ${set.id}`);
    }
    if (set.name.trim().length === 0) throw new Error('Set name is required.');
    if (!Number.isInteger(set.startCount) || set.startCount < 0) {
      throw new Error(`Set ${set.id} start count must be a nonnegative integer.`);
    }
    if (ids.has(set.id)) throw new Error(`Set ID already exists: ${set.id}`);
    if (set.startCount <= previousStartCount) {
      throw new Error('Set start counts must be strictly ascending.');
    }
    ids.add(set.id);
    previousStartCount = set.startCount;
    validateSetCoverage(document.performers, set);
  }
}

export function validateFloatTransition(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(transition.id)) {
    throw new Error(`Invalid transition ID: ${transition.id}`);
  }
  if (!Number.isInteger(transition.counts) || transition.counts <= 0) {
    throw new Error('Transition counts must be a positive integer.');
  }
  if (transition.mode !== 'float') {
    throw new Error('M3 only supports float transitions.');
  }
  const fromIndex = document.sets.findIndex(({ id }) => id === transition.fromSetId);
  const toIndex = document.sets.findIndex(({ id }) => id === transition.toSetId);
  if (fromIndex < 0 || toIndex < 0) throw new Error('Transition references an unknown set.');
  if (toIndex !== fromIndex + 1) throw new Error('Transitions must join adjacent ordered sets.');

  const from = document.sets[fromIndex]!;
  const to = document.sets[toIndex]!;
  if (to.startCount - from.startCount !== transition.counts) {
    throw new Error('Transition counts must equal the difference between adjacent set start counts.');
  }
  validateSetCoverage(document.performers, from);
  validateSetCoverage(document.performers, to);
}

export function validateDocumentSetsAndTransitions(document: FreeformDocument): void {
  validateOrderedSets(document);
  const transitionIds = new Set<string>();
  for (const transition of document.transitions) {
    if (transitionIds.has(transition.id)) throw new Error(`Transition ID already exists: ${transition.id}`);
    transitionIds.add(transition.id);
    validateFloatTransition(document, transition);
  }
}
