import { describe, expect, it } from 'vitest';
import { inspectCoordinate } from './nfhs';
import {
  buildCoordinate,
  parseQuarterSteps,
  snapToQuarterStepGrid,
  type CoordinateInput,
} from './coordinate-builder';

interface GoldenVector {
  readonly name: string;
  readonly input: CoordinateInput;
  readonly dot: { readonly x: number; readonly y: number };
  readonly notation: string;
}

const exactGoldenVectors: readonly GoldenVector[] = [
  {
    name: 'the §3.2 worked splitting/front-hash example',
    input: {
      horizontal: { kind: 'splitting', lowerLine: 40, higherLine: 45 },
      vertical: { kind: 'offset', landmark: 'Front Hash', quarterSteps: 16, direction: 'In Front Of' },
    },
    dot: { x: 122400, y: 44000 },
    notation: 'Splitting Side 1 40 & Side 1 45, 4 Steps In Front Of Front Hash',
  },
  {
    name: 'an exact five-yard line and front hash',
    input: {
      horizontal: { kind: 'line', line: 40 },
      vertical: { kind: 'landmark', landmark: 'Front Hash' },
    },
    dot: { x: 115200, y: 51200 },
    notation: 'On Side 1 40, On Front Hash',
  },
  {
    name: 'an exact splitting midpoint and front sideline',
    input: {
      horizontal: { kind: 'splitting', lowerLine: 0, higherLine: 5 },
      vertical: { kind: 'landmark', landmark: 'Front Sideline' },
    },
    dot: { x: 7200, y: 0 },
    notation: 'Splitting Side 1 0 & Side 1 5, On Front Sideline',
  },
  {
    name: 'an exact 50 and front hash',
    input: {
      horizontal: { kind: 'line', line: 50 },
      vertical: { kind: 'landmark', landmark: 'Front Hash' },
    },
    dot: { x: 144000, y: 51200 },
    notation: 'On 50, On Front Hash',
  },
  {
    name: 'an exact 50 and back hash',
    input: {
      horizontal: { kind: 'line', line: 50 },
      vertical: { kind: 'landmark', landmark: 'Back Hash' },
    },
    dot: { x: 144000, y: 102400 },
    notation: 'On 50, On Back Hash',
  },
  {
    name: 'an Inside offset',
    input: {
      horizontal: { kind: 'offset', line: 40, quarterSteps: 4, direction: 'Inside' },
      vertical: { kind: 'landmark', landmark: 'Front Hash' },
    },
    dot: { x: 117000, y: 51200 },
    notation: '1 Step Inside Side 1 40, On Front Hash',
  },
  {
    name: 'an Outside offset',
    input: {
      horizontal: { kind: 'offset', line: 40, quarterSteps: 4, direction: 'Outside' },
      vertical: { kind: 'landmark', landmark: 'Front Hash' },
    },
    dot: { x: 113400, y: 51200 },
    notation: '1 Step Outside Side 1 40, On Front Hash',
  },
  {
    name: 'an In Front Of offset',
    input: {
      horizontal: { kind: 'line', line: 50 },
      vertical: { kind: 'offset', landmark: 'Front Hash', quarterSteps: 4, direction: 'In Front Of' },
    },
    dot: { x: 144000, y: 49400 },
    notation: 'On 50, 1 Step In Front Of Front Hash',
  },
  {
    name: 'a Behind offset',
    input: {
      horizontal: { kind: 'line', line: 50 },
      vertical: { kind: 'offset', landmark: 'Front Hash', quarterSteps: 4, direction: 'Behind' },
    },
    dot: { x: 144000, y: 53000 },
    notation: 'On 50, 1 Step Behind Front Hash',
  },
];

