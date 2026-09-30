import { describe, expect, it } from 'vitest';
import type { FreeformDocument, Transition } from '../document/types';
import { createPlaybackController } from './playback';

const document: FreeformDocument = {
  format: 'freeform', formatVersion: '1.0.0',
  show: { id: 'show-1', title: 'Playback', totalCounts: 4 },
  field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
  settings: { collisionThresholdUnits: 2880 },
  performers: [{ id: 'a', rankCode: 'A', displayName: 'A' }],
  sets: [
    { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 } } },
    { id: 'set-2', name: 'Set 2', startCount: 4, positions: { a: { x: 7200, y: 0 } } },
  ],
  transitions: [], annotations: [],
};
const transition: Transition = { id: 'float-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 4, mode: 'float' };

function keyEvent(key: string) {
  let prevented = false;
  return {
    event: { key, target: null, preventDefault: () => { prevented = true; } },
    wasPrevented: () => prevented,
  };
}

describe('keyboard playback handler', () => {
  it('handles space play/pause and arrow count navigation through the keyboard handler', () => {
    const playback = createPlaybackController(document, transition);
    const play = keyEvent(' ');
    expect(playback.handleKeyDown(play.event)).toBe(true);
    expect(play.wasPrevented()).toBe(true);
    expect(playback.getState()).toMatchObject({ count: 0, isPlaying: true });

    const next = keyEvent('ArrowRight');
    playback.handleKeyDown(next.event);
    expect(next.wasPrevented()).toBe(true);
    expect(playback.getState().count).toBe(1);
    expect(playback.getState().sample.positions.a).toEqual({ x: 1800, y: 0 });

    playback.handleKeyDown(keyEvent('ArrowLeft').event);
    expect(playback.getState().count).toBe(0);
    playback.handleKeyDown(keyEvent(' ').event);
    expect(playback.getState().isPlaying).toBe(false);
  });

  it('clamps direct and next/previous count navigation to inclusive transition endpoints', () => {
    const playback = createPlaybackController(document, transition);
    expect(playback.seek(99).count).toBe(4);
    expect(playback.getState().isPlaying).toBe(false);
    expect(playback.previous().count).toBe(3);
    expect(playback.seek(-1).count).toBe(0);
  });
});
