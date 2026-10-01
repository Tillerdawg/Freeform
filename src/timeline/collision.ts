import { validateFloatTransition } from '../document/sets';
import type { CollisionOverride, Dot, FreeformDocument, Identifier, Transition } from '../document/types';
import { validateFtlTransition } from './ftl';

export const COLLISION_SAMPLE_MAX_TRAVEL_FU = 720;
export const MAX_COLLISION_SAMPLES_PER_TRANSITION = 100_000;

export type CollisionAnalysisErrorCode =
  | 'COLLISION_ANALYSIS_FTL_INVALID'
  | 'COLLISION_ANALYSIS_SAMPLE_LIMIT';

/** A hard analysis failure is never represented as an empty warning list. */
export class CollisionAnalysisError extends Error {
  readonly code: CollisionAnalysisErrorCode;

  constructor(code: CollisionAnalysisErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'CollisionAnalysisError';
    this.code = code;
  }
}

export interface CollisionWarning {
  readonly transitionId: Identifier;
  /** Canonical lexical performer-ID order; each unordered pair appears once. */
  readonly performerIds: readonly [Identifier, Identifier];
  /** Transition-relative fractional count where the closest sampled approach occurred. */
  readonly sampleCount: number;
  readonly t: number;
  readonly closestDistanceFU: number;
  readonly thresholdUnits: number;
  readonly warningSignature: string;
  readonly override?: CollisionOverride;
  readonly overridden: boolean;
}

export interface CollisionAnalysis {
  readonly transitionId: Identifier;
  readonly sampleTimes: readonly number[];
  readonly warnings: readonly CollisionWarning[];
}

/**
 * Samples the required quarter-count grid, then adds every FTL path-corner time
 * and deterministic equal subdivisions. The latter use path arc length for FTL,
 * not endpoint distance, so a sharp bend cannot appear stationary to analysis.
 */
export function analyzeTransitionCollisions(
  document: FreeformDocument,
  transition: Transition,
): CollisionAnalysis {
  validateForCollisionAnalysis(document, transition);
  const sampleTimes = collisionSampleTimes(document, transition);
  const positions = sampleTimes.map((t) => samplePositions(document, transition, t));
  const thresholdUnits = document.settings.collisionThresholdUnits;
  const performerIds = document.performers.map(({ id }) => id).sort();
  const warnings: CollisionWarning[] = [];

  for (let firstIndex = 0; firstIndex < performerIds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < performerIds.length; secondIndex += 1) {
      const performerIdsForWarning = [performerIds[firstIndex]!, performerIds[secondIndex]!] as const;
      let closestDistanceFU = Number.POSITIVE_INFINITY;
      let closestTime = 0;
      for (let index = 0; index < sampleTimes.length; index += 1) {
        const first = positions[index]![performerIdsForWarning[0]]!;
        const second = positions[index]![performerIdsForWarning[1]]!;
        const distanceFU = Math.hypot(second.x - first.x, second.y - first.y);
        if (distanceFU < closestDistanceFU) {
          closestDistanceFU = distanceFU;
          closestTime = sampleTimes[index]!;
        }
      }
      if (closestDistanceFU <= thresholdUnits) {
        const warningSignature = collisionWarningSignature(document, transition, performerIdsForWarning);
        const override = matchingOverride(transition, performerIdsForWarning, warningSignature);
        warnings.push({
          transitionId: transition.id,
          performerIds: performerIdsForWarning,
          sampleCount: closestTime * transition.counts,
          t: closestTime,
          closestDistanceFU,
          thresholdUnits,
          warningSignature,
          override,
          overridden: override !== undefined,
        });
      }
    }
  }
  return { transitionId: transition.id, sampleTimes, warnings };
}

export function collisionSampleTimes(
  document: FreeformDocument,
  transition: Transition,
): readonly number[] {
  validateForCollisionAnalysis(document, transition);
  const baseSamples = 4 * transition.counts;
  if (baseSamples + 1 > MAX_COLLISION_SAMPLES_PER_TRANSITION) throwSampleLimit(baseSamples + 1);
  const anchors = transition.mode === 'ftl'
    ? uniqueSortedTimes([...quarterCountTimes(baseSamples), ...ftlCornerTimes(transition)])
    : quarterCountTimes(baseSamples);
  const rates = motionRates(document, transition);
  const result: number[] = [anchors[0]!];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index]!;
    const end = anchors[index + 1]!;
    const maximumTravel = Math.max(...rates.map((rate) => rate * (end - start)));
    const subdivisions = Math.max(1, Math.ceil(maximumTravel / COLLISION_SAMPLE_MAX_TRAVEL_FU));
    if (result.length + subdivisions > MAX_COLLISION_SAMPLES_PER_TRANSITION) {
      throwSampleLimit(result.length + subdivisions);
    }
    for (let subdivision = 1; subdivision <= subdivisions; subdivision += 1) {
      result.push(start + (end - start) * subdivision / subdivisions);
    }
  }
  return result;
}

/**
 * The signature intentionally excludes performer-array order and display labels.
 * It contains only pair identity, motion inputs, and threshold, then is hashed so
 * persisted audit records remain bounded by the existing schema contract.
 */
export function collisionWarningSignature(
  document: FreeformDocument,
  transition: Transition,
  pair: readonly [Identifier, Identifier],
): string {
  const performerIds = canonicalPair(pair);
  const from = document.sets.find(({ id }) => id === transition.fromSetId)!;
  const to = document.sets.find(({ id }) => id === transition.toSetId)!;
  const motion = transition.mode === 'float'
    ? {
      mode: 'float',
      starts: performerIds.map((id) => from.positions[id]),
      ends: performerIds.map((id) => to.positions[id]),
    }
    : {
      mode: 'ftl',
      path: transition.ftl!.path,
      distanceUnits: transition.ftl!.distanceUnits,
      offsets: performerIds.map((id) => transition.ftl!.offsetUnits[id]),
    };
  const payload = JSON.stringify({
    version: 'collision-warning-v1',
    transitionId: transition.id,
    counts: transition.counts,
    thresholdUnits: document.settings.collisionThresholdUnits,
    performerIds,
    motion,
  });
  return `v1-sha256-${sha256Hex(payload)}`;
}

