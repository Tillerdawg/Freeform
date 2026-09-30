import { FU_PER_STEP, FU_PER_YARD } from '../geometry/nfhs';
import { validateFloatTransition } from '../document/sets';
import type { Dot, FreeformDocument, Identifier, Transition } from '../document/types';

export type StepStatusBand = 'green' | 'yellow' | 'red';

export interface FloatSample {
  readonly transitionId: Identifier;
  readonly count: number;
  readonly counts: number;
  readonly t: number;
  readonly positions: Readonly<Record<Identifier, Dot>>;
}

export interface StepSizeStatus {
  readonly performerId: Identifier;
  readonly distanceFU: number;
  readonly distanceYards: number;
  readonly stepSize?: number;
  readonly label: string;
  readonly band: StepStatusBand;
}

export interface PairDistance {
  readonly distanceFU: number;
  readonly distanceSteps: number;
  readonly distanceYards: number;
  readonly quarterSteps: number;
  readonly display: Readonly<{
    steps: string;
    yards: string;
    quarterSteps: string;
  }>;
}

export function sampleFloatTransition(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
  count: number,
): FloatSample {
  validateFloatTransition(document, transition);
  if (!Number.isInteger(count) || count < 0 || count > transition.counts) {
    throw new RangeError(`Count must be an integer from 0 through ${transition.counts}.`);
  }
  const from = document.sets.find((set) => set.id === transition.fromSetId)!;
  const to = document.sets.find((set) => set.id === transition.toSetId)!;
  const t = count / transition.counts;
  const positions = Object.fromEntries(document.performers.map(({ id }) => {
    const start = from.positions[id]!;
    const end = to.positions[id]!;
    return [id, {
      x: start.x + t * (end.x - start.x),
      y: start.y + t * (end.y - start.y),
    }];
  }));
  return { transitionId: transition.id, count, counts: transition.counts, t, positions };
}

export function calculateStepSizeStatus(
  start: Dot,
  end: Dot,
  counts: number,
  performerId = 'performer',
): StepSizeStatus {
  if (!Number.isInteger(counts) || counts <= 0) throw new RangeError('Transition counts must be a positive integer.');
  const distanceFU = Math.hypot(end.x - start.x, end.y - start.y);
  const distanceYards = distanceFU / FU_PER_YARD;
  if (distanceFU === 0) {
    return { performerId, distanceFU, distanceYards, label: 'No movement', band: 'green' };
  }
  const stepSize = counts * 5 / distanceYards;
  const band: StepStatusBand = stepSize >= 6.1 ? 'green' : stepSize <= 4.0 ? 'red' : 'yellow';
  return { performerId, distanceFU, distanceYards, stepSize, label: `${stepSize.toFixed(3)} to 5`, band };
}

export function calculateTransitionStepStatuses(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
): readonly StepSizeStatus[] {
  validateFloatTransition(document, transition);
  const from = document.sets.find((set) => set.id === transition.fromSetId)!;
  const to = document.sets.find((set) => set.id === transition.toSetId)!;
  return document.performers.map(({ id }) => calculateStepSizeStatus(
    from.positions[id]!, to.positions[id]!, transition.counts, id,
  ));
}

export function calculatePairDistance(first: Dot, second: Dot): PairDistance {
  const distanceFU = Math.hypot(second.x - first.x, second.y - first.y);
  const distanceSteps = distanceFU / FU_PER_STEP;
  const distanceYards = distanceFU / FU_PER_YARD;
  const quarterSteps = Math.floor(distanceSteps * 4 + 0.5) / 4;
  return {
    distanceFU,
    distanceSteps,
    distanceYards,
    quarterSteps,
    display: {
      steps: `${distanceSteps.toFixed(3)} steps`,
      yards: `${distanceYards.toFixed(3)} yards`,
      quarterSteps: `${quarterSteps.toFixed(2)} steps (quarter-step)`,
    },
  };
}
