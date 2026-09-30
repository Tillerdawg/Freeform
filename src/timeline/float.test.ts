import { describe, expect, it } from 'vitest';
import type { FreeformDocument, Transition } from '../document/types';
import {
  calculatePairDistance,
  calculateStepSizeStatus,
  calculateTransitionStepStatuses,
  sampleFloatTransition,
} from './float';

function makeDocument(): FreeformDocument {
  return {
    format: 'freeform',
    formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Float tests', totalCounts: 16 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [
      { id: 'a', rankCode: 'A', displayName: 'A' },
      { id: 'b', rankCode: 'B', displayName: 'B' },
    ],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 7200, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 16, positions: { a: { x: 28800, y: 14400 }, b: { x: 7200, y: 0 } } },
    ],
    transitions: [],
    annotations: [],
  };
}

const transition: Transition = { id: 'float-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float' };

describe('float transition sampling', () => {
  it('returns hardcoded start endpoint values at t=0', () => {
    expect(sampleFloatTransition(makeDocument(), transition, 0).positions).toEqual({
      a: { x: 0, y: 0 }, b: { x: 7200, y: 0 },
    });
  });

  it('returns hardcoded end endpoint values at t=1', () => {
    expect(sampleFloatTransition(makeDocument(), transition, 16).positions).toEqual({
      a: { x: 28800, y: 14400 }, b: { x: 7200, y: 0 },
    });
  });

  it('linearly interpolates a hardcoded interior count', () => {
    const sample = sampleFloatTransition(makeDocument(), transition, 4);
    expect(sample.t).toBe(0.25);
    expect(sample.positions.a).toEqual({ x: 7200, y: 3600 });
  });
});

describe('step-size status bands', () => {
  it('reproduces the spec 10-yard 16-count example as 8.0 green', () => {
    const status = calculateStepSizeStatus({ x: 0, y: 0 }, { x: 28800, y: 0 }, 16, 'a');
    expect(status).toMatchObject({ stepSize: 8, band: 'green', label: '8.000 to 5' });
  });

  it('reproduces the spec 10-yard 12-count example as 6.0 yellow', () => {
    const status = calculateStepSizeStatus({ x: 0, y: 0 }, { x: 28800, y: 0 }, 12, 'a');
    expect(status).toMatchObject({ stepSize: 6, band: 'yellow', label: '6.000 to 5' });
  });

  it('classifies an unrounded 4.0-to-5 move as red', () => {
    expect(calculateStepSizeStatus({ x: 0, y: 0 }, { x: 28800, y: 0 }, 8).band).toBe('red');
  });

  it('marks stationary performers no-movement green without a step size', () => {
    const status = calculateStepSizeStatus({ x: 7200, y: 3600 }, { x: 7200, y: 3600 }, 1, 'b');
    expect(status).toEqual({ performerId: 'b', distanceFU: 0, distanceYards: 0, label: 'No movement', band: 'green' });
  });

  it('reports a status for every performer without blocking stationary dots', () => {
    expect(calculateTransitionStepStatuses(makeDocument(), transition)).toHaveLength(2);
  });
});

describe('pair-distance utility', () => {
  it('returns raw FU, raw decimal steps/yards, and quarter-step display without mutating dots', () => {
    const first = { x: 0, y: 0 };
    const second = { x: 5400, y: 7200 };
    const before = structuredClone({ first, second });

    const distance = calculatePairDistance(first, second);

    expect(distance.distanceFU).toBe(9000);
    expect(distance.distanceSteps).toBe(5);
    expect(distance.distanceYards).toBe(3.125);
    expect(distance.quarterSteps).toBe(5);
    expect(distance.display).toEqual({ steps: '5.000 steps', yards: '3.125 yards', quarterSteps: '5.00 steps (quarter-step)' });
    expect({ first, second }).toEqual(before);
  });
});
