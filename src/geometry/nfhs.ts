import type { Dot, FreeformDocument } from '../document/types';

export const FU_PER_YARD = 2880;
export const FU_PER_STEP = 1800;
export const FU_PER_QUARTER_STEP = 450;
export const FIVE_YARDS_FU = FU_PER_YARD * 5;

/** The sole authoring surface supported by the MVP. */
export const NFHS_11_PLAYER_FIELD = {
  preset: 'NFHS_11_PLAYER',
  unitsPerYard: FU_PER_YARD,
  lengthUnits: 288000,
  widthUnits: 153600,
  frontHashY: 51200,
  backHashY: 102400,
} as const satisfies FreeformDocument['field'];

export interface RawStepDistance {
  /** Absolute canonical distance; it is never rounded for display. */
  readonly units: number;
  /** The exact step ratio is numeratorUnits / denominatorUnits. */
  readonly numeratorUnits: number;
  readonly denominatorUnits: typeof FU_PER_STEP;
}

export interface CoordinateInspection {
  readonly notation: string;
  readonly horizontal: Readonly<{
    notation: string;
    rawDistance: RawStepDistance;
  }>;
  readonly vertical: Readonly<{
    notation: string;
    rawDistance: RawStepDistance;
  }>;
}

interface Landmark {
  readonly name: 'Front Sideline' | 'Front Hash' | 'Back Hash' | 'Back Sideline';
  readonly y: number;
}

const LANDMARKS: readonly Landmark[] = [
  { name: 'Front Sideline', y: 0 },
  { name: 'Front Hash', y: NFHS_11_PLAYER_FIELD.frontHashY },
  { name: 'Back Hash', y: NFHS_11_PLAYER_FIELD.backHashY },
  { name: 'Back Sideline', y: NFHS_11_PLAYER_FIELD.widthUnits },
];

export function isValidDot(dot: Dot): boolean {
  return Number.isInteger(dot.x)
    && Number.isInteger(dot.y)
    && dot.x >= 0
    && dot.x <= NFHS_11_PLAYER_FIELD.lengthUnits
    && dot.y >= 0
    && dot.y <= NFHS_11_PLAYER_FIELD.widthUnits;
}

export function assertValidDot(dot: Dot): asserts dot is Dot {
  if (!isValidDot(dot)) {
    throw new RangeError(
      `Dot must use integer FU within x=0..${NFHS_11_PLAYER_FIELD.lengthUnits} and y=0..${NFHS_11_PLAYER_FIELD.widthUnits}.`,
    );
  }
}

/**
 * Implements the normative §3.3 label algorithm. Stored dots remain integer FU;
 * only this derived, user-facing description rounds to quarter steps.
 */
export function inspectCoordinate(dot: Dot): CoordinateInspection {
  assertValidDot(dot);

  const horizontal = inspectHorizontal(dot.x);
  const vertical = inspectVertical(dot.y);
  return {
    notation: `${horizontal.notation}, ${vertical.notation}`,
    horizontal,
    vertical,
  };
}

function inspectHorizontal(x: number): CoordinateInspection['horizontal'] {
  const lowerLine = Math.floor(x / FIVE_YARDS_FU) * FIVE_YARDS_FU;
  const distanceFromLower = x - lowerLine;
  const higherLine = lowerLine + FIVE_YARDS_FU;

  if (distanceFromLower === FIVE_YARDS_FU / 2 && higherLine <= NFHS_11_PLAYER_FIELD.lengthUnits) {
    return {
      notation: `Splitting ${lineLabel(lowerLine)} & ${lineLabel(higherLine)}`,
      rawDistance: rawStepDistance(distanceFromLower),
    };
  }

  const line = distanceFromLower < FIVE_YARDS_FU / 2 ? lowerLine : higherLine;
  const distance = Math.abs(x - line);
  if (distance === 0) {
    return { notation: `On ${lineLabel(line)}`, rawDistance: rawStepDistance(0) };
  }

  if (line === NFHS_11_PLAYER_FIELD.lengthUnits / 2) {
    const side = x < line ? 'Side 1' : 'Side 2';
    return {
      notation: `${formatRoundedSteps(distance)} Outside 50 (${side})`,
      rawDistance: rawStepDistance(distance),
    };
  }

  const direction = towardFifty(x, line) ? 'Inside' : 'Outside';
  return {
    notation: `${formatRoundedSteps(distance)} ${direction} ${lineLabel(line)}`,
    rawDistance: rawStepDistance(distance),
  };
}

function inspectVertical(y: number): CoordinateInspection['vertical'] {
  const reference = LANDMARKS.reduce((nearest, candidate) => {
    const candidateDistance = Math.abs(y - candidate.y);
    const nearestDistance = Math.abs(y - nearest.y);
    return candidateDistance < nearestDistance
      || (candidateDistance === nearestDistance && candidate.y < nearest.y)
      ? candidate
      : nearest;
  });
  const distance = Math.abs(y - reference.y);

  if (distance === 0) {
    return { notation: `On ${reference.name}`, rawDistance: rawStepDistance(0) };
  }

  return {
    notation: `${formatRoundedSteps(distance)} ${y < reference.y ? 'In Front Of' : 'Behind'} ${reference.name}`,
    rawDistance: rawStepDistance(distance),
  };
}

function lineLabel(line: number): string {
  const yards = line / FU_PER_YARD;
  if (yards === 50) return '50';
  return yards < 50 ? `Side 1 ${yards}` : `Side 2 ${100 - yards}`;
}

function towardFifty(x: number, line: number): boolean {
  const midfield = NFHS_11_PLAYER_FIELD.lengthUnits / 2;
  return (line < midfield && x > line) || (line > midfield && x < line);
}

function rawStepDistance(units: number): RawStepDistance {
  return { units, numeratorUnits: units, denominatorUnits: FU_PER_STEP };
}

function formatRoundedSteps(units: number): string {
  // Exact integer arithmetic for round-half-away-from-zero of a positive distance.
  const quarterSteps = Math.floor((units * 4 + FU_PER_STEP / 2) / FU_PER_STEP);
  const display = formatQuarterSteps(quarterSteps);
  return `${display} ${quarterSteps === 4 ? 'Step' : 'Steps'}`;
}

function formatQuarterSteps(quarterSteps: number): string {
  const whole = Math.floor(quarterSteps / 4);
  const remainder = quarterSteps % 4;
  if (remainder === 0) return String(whole);
  return `${whole}.${remainder * 25}`;
}
