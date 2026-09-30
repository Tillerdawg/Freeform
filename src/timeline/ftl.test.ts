import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { Dot, FreeformDocument, Transition } from '../document/types';
import {
  FtlValidationError,
  calculateFtlStepSizeStatus,
  deriveFtlOffsets,
  projectDotOntoPolyline,
  sampleFtlTransition,
  samplePolyline,
  validateFtlTransition,
} from './ftl';
import { createPlaybackController } from './playback';

function loadFixture(): FreeformDocument {
  return JSON.parse(readFileSync(new URL('../../docs/fixtures/freeform-1.0-example.freeform', import.meta.url), 'utf8')) as FreeformDocument;
}

function fixtureTransition(document = loadFixture()): Transition {
  return document.transitions.find(({ id }) => id === 'ftl-1')!;
}

function expectValidationCode(action: () => void, code: FtlValidationError['code']): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(FtlValidationError);
    expect((error as FtlValidationError).code).toBe(code);
  }
}

function distanceBetween(first: Dot, second: Dot): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

describe('FTL fixture replay', () => {
  it('loads the real worked fixture and reproduces hardcoded offsets, D_FU, 8.0-to-5, and E count-16 endpoint', () => {
    const document = loadFixture();
    const transition = fixtureTransition(document);
    const ftl = transition.ftl!;

    expect(ftl).toMatchObject({
      leaderId: 'e',
      followerIds: ['d', 'c', 'b', 'a'],
      offsetUnits: { e: 0, d: 7200, c: 14400, b: 21600, a: 28800 },
      distanceUnits: 28800,
    });
    expect(calculateFtlStepSizeStatus(transition)).toMatchObject({
      distanceFU: 28800,
      commonStepSize: 8,
      label: '8.000 to 5',
    });
    expect(sampleFtlTransition(document, transition, 16).positions.e).toEqual({ x: 115200, y: 51200 });
  });

  it('gives every fixture member exactly the same uninterrupted 28800-FU path traversal', () => {
    const document = loadFixture();
    const transition = fixtureTransition(document);
    const ftl = transition.ftl!;
    const samples = Array.from(
      { length: transition.counts + 1 },
      (_, count) => sampleFtlTransition(document, transition, count),
    );

    for (const performerId of ['e', 'd', 'c', 'b', 'a']) {
      const countToCountTraversal = samples.slice(1).map((sample, index) => (
        distanceBetween(samples[index]!.positions[performerId]!, sample.positions[performerId]!)
      ));

      // The fixture path is a single straight segment, so sampled geometric
      // traversal equals its arc-length traversal. Checking all 16 intervals
      // catches a member that stops or marks time partway through the move.
      expect(countToCountTraversal).toHaveLength(16);
      expect(countToCountTraversal).toEqual(Array(16).fill(1800));
      expect(countToCountTraversal.reduce((total, distance) => total + distance, 0)).toBe(ftl.distanceUnits);
    }
  });

  it('routes keyboard playback through FTL samples at every exact integer count', () => {
    const document = loadFixture();
    const playback = createPlaybackController(document, fixtureTransition(document));

    expect(playback.seek(8).sample.positions.e).toEqual({ x: 129600, y: 51200 });
    expect(playback.seek(16).sample.positions.e).toEqual({ x: 115200, y: 51200 });
  });
});