export function canonicalPair(pair: readonly [Identifier, Identifier]): readonly [Identifier, Identifier] {
  return pair[0] < pair[1] ? [pair[0], pair[1]] : [pair[1], pair[0]];
}

function validateForCollisionAnalysis(document: FreeformDocument, transition: Transition): void {
  try {
    if (transition.mode === 'float') validateFloatTransition(document, transition);
    else validateFtlTransition(document, transition);
  } catch (error) {
    if (transition.mode === 'ftl') {
      const detail = error instanceof Error ? error.message : 'Unknown FTL validation failure.';
      throw new CollisionAnalysisError('COLLISION_ANALYSIS_FTL_INVALID', `Cannot analyze ${transition.id} until its FTL path is repaired: ${detail}`);
    }
    throw error;
  }
  const threshold = document.settings.collisionThresholdUnits;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 28800) {
    throw new RangeError('Collision threshold must be an integer from 1 through 28800 FU.');
  }
}

function quarterCountTimes(baseSamples: number): readonly number[] {
  return Array.from({ length: baseSamples + 1 }, (_, index) => index / baseSamples);
}

function ftlCornerTimes(transition: Transition): readonly number[] {
  const ftl = transition.ftl!;
  const cornerOffsets: number[] = [];
  let offset = 0;
  for (let index = 0; index < ftl.path.length - 1; index += 1) {
    const start = ftl.path[index]!;
    const end = ftl.path[index + 1]!;
    offset += Math.hypot(end.x - start.x, end.y - start.y);
    if (index < ftl.path.length - 2) cornerOffsets.push(offset);
  }
  return Object.values(ftl.offsetUnits).flatMap((memberOffset) => cornerOffsets
    .map((cornerOffset) => (cornerOffset - memberOffset) / ftl.distanceUnits)
    .filter((time) => time > 0 && time < 1));
}

function uniqueSortedTimes(values: readonly number[]): readonly number[] {
  return values.slice().sort((left, right) => left - right).reduce<number[]>((unique, value) => (
    unique.length === 0 || Math.abs(value - unique.at(-1)!) > 1e-12
      ? [...unique, value]
      : unique
  ), []);
}

function motionRates(document: FreeformDocument, transition: Transition): readonly number[] {
  if (transition.mode === 'ftl') return document.performers.map(() => transition.ftl!.distanceUnits);
  const from = document.sets.find(({ id }) => id === transition.fromSetId)!;
  const to = document.sets.find(({ id }) => id === transition.toSetId)!;
  return document.performers.map(({ id }) => {
    const start = from.positions[id]!;
    const end = to.positions[id]!;
    return Math.hypot(end.x - start.x, end.y - start.y);
  });
}

function samplePositions(document: FreeformDocument, transition: Transition, t: number): Readonly<Record<Identifier, Dot>> {
  if (transition.mode === 'float') {
    const from = document.sets.find(({ id }) => id === transition.fromSetId)!;
    const to = document.sets.find(({ id }) => id === transition.toSetId)!;
    return Object.fromEntries(document.performers.map(({ id }) => {
      const start = from.positions[id]!;
      const end = to.positions[id]!;
      return [id, { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) }];
    }));
  }
  return Object.fromEntries(document.performers.map(({ id }) => [
    id,
    samplePolylineAtOffset(transition.ftl!.path, transition.ftl!.offsetUnits[id]! + t * transition.ftl!.distanceUnits),
  ]));
}

function samplePolylineAtOffset(path: readonly Dot[], requestedOffset: number): Dot {
  let offset = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index]!;
    const end = path[index + 1]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (requestedOffset <= offset + length + 1e-9) {
      const ratio = (requestedOffset - offset) / length;
      return { x: start.x + ratio * (end.x - start.x), y: start.y + ratio * (end.y - start.y) };
    }
    offset += length;
  }
  throw new CollisionAnalysisError('COLLISION_ANALYSIS_FTL_INVALID', 'Validated FTL path ended before a collision sample could be generated.');
}

function matchingOverride(
  transition: Transition,
  pair: readonly [Identifier, Identifier],
  warningSignature: string,
): CollisionOverride | undefined {
  return transition.collisionOverrides?.find((override) => (
    override.performerIds[0] === pair[0]
    && override.performerIds[1] === pair[1]
    && override.warningSignature === warningSignature
  ));
}

function throwSampleLimit(requested: number): never {
  throw new CollisionAnalysisError(
    'COLLISION_ANALYSIS_SAMPLE_LIMIT',
    `Analysis needs ${requested} samples, exceeding the deterministic ${MAX_COLLISION_SAMPLES_PER_TRANSITION}-sample limit. Reduce counts/path travel or split the transition; no warning result was produced.`,
  );
}

// Synchronous SHA-256 avoids WebCrypto's asynchronous API in the command/UI path.
function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const lengthView = new DataView(padded.buffer);
  lengthView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  lengthView.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) words[index] = lengthView.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      const s0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const s1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporaryOne = (h + s1 + choice + constants[index]! + words[index]!) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporaryTwo = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temporaryOne) >>> 0;
      d = c; c = b; b = a; a = (temporaryOne + temporaryTwo) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0; hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0; hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0; hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0; hash[7] = (hash[7]! + h) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}
