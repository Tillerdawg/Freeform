import { describe, expect, it } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument } from '../document/types';
import {
  buildDotFromEditorValues,
  type DotEditorCoordinateValues,
} from './dot-editor';

function formValues(overrides: Partial<DotEditorCoordinateValues> = {}): DotEditorCoordinateValues {
  return {
    useRawFu: false,
    x: '',
    y: '',
    horizontalMode: 'line',
    side: 'side-1',
    lineYard: '40',
    splittingLower: '40',
    splittingHigher: '45',
    horizontalSteps: '1',
    horizontalDirection: 'Inside',
    horizontalFiftySide: 'side-1',
    verticalMode: 'landmark',
    landmark: 'Front Hash',
    verticalSteps: '1',
    verticalDirection: 'In Front Of',
    ...overrides,
  };
}

function makeDocument(): FreeformDocument {
  return {
    format: 'freeform',
    formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Original Title', totalCounts: 0 },
    field: {
      preset: 'NFHS_11_PLAYER',
      unitsPerYard: 2880,
      lengthUnits: 288000,
      widthUnits: 153600,
      frontHashY: 51200,
      backHashY: 102400,
    },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'performer-1', rankCode: 'P1', displayName: 'Performer 1' }],
    sets: [{
      id: 'set-1',
      name: 'Set 1',
      startCount: 0,
      positions: { 'performer-1': { x: 144000, y: 76800 } },
    }],
    transitions: [],
    annotations: [],
  };
}

describe('structured dot-editor form conversion', () => {
  it('converts Side 1, Side 2, fully labelled splitting, offsets, and raw FU fallback', () => {
    expect(buildDotFromEditorValues(formValues())).toEqual({ x: 115200, y: 51200 });
    expect(buildDotFromEditorValues(formValues({ side: 'side-2' }))).toEqual({ x: 172800, y: 51200 });
    expect(buildDotFromEditorValues(formValues({
      horizontalMode: 'splitting',
      splittingLower: '55',
      splittingHigher: '60',
    }))).toEqual({ x: 165600, y: 51200 });
    expect(() => buildDotFromEditorValues(formValues({
      horizontalMode: 'splitting',
      splittingLower: '55',
      splittingHigher: '65',
    }))).toThrow('adjacent');
    expect(buildDotFromEditorValues(formValues({
      horizontalMode: 'offset',
      side: 'side-2',
      horizontalDirection: 'Inside',
      verticalMode: 'offset',
      verticalDirection: 'Behind',
    }))).toEqual({ x: 171000, y: 53000 });
    expect(buildDotFromEditorValues(formValues({
      horizontalMode: 'offset',
      side: '50',
      horizontalSteps: '2',
      horizontalFiftySide: 'side-1',
    }))).toEqual({ x: 140400, y: 51200 });
    expect(buildDotFromEditorValues(formValues({
      horizontalMode: 'offset',
      side: '50',
      horizontalSteps: '2',
      horizontalFiftySide: 'side-2',
    }))).toEqual({ x: 147600, y: 51200 });
    expect(buildDotFromEditorValues(formValues({ useRawFu: true, x: '225', y: '25600' }))).toEqual({ x: 225, y: 25600 });
  });

  it('sends the structured form result through dot.move and command-store undo/redo', () => {
    const store = createCommandStore(makeDocument());
    const dot = buildDotFromEditorValues(formValues({
      horizontalMode: 'splitting',
      splittingLower: '55',
      splittingHigher: '60',
      verticalMode: 'offset',
      verticalDirection: 'Behind',
    }));

    store.apply({ type: 'dot.move', setId: 'set-1', performerId: 'performer-1', dot });
    expect(store.getState().document.sets[0]?.positions['performer-1']).toEqual({ x: 165600, y: 53000 });
    expect(store.undo()?.document.sets[0]?.positions['performer-1']).toEqual({ x: 144000, y: 76800 });
    expect(store.redo()?.document.sets[0]?.positions['performer-1']).toEqual({ x: 165600, y: 53000 });
  });
});