describe('FTL validation', () => {
  it('rejects a path that does not cover max offset plus common travel with INSUFFICIENT_FTL_PATH', () => {
    const document = loadFixture();
    const transition = fixtureTransition(document);
    const insufficient: Transition = {
      ...transition,
      ftl: { ...transition.ftl!, path: [{ x: 144000, y: 51200 }, { x: 115200, y: 51200 }] },
    };

    expectValidationCode(() => validateFtlTransition(document, insufficient), 'INSUFFICIENT_FTL_PATH');
  });

  it('rejects a path short by less than one FU instead of endpoint-clamping samples', () => {
    const document = loadFixture();
    const transition = fixtureTransition(document);
    const pathShortByHalfFu: Transition = {
      ...transition,
      ftl: {
        ...transition.ftl!,
        // Its diagonal length is less than the required 57600 FU by under
        // 1 FU, yet C(max(offset) + D) remains undefined and must reject.
        path: [{ x: 144000, y: 51200 }, { x: 86401, y: 51207 }],
      },
    };

    expectValidationCode(() => validateFtlTransition(document, pathShortByHalfFu), 'INSUFFICIENT_FTL_PATH');
    expectValidationCode(() => sampleFtlTransition(document, pathShortByHalfFu, 16), 'INSUFFICIENT_FTL_PATH');
    expectValidationCode(() => samplePolyline(pathShortByHalfFu.ftl!.path, 57600), 'INSUFFICIENT_FTL_PATH');
  });

  it('flags a mismatched expected end with FTL_END_MISMATCH and blocks FTL sampling/playback', () => {
    const document = loadFixture();
    const transition = fixtureTransition(document);
    const mismatch: Transition = {
      ...transition,
      ftl: {
        ...transition.ftl!,
        expectedEndPositions: { ...transition.ftl!.expectedEndPositions!, e: { x: 115202, y: 51200 } },
      },
    };
    const persistedMismatch = { ...document, transitions: [mismatch] };

    // Expected ends are validation targets, so an independently positioned end
    // can persist as a block state until it is fixed or converted to float.
    expect(() => createCommandStore(persistedMismatch)).not.toThrow();
    expectValidationCode(() => validateFtlTransition(persistedMismatch, mismatch), 'FTL_END_MISMATCH');
    expectValidationCode(() => sampleFtlTransition(persistedMismatch, mismatch, 0), 'FTL_END_MISMATCH');
  });

  it('reproduces the documented self-intersection tie-break vector exactly', () => {
    const path: readonly Dot[] = [
      { x: 0, y: 0 }, { x: 7200, y: 7200 }, { x: 0, y: 7200 }, { x: 7200, y: 0 },
    ];
    const crossing = { x: 3600, y: 3600 };
    const projections = projectDotOntoPolyline(path, crossing);
    expect(projections.map(({ offsetUnits }) => offsetUnits)).toEqual([
      expect.closeTo(3600 * Math.sqrt(2), 6),
      expect.closeTo(7200 + 10800 * Math.sqrt(2), 6),
    ]);
    const offsets = deriveFtlOffsets(path, ['leader', 'predecessor', 'follower'], {
      leader: crossing,
      predecessor: samplePolyline(path, 22000),
      follower: crossing,
    });

    expect(offsets.leader).toBeCloseTo(3600 * Math.sqrt(2), 6);
    expect(offsets.predecessor).toBeCloseTo(22000, 6);
    expect(offsets.follower).toBeCloseTo(7200 + 10800 * Math.sqrt(2), 6);
  });

  it('rejects authored offsets that decrease in follower order with FTL_OFFSET_ORDER', () => {
    const document = loadFixture();
    const transition = fixtureTransition(document);
    const outOfOrder: Transition = {
      ...transition,
      ftl: { ...transition.ftl!, offsetUnits: { ...transition.ftl!.offsetUnits, c: 1000 } },
    };

    expectValidationCode(() => validateFtlTransition(document, outOfOrder), 'FTL_OFFSET_ORDER');
  });

  it('rejects equal adjacent offsets unless those members share one start dot', () => {
    const document = loadFixture();
    const transition = fixtureTransition(document);
    const equalButSeparate: Transition = {
      ...transition,
      ftl: { ...transition.ftl!, offsetUnits: { ...transition.ftl!.offsetUnits, d: 0 } },
    };

    expectValidationCode(() => validateFtlTransition(document, equalButSeparate), 'FTL_OFFSET_ORDER');
  });
});
