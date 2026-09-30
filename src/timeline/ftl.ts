import { FIVE_YARDS_FU, assertValidDot } from '../geometry/nfhs';
import { validateTransitionTopology } from '../document/sets';
import type { Dot, FreeformDocument, FtlDefinition, Identifier, Transition } from '../document/types';

/** Geometric equivalence threshold mandated for start/end dot comparisons. */
const POSITION_TOLERANCE_FU = 1;
/**
 * Arc-length domain checks have no semantic one-FU grace period. This only
 * absorbs IEEE-754 rounding at a segment boundary; a path that is genuinely
 * short by any positive, meaningful amount cannot be sampled or validated.
 */
const ARC_LENGTH_EPSILON_FU = 1e-9;

export type FtlValidationCode =
  | 'FTL_END_MISMATCH'
  | 'FTL_MISSING_MEMBER'
  | 'FTL_OFFSET_ORDER'
  | 'INSUFFICIENT_FTL_PATH'
  | 'FTL_START_MISMATCH'
  | 'FTL_MEMBER_COVERAGE';

export class FtlValidationError extends Error {
  readonly code: FtlValidationCode;

  constructor(code: FtlValidationCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'FtlValidationError';
    this.code = code;
  }
}

export interface PolylineProjection {
  readonly offsetUnits: number;
  readonly distanceFU: number;
}

export interface FtlSample {
  readonly transitionId: Identifier;
  readonly count: number;
  readonly counts: number;
  readonly t: number;
  readonly positions: Readonly<Record<Identifier, Dot>>;
}

export interface FtlStepSizeStatus {
  readonly distanceFU: number;
  readonly distanceYards: number;
  readonly commonStepSize: number;
  readonly label: string;
}

/**
 * Returns the nearest point on each segment. Candidates within one FU of the
 * nearest distance are retained so self-intersection ties can be resolved by
 * formation order rather than incidental segment-click order.
 */
export function projectDotOntoPolyline(path: readonly Dot[], dot: Dot): readonly PolylineProjection[] {
  const segments = makeSegments(path);
  const candidates = segments.map((segment) => projectOntoSegment(segment, dot));
  const nearestDistance = Math.min(...candidates.map((candidate) => candidate.distanceFU));
  const tied = candidates.filter((candidate) => candidate.distanceFU <= nearestDistance + POSITION_TOLERANCE_FU);
  return deduplicateProjections(tied);
}

/**
 * Derives offsets in the supplied formation order. The first member is the
 * leader and therefore chooses the smallest tied arc length; later members
 * choose the tied candidate nearest the prior member's assigned offset.
 */
export function deriveFtlOffsets(
  path: readonly Dot[],
  membersInFormationOrder: readonly Identifier[],
  startPositions: Readonly<Record<Identifier, Dot>>,
): Readonly<Record<Identifier, number>> {
  if (membersInFormationOrder.length === 0) throw new Error('An FTL formation needs a leader.');
  const offsets: Record<Identifier, number> = {};
  let previousOffset: number | undefined;
  for (const memberId of membersInFormationOrder) {
    const start = startPositions[memberId];
    if (!start) throw new Error(`FTL formation member has no start dot: ${memberId}`);
    const candidates = projectDotOntoPolyline(path, start);
    const selected = candidates.reduce((best, candidate) => {
      if (!best) return candidate;
      if (previousOffset === undefined) {
        return candidate.offsetUnits < best.offsetUnits ? candidate : best;
      }
      const candidateDistance = Math.abs(candidate.offsetUnits - previousOffset);
      const bestDistance = Math.abs(best.offsetUnits - previousOffset);
      return candidateDistance < bestDistance
        || (candidateDistance === bestDistance && candidate.offsetUnits < best.offsetUnits)
        ? candidate
        : best;
    });
    offsets[memberId] = selected!.offsetUnits;
    previousOffset = selected!.offsetUnits;
  }
  return offsets;
}