describe('derived coordinate builder exact round trips', () => {
  it.each(exactGoldenVectors)('builds and inspects $name without changing a FU', ({ input, dot, notation }) => {
    const built = buildCoordinate(input);

    expect(built).toEqual(dot);
    expect(inspectCoordinate(built).notation).toBe(notation);
  });

  it('rejects structurally invalid, ambiguous, and out-of-field notation', () => {
    expect(() => buildCoordinate({
      horizontal: { kind: 'splitting', lowerLine: 40, higherLine: 50 },
      vertical: { kind: 'landmark', landmark: 'Front Hash' },
    })).toThrow('adjacent');
    expect(() => buildCoordinate({
      horizontal: { kind: 'offset', line: 50, quarterSteps: 1, direction: 'Outside' },
      vertical: { kind: 'landmark', landmark: 'Front Hash' },
    })).toThrow('ambiguous');
    expect(() => buildCoordinate({
      horizontal: { kind: 'offset', line: 40, quarterSteps: 16, direction: 'Inside' },
      vertical: { kind: 'landmark', landmark: 'Front Hash' },
    })).toThrow('splitting');
    expect(() => buildCoordinate({
      horizontal: { kind: 'line', line: 40 },
      vertical: { kind: 'offset', landmark: 'Front Sideline', quarterSteps: 57, direction: 'Behind' },
    })).toThrow('nearer landmark');
    expect(() => buildCoordinate({
      horizontal: { kind: 'offset', line: 0, quarterSteps: 1, direction: 'Outside' },
      vertical: { kind: 'landmark', landmark: 'Front Hash' },
    })).toThrow(/integer FU within/);
  });

  it('parses only exact quarter-step display values without floating point conversion', () => {
    expect(parseQuarterSteps('0.25')).toBe(1);
    expect(parseQuarterSteps('14.5')).toBe(58);
    expect(parseQuarterSteps('4')).toBe(16);
    expect(() => parseQuarterSteps('0.1')).toThrow('multiple of 0.25');
    expect(() => parseQuarterSteps('1.250')).toThrow('multiple of 0.25');
  });
});

describe('quarter-step snapping', () => {
  it.each([
    [{ x: 115350, y: 51225 }, { x: 115200, y: 51200 }],
    [{ x: 117225, y: 49425 }, { x: 117450, y: 49400 }],
    [{ x: 122175, y: 44010 }, { x: 122400, y: 44000 }],
    [{ x: 287900, y: 153425 }, { x: 288000, y: 153600 }],
    [{ x: 719, y: 25600 }, { x: 900, y: 25200 }],
    [{ x: 225, y: 51425 }, { x: 450, y: 51650 }],
  ] as const)('snaps %# %o to %o', (dot, expected) => {
    expect(snapToQuarterStepGrid(dot)).toEqual(expected);
  });

  it.each([
    [25599, 25200, { kind: 'offset', landmark: 'Front Sideline', quarterSteps: 56, direction: 'Behind' }, 'On 50, 14 Steps Behind Front Sideline'],
    [25600, 25200, { kind: 'offset', landmark: 'Front Sideline', quarterSteps: 56, direction: 'Behind' }, 'On 50, 14 Steps Behind Front Sideline'],
    [25601, 26000, { kind: 'offset', landmark: 'Front Hash', quarterSteps: 56, direction: 'In Front Of' }, 'On 50, 14 Steps In Front Of Front Hash'],
    [76799, 76400, { kind: 'offset', landmark: 'Front Hash', quarterSteps: 56, direction: 'Behind' }, 'On 50, 14 Steps Behind Front Hash'],
    [76800, 76400, { kind: 'offset', landmark: 'Front Hash', quarterSteps: 56, direction: 'Behind' }, 'On 50, 14 Steps Behind Front Hash'],
    [76801, 77200, { kind: 'offset', landmark: 'Back Hash', quarterSteps: 56, direction: 'In Front Of' }, 'On 50, 14 Steps In Front Of Back Hash'],
    [127999, 127600, { kind: 'offset', landmark: 'Back Hash', quarterSteps: 56, direction: 'Behind' }, 'On 50, 14 Steps Behind Back Hash'],
    [128000, 127600, { kind: 'offset', landmark: 'Back Hash', quarterSteps: 56, direction: 'Behind' }, 'On 50, 14 Steps Behind Back Hash'],
    [128001, 128400, { kind: 'offset', landmark: 'Back Sideline', quarterSteps: 56, direction: 'In Front Of' }, 'On 50, 14 Steps In Front Of Back Sideline'],
  ] as const)('keeps y=%i stable and builder-valid at a landmark bisector', (y, expectedY, vertical, notation) => {
    const snapped = snapToQuarterStepGrid({ x: 144000, y });

    expect(snapped).toEqual({ x: 144000, y: expectedY });
    expect(snapToQuarterStepGrid(snapped)).toEqual(snapped);
    expect(buildCoordinate({ horizontal: { kind: 'line', line: 50 }, vertical })).toEqual(snapped);
    expect(inspectCoordinate(snapped).notation).toBe(notation);
  });

  it('is idempotent for every canonical y coordinate on the 50-yard line', () => {
    for (let y = 0; y <= 153600; y += 1) {
      const snapped = snapToQuarterStepGrid({ x: 144000, y });
      expect(snapToQuarterStepGrid(snapped)).toEqual(snapped);
    }
  });
});
