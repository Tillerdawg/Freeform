import type { Dot } from '../document/types';
import {
  assertValidDot,
  FIVE_YARDS_FU,
  FU_PER_QUARTER_STEP,
  NFHS_11_PLAYER_FIELD,
} from './nfhs';

export type LandmarkName = 'Front Sideline' | 'Front Hash' | 'Back Hash' | 'Back Sideline';
export type HorizontalDirection = 'Inside' | 'Outside';
export type VerticalDirection = 'In Front Of' | 'Behind';

export interface OnLineInput {
  readonly kind: 'line';
  readonly line: number;
}

export interface SplittingInput {
  readonly kind: 'splitting';
  /** The frontward/Side 1 coordinate of the pair, in field yards. */
  readonly lowerLine: number;
  readonly higherLine: number;
}

export interface HorizontalOffsetInput {
  readonly kind: 'offset';
  readonly line: number;
  /** A positive integer number of quarter steps, not a floating-point step value. */
  readonly quarterSteps: number;
  readonly direction: HorizontalDirection;
}

export type HorizontalCoordinateInput = OnLineInput | SplittingInput | HorizontalOffsetInput;

export interface OnLandmarkInput {
  readonly kind: 'landmark';
  readonly landmark: LandmarkName;
}

export interface VerticalOffsetInput {
  readonly kind: 'offset';
  readonly landmark: LandmarkName;
  /** A positive integer number of quarter steps, not a floating-point step value. */
  readonly quarterSteps: number;
  readonly direction: VerticalDirection;
}

export type VerticalCoordinateInput = OnLandmarkInput | VerticalOffsetInput;

export interface CoordinateInput {
  readonly horizontal: HorizontalCoordinateInput;
  readonly vertical: VerticalCoordinateInput;
}

const LANDMARK_Y: Readonly<Record<LandmarkName, number>> = {
  'Front Sideline': 0,
  'Front Hash': NFHS_11_PLAYER_FIELD.frontHashY,
  'Back Hash': NFHS_11_PLAYER_FIELD.backHashY,
  'Back Sideline': NFHS_11_PLAYER_FIELD.widthUnits,
};

/**
 * Converts the structured performer-facing grammar to its exact canonical FU
 * coordinate. This accepts only whole quarter steps, so no rounding occurs.
 */
export function buildCoordinate(input: CoordinateInput): Dot {
  const dot = {
    x: buildHorizontal(input.horizontal),
    y: buildVertical(input.vertical),
  };
  assertValidDot(dot);
  return dot;
}

/** Formats a canonical five-yard line with the same labels used by inspection. */
export function formatYardLine(line: number): string {
  assertFiveYardLine(line);
  if (line === 50) return '50';
  return line < 50 ? `Side 1 ${line}` : `Side 2 ${100 - line}`;
}

/**
 * Parses the UI's decimal-step field without using floating point. Only values
 * expressible as whole quarter steps (for example, 1, 1.25, and 0.5) are valid.
 */
export function parseQuarterSteps(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new RangeError('Steps must be a nonnegative multiple of 0.25.');

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(whole) || fraction % 25 !== 0) {
    throw new RangeError('Steps must be a nonnegative multiple of 0.25.');
  }
  return whole * 4 + fraction / 25;
}

/**
 * Snaps a valid canonical dot to the nearest quarter-step point relative to
 * the inspection algorithm's nearest five-yard line and landmark. Ties use
 * round-half-away-from-zero, matching the display rounding convention.
 */
export function snapToQuarterStepGrid(dot: Dot): Dot {
  assertValidDot(dot);
  const xLine = nearestFiveYardLine(dot.x);
  const yLandmark = nearestLandmarkY(dot.y);
  const snapped = {
    x: xLine + roundToNearestQuarterStep(dot.x - xLine),
    y: snapVerticalToInspectionCell(dot.y, yLandmark),
  };
  assertValidDot(snapped);
  return snapped;
}