export function samplePolyline(path: readonly Dot[], offsetUnits: number): Dot {
  const segments = makeSegments(path);
  if (
    !Number.isFinite(offsetUnits)
    || offsetUnits < -ARC_LENGTH_EPSILON_FU
    || offsetUnits > segments.at(-1)!.endOffset + ARC_LENGTH_EPSILON_FU
  ) {
    throw new FtlValidationError('INSUFFICIENT_FTL_PATH', `Path does not define offset ${offsetUnits}.`);
  }
  const clampedOffset = Math.max(0, Math.min(segments.at(-1)!.endOffset, offsetUnits));
  const segment = segments.find((candidate) => clampedOffset <= candidate.endOffset + ARC_LENGTH_EPSILON_FU)!;
  const localOffset = Math.max(0, Math.min(segment.length, clampedOffset - segment.startOffset));
  const ratio = localOffset / segment.length;
  return {
    x: segment.start.x + ratio * (segment.end.x - segment.start.x),
    y: segment.start.y + ratio * (segment.end.y - segment.start.y),
  };
}

export function validateFtlTransition(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
): void {
  validateFtlCore(document, transition);
  validateFtlExpectedEnds(transition);
}

/**
 * Validates canonical FTL state while preserving a stale member reference as a
 * repairable playback block after performer removal.
 */
export function validateFtlTransitionForDocument(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
): void {
  validateFtlCore(document, transition, { allowMissingMembers: true });
}

export function sampleFtlTransition(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
  count: number,
): FtlSample {
  validateFtlTransition(document, transition);
  if (!Number.isInteger(count) || count < 0 || count > transition.counts) {
    throw new RangeError(`Count must be an integer from 0 through ${transition.counts}.`);
  }
  const ftl = transition.ftl!;
  const t = count / transition.counts;
  const positions = Object.fromEntries(memberIds(ftl).map((performerId) => [
    performerId,
    samplePolyline(ftl.path, ftl.offsetUnits[performerId]! + t * ftl.distanceUnits),
  ]));
  return { transitionId: transition.id, count, counts: transition.counts, t, positions };
}

export function calculateFtlStepSizeStatus(transition: Transition): FtlStepSizeStatus {
  if (transition.mode !== 'ftl' || !transition.ftl) throw new Error('Transition is not an FTL transition.');
  const { distanceUnits } = transition.ftl;
  const distanceYards = distanceUnits / 2880;
  const commonStepSize = transition.counts * FIVE_YARDS_FU / distanceUnits;
  return {
    distanceFU: distanceUnits,
    distanceYards,
    commonStepSize,
    label: `${commonStepSize.toFixed(3)} to 5`,
  };
}

export function memberIds(ftl: FtlDefinition): readonly Identifier[] {
  return [ftl.leaderId, ...ftl.followerIds];
}

function validateFtlCore(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
  options: { readonly allowMissingMembers?: boolean } = {},
): void {
  validateTransitionTopology(document, transition);
  if (transition.mode !== 'ftl' || !transition.ftl) throw new Error('FTL transitions require an FTL definition.');
  const ftl = transition.ftl;
  if (!Number.isInteger(ftl.distanceUnits) || ftl.distanceUnits <= 0) {
    throw new Error('FTL distanceUnits must be a positive integer.');
  }
  const members = memberIds(ftl);
  if (new Set(members).size !== members.length) throw new Error('FTL leader and followers must be unique.');
  const performerIds = document.performers.map(({ id }) => id);
  if (performerIds.some((id) => !members.includes(id))) {
    throw new FtlValidationError('FTL_MEMBER_COVERAGE', 'FTL formation must include every active performer exactly once.');
  }
  const missingMembers = members.filter((id) => !performerIds.includes(id));
  if (missingMembers.length > 0) {
    if (options.allowMissingMembers) return;
    throw new FtlValidationError('FTL_MISSING_MEMBER', `FTL formation references removed or unknown performer(s): ${missingMembers.join(', ')}.`);
  }
  const offsetIds = Object.keys(ftl.offsetUnits);
  if (offsetIds.length !== members.length || offsetIds.some((id) => !members.includes(id))) {
    throw new FtlValidationError('FTL_MEMBER_COVERAGE', 'FTL offsets must name every formation member exactly once.');
  }
  if (ftl.offsetUnits[ftl.leaderId] !== 0) throw new Error('FTL leader offset must be zero.');
  const from = document.sets.find(({ id }) => id === transition.fromSetId)!;
  let previousOffset = 0;
  let previousMemberId: Identifier | undefined;
  for (const memberId of members) {
    const offset = ftl.offsetUnits[memberId];
    if (!Number.isFinite(offset) || offset < 0) throw new Error(`FTL offset must be nonnegative for ${memberId}.`);
    if (offset < previousOffset) {
      throw new FtlValidationError('FTL_OFFSET_ORDER', 'FTL offsets must be non-decreasing in authored formation order.');
    }
    if (previousMemberId && offset === previousOffset && !sameDot(from.positions[memberId]!, from.positions[previousMemberId]!)) {
      throw new FtlValidationError('FTL_OFFSET_ORDER', 'Equal FTL offsets are permitted only for performers sharing one start dot.');
    }
    previousOffset = offset;
    previousMemberId = memberId;
  }

  const pathLength = makeSegments(ftl.path).at(-1)!.endOffset;
  const maxOffset = Math.max(...members.map((id) => ftl.offsetUnits[id]!));
  if (pathLength + ARC_LENGTH_EPSILON_FU < maxOffset + ftl.distanceUnits) {
    throw new FtlValidationError('INSUFFICIENT_FTL_PATH', 'Path must cover every formation offset plus the common travel distance.');
  }
  for (const memberId of members) {
    const start = from.positions[memberId]!;
    const derivedStart = samplePolyline(ftl.path, ftl.offsetUnits[memberId]!);
    if (distanceBetween(start, derivedStart) > POSITION_TOLERANCE_FU) {
      throw new FtlValidationError('FTL_START_MISMATCH', `Start dot for ${memberId} does not match its FTL path offset within 1 FU.`);
    }
  }
}

