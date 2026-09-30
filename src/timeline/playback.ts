import type { FreeformDocument, Identifier, Transition } from '../document/types';
import { sampleFloatTransition, type FloatSample } from './float';
import { sampleFtlTransition, type FtlSample } from './ftl';

export type TransitionSample = FloatSample | FtlSample;

export interface PlaybackState {
  readonly count: number;
  readonly isPlaying: boolean;
  readonly sample: TransitionSample;
}

export interface KeyboardEventLike {
  readonly key: string;
  readonly target: EventTarget | null;
  preventDefault(): void;
}

export interface PlaybackController {
  getState(): PlaybackState;
  play(): PlaybackState;
  pause(): PlaybackState;
  toggle(): PlaybackState;
  previous(): PlaybackState;
  next(): PlaybackState;
  seek(count: number): PlaybackState;
  handleKeyDown(event: KeyboardEventLike): boolean;
}

/**
 * Sequential single-transition playback. The controller has no clock so the DOM
 * layer can choose its timer and re-render each integer sample exactly.
 */
export function createPlaybackController(
  document: Pick<FreeformDocument, 'performers' | 'sets'>,
  transition: Transition,
): PlaybackController {
  let count = 0;
  let isPlaying = false;

  const state = (): PlaybackState => ({
    count,
    isPlaying,
    sample: transition.mode === 'float'
      ? sampleFloatTransition(document, transition, count)
      : sampleFtlTransition(document, transition, count),
  });
  const seek = (nextCount: number): PlaybackState => {
    if (!Number.isInteger(nextCount)) throw new RangeError('Playback count must be an integer.');
    count = Math.max(0, Math.min(transition.counts, nextCount));
    if (count === transition.counts) isPlaying = false;
    return state();
  };

  return {
    getState: state,
    play() {
      if (count === transition.counts) count = 0;
      isPlaying = true;
      return state();
    },
    pause() {
      isPlaying = false;
      return state();
    },
    toggle() {
      return isPlaying ? this.pause() : this.play();
    },
    previous() { return seek(count - 1); },
    next() { return seek(count + 1); },
    seek,
    handleKeyDown(event) {
      if (isEditableTarget(event.target)) return false;
      switch (event.key) {
        case ' ':
        case 'Spacebar':
          event.preventDefault();
          this.toggle();
          return true;
        case 'ArrowLeft':
          event.preventDefault();
          this.previous();
          return true;
        case 'ArrowRight':
          event.preventDefault();
          this.next();
          return true;
        default:
          return false;
      }
    },
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function findTransition(document: Pick<FreeformDocument, 'transitions'>, transitionId: Identifier): Transition {
  const transition = document.transitions.find((candidate) => candidate.id === transitionId);
  if (!transition) throw new Error(`Unknown transition: ${transitionId}`);
  return transition;
}