function buildHorizontal(input: HorizontalCoordinateInput): number {
  switch (input.kind) {
    case 'line':
      assertFiveYardLine(input.line);
      return input.line * NFHS_11_PLAYER_FIELD.unitsPerYard;
    case 'splitting':
      assertFiveYardLine(input.lowerLine);
      assertFiveYardLine(input.higherLine);
      if (input.higherLine !== input.lowerLine + 5) {
        throw new RangeError('Splitting lines must be adjacent five-yard lines in ascending field order.');
      }
      return (input.lowerLine + input.higherLine) * NFHS_11_PLAYER_FIELD.unitsPerYard / 2;
    case 'offset': {
      assertFiveYardLine(input.line);
      assertPositiveQuarterSteps(input.quarterSteps);
      if (input.line === 50) {
        throw new RangeError('Offset direction from the 50-yard line is ambiguous; use an adjacent five-yard line.');
      }
      const line = input.line * NFHS_11_PLAYER_FIELD.unitsPerYard;
      const towardFifty = input.line < 50 ? 1 : -1;
      const direction = input.direction === 'Inside' ? towardFifty : -towardFifty;
      const x = line + direction * input.quarterSteps * FU_PER_QUARTER_STEP;
      if (Math.abs(x - line) * 2 >= FIVE_YARDS_FU) {
        throw new RangeError('Offset reaches or crosses a splitting point; use Splitting or a nearer yard line.');
      }
      return x;
    }
  }
}

function buildVertical(input: VerticalCoordinateInput): number {
  const landmark = LANDMARK_Y[input.landmark];
  if (input.kind === 'landmark') return landmark;

  assertPositiveQuarterSteps(input.quarterSteps);
  const direction = input.direction === 'In Front Of' ? -1 : 1;
  const y = landmark + direction * input.quarterSteps * FU_PER_QUARTER_STEP;
  if (nearestLandmarkY(y) !== landmark) {
    throw new RangeError('Offset reaches or crosses a nearer landmark; use that landmark instead.');
  }
  return y;
}

function assertFiveYardLine(line: number): void {
  if (!Number.isInteger(line) || line < 0 || line > 100 || line % 5 !== 0) {
    throw new RangeError('Yard line must be an integer five-yard line from 0 through 100.');
  }
}

function assertPositiveQuarterSteps(quarterSteps: number): void {
  if (!Number.isSafeInteger(quarterSteps) || quarterSteps <= 0) {
    throw new RangeError('Quarter-step offsets must be positive integers. Use an On input for zero distance.');
  }
}

function nearestFiveYardLine(x: number): number {
  const lower = Math.floor(x / FIVE_YARDS_FU) * FIVE_YARDS_FU;
  const higher = Math.min(lower + FIVE_YARDS_FU, NFHS_11_PLAYER_FIELD.lengthUnits);
  return x - lower <= higher - x ? lower : higher;
}

function nearestLandmarkY(y: number): number {
  return Object.values(LANDMARK_Y).reduce((nearest, candidate) => {
    const candidateDistance = Math.abs(y - candidate);
    const nearestDistance = Math.abs(y - nearest);
    return candidateDistance < nearestDistance || (candidateDistance === nearestDistance && candidate < nearest)
      ? candidate
      : nearest;
  });
}

/**
 * A hash's FU coordinate is not necessarily divisible by 450. Naively rounding
 * from the nearest input landmark can therefore cross a landmark bisector and
 * produce a dot whose inspection selects a different landmark. Restrict the
 * result to the inspection cell of the landmark selected before rounding, so a
 * snapped dot remains an exact builder-valid instruction and is idempotent.
 */
function snapVerticalToInspectionCell(y: number, landmark: number): number {
  const landmarks = Object.values(LANDMARK_Y).sort((left, right) => left - right);
  const index = landmarks.indexOf(landmark);
  if (index === -1) throw new Error('Unknown landmark.');

  // inspectCoordinate awards an exact bisector tie to the lower-y landmark.
  const lowerBound = index === 0
    ? 0
    : Math.floor((landmarks[index - 1]! + landmark) / 2) + 1;
  const upperBound = index === landmarks.length - 1
    ? NFHS_11_PLAYER_FIELD.widthUnits
    : Math.floor((landmark + landmarks[index + 1]!) / 2);
  const minimumQuarterOffset = Math.ceil((lowerBound - landmark) / FU_PER_QUARTER_STEP);
  const maximumQuarterOffset = Math.floor((upperBound - landmark) / FU_PER_QUARTER_STEP);
  const roundedQuarterOffset = roundToNearestQuarterStep(y - landmark) / FU_PER_QUARTER_STEP;
  const constrainedQuarterOffset = Math.min(
    maximumQuarterOffset,
    Math.max(minimumQuarterOffset, roundedQuarterOffset),
  );
  return landmark + constrainedQuarterOffset * FU_PER_QUARTER_STEP;
}

function roundToNearestQuarterStep(units: number): number {
  const sign = Math.sign(units);
  return sign * Math.floor((Math.abs(units) + FU_PER_QUARTER_STEP / 2) / FU_PER_QUARTER_STEP) * FU_PER_QUARTER_STEP;
}