function validateFtlExpectedEnds(transition: Transition): void {
  const ftl = transition.ftl!;
  if (!ftl.expectedEndPositions) return;
  const members = memberIds(ftl);
  const expectedIds = Object.keys(ftl.expectedEndPositions);
  if (expectedIds.length !== members.length || expectedIds.some((id) => !members.includes(id))) {
    throw new FtlValidationError('FTL_END_MISMATCH', 'Expected FTL end positions must name every formation member exactly once.');
  }
  for (const memberId of members) {
    const expected = ftl.expectedEndPositions[memberId]!;
    const derived = samplePolyline(ftl.path, ftl.offsetUnits[memberId]! + ftl.distanceUnits);
    if (distanceBetween(expected, derived) > POSITION_TOLERANCE_FU) {
      throw new FtlValidationError('FTL_END_MISMATCH', `Expected end dot for ${memberId} does not match the derived FTL end within 1 FU.`);
    }
  }
}

interface Segment {
  readonly start: Dot;
  readonly end: Dot;
  readonly dx: number;
  readonly dy: number;
  readonly length: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

function makeSegments(path: readonly Dot[]): readonly Segment[] {
  if (path.length < 2) throw new Error('FTL path needs at least two points.');
  path.forEach(assertValidDot);
  let offset = 0;
  return path.slice(0, -1).map((start, index) => {
    const end = path[index + 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) throw new Error('FTL path cannot contain repeated consecutive points.');
    const segment = { start, end, dx, dy, length, startOffset: offset, endOffset: offset + length };
    offset += length;
    return segment;
  });
}

function projectOntoSegment(segment: Segment, dot: Dot): PolylineProjection {
  const unboundedRatio = ((dot.x - segment.start.x) * segment.dx + (dot.y - segment.start.y) * segment.dy) / (segment.length * segment.length);
  const ratio = Math.max(0, Math.min(1, unboundedRatio));
  const projection = { x: segment.start.x + ratio * segment.dx, y: segment.start.y + ratio * segment.dy };
  return { offsetUnits: segment.startOffset + ratio * segment.length, distanceFU: distanceBetween(dot, projection) };
}

function deduplicateProjections(projections: readonly PolylineProjection[]): readonly PolylineProjection[] {
  return projections.reduce<PolylineProjection[]>((unique, candidate) => (
    unique.some((existing) => Math.abs(existing.offsetUnits - candidate.offsetUnits) <= Number.EPSILON)
      ? unique
      : [...unique, candidate]
  ), []);
}

function distanceBetween(first: Dot, second: Dot): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function sameDot(first: Dot, second: Dot): boolean {
  return first.x === second.x && first.y === second.y;
}
