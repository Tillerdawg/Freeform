import { assertValidDot } from '../geometry/nfhs';
import { validateFtlTransitionForDocument } from '../timeline/ftl';
import type { CollisionOverride, FreeformDocument, Identifier, SetPage, Transition } from './types';

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
  validateTransitionTopology(document, transition);
  if (transition.mode !== 'float') {
    throw new Error('Expected a float transition.');
  }
}

/** Validates IDs, adjacency, count timing, and complete endpoint coverage for either motion mode. */
export function validateTransitionTopology(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(transition.id)) {
    throw new Error(`Invalid transition ID: ${transition.id}`);
  }
  if (!Number.isInteger(transition.counts) || transition.counts <= 0) {
    throw new Error('Transition counts must be a positive integer.');
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

export function validateTransition(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
): void {
  if (transition.mode === 'float') validateFloatTransition(document, transition);
  else validateFtlTransitionForDocument(document, transition);
}

export function validateDocumentSetsAndTransitions(document: FreeformDocument): void {
  validateCollisionThreshold(document.settings.collisionThresholdUnits);
  validateOrderedSets(document);
  const transitionIds = new Set<string>();
  for (const transition of document.transitions) {
    if (transitionIds.has(transition.id)) throw new Error(`Transition ID already exists: ${transition.id}`);
    transitionIds.add(transition.id);
    validateTransition(document, transition);
    validateCollisionOverrides(document, transition);
  }
}

export function validateCollisionThreshold(collisionThresholdUnits: number): void {
  if (!Number.isInteger(collisionThresholdUnits) || collisionThresholdUnits < 1 || collisionThresholdUnits > 28800) {
    throw new Error('Collision threshold must be an integer from 1 through 28800 FU.');
  }
}

export function validateCollisionOverride(
  performers: readonly { readonly id: Identifier }[],
  override: CollisionOverride,
): void {
  const [first, second] = override.performerIds;
  if (!first || !second || first >= second) {
    throw new Error('Collision override performer IDs must be two distinct IDs in canonical lexical order.');
  }
  const performerIds = new Set(performers.map(({ id }) => id));
  if (!performerIds.has(first) || !performerIds.has(second)) {
    throw new Error('Collision override references an unknown performer.');
  }
  if (!/^v1-sha256-[a-f0-9]{64}$/.test(override.warningSignature)) {
    throw new Error('Collision override warning signature must be a v1 SHA-256 signature.');
  }
  if (override.reason.trim().length === 0 || override.reason.length > 1000) {
    throw new Error('Collision override reason must contain 1 through 1000 characters.');
  }
  if (override.authorLabel.trim().length === 0 || override.authorLabel.length > 120) {
    throw new Error('Collision override local actor label must contain 1 through 120 characters.');
  }
  if (!isValidIsoTimestamp(override.overriddenAt)) {
    throw new Error('Collision override timestamp must be a valid ISO 8601 date-time.');
  }
}

function validateCollisionOverrides(document: FreeformDocument, transition: Transition): void {
  const seen = new Set<string>();
  for (const override of transition.collisionOverrides ?? []) {
    validateCollisionOverride(document.performers, override);
    const key = `${override.performerIds[0]}\u0000${override.performerIds[1]}\u0000${override.warningSignature}`;
    if (seen.has(key)) throw new Error(`Transition ${transition.id} contains a duplicate collision override.`);
    seen.add(key);
  }
}

function isValidIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}
