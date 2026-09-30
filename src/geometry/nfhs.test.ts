import { describe, expect, it } from 'vitest';
import {
  FU_PER_QUARTER_STEP,
  FU_PER_STEP,
  FU_PER_YARD,
  inspectCoordinate,
  isValidDot,
  NFHS_11_PLAYER_FIELD,
} from './nfhs';

describe('NFHS_11_PLAYER canonical geometry', () => {
  it('uses the exact §3.1 integer FU constants', () => {
    expect(NFHS_11_PLAYER_FIELD).toEqual({
      preset: 'NFHS_11_PLAYER',
      unitsPerYard: 2880,
      lengthUnits: 288000,
      widthUnits: 153600,
      frontHashY: 51200,
      backHashY: 102400,
    });
    expect(FU_PER_YARD).toBe(2880);
    expect(FU_PER_STEP).toBe(1800);
    expect(FU_PER_QUARTER_STEP).toBe(450);
  });

  it('accepts only integer dots inside the playing field inclusive bounds', () => {
    expect(isValidDot({ x: 0, y: 0 })).toBe(true);
    expect(isValidDot({ x: 288000, y: 153600 })).toBe(true);
    expect(isValidDot({ x: -1, y: 0 })).toBe(false);
    expect(isValidDot({ x: 288001, y: 0 })).toBe(false);
    expect(isValidDot({ x: 0, y: 153601 })).toBe(false);
    expect(isValidDot({ x: 0.5, y: 0 })).toBe(false);
  });
});

describe('coordinate derivation golden labels', () => {
  it('reproduces the §3.2 worked splitting/front-hash example', () => {
    expect(inspectCoordinate({ x: 122400, y: 44000 }).notation)
      .toBe('Splitting Side 1 40 & Side 1 45, 4 Steps In Front Of Front Hash');
  });

  it('labels an exact five-yard line with On and no horizontal step suffix', () => {
    expect(inspectCoordinate({ x: 115200, y: 51200 }).notation)
      .toBe('On Side 1 40, On Front Hash');
  });

  it('labels an exact splitting halfway case', () => {
    expect(inspectCoordinate({ x: 7200, y: 0 }).notation)
      .toBe('Splitting Side 1 0 & Side 1 5, On Front Sideline');
  });

  it('labels exact front and back hash hits', () => {
    expect(inspectCoordinate({ x: 144000, y: 51200 }).notation).toBe('On 50, On Front Hash');
    expect(inspectCoordinate({ x: 144000, y: 102400 }).notation).toBe('On 50, On Back Hash');
  });

  it('labels Inside and Outside directions', () => {
    expect(inspectCoordinate({ x: 117000, y: 51200 }).notation)
      .toBe('1 Step Inside Side 1 40, On Front Hash');
    expect(inspectCoordinate({ x: 113400, y: 51200 }).notation)
      .toBe('1 Step Outside Side 1 40, On Front Hash');
  });

  it('labels both sides of a nonzero 50-yard-line offset unambiguously', () => {
    expect(inspectCoordinate({ x: 140400, y: 51200 }).notation)
      .toBe('2 Steps Outside 50 (Side 1), On Front Hash');
    expect(inspectCoordinate({ x: 147600, y: 51200 }).notation)
      .toBe('2 Steps Outside 50 (Side 2), On Front Hash');
  });

  it('labels In Front Of and Behind directions', () => {
    expect(inspectCoordinate({ x: 144000, y: 49400 }).notation)
      .toBe('On 50, 1 Step In Front Of Front Hash');
    expect(inspectCoordinate({ x: 144000, y: 53000 }).notation)
      .toBe('On 50, 1 Step Behind Front Hash');
  });

  it('uses frontward landmark selection on a vertical exact-distance tie', () => {
    expect(inspectCoordinate({ x: 144000, y: 25600 }).notation)
      .toBe('On 50, 14.25 Steps Behind Front Sideline');
  });

  it('rounds a positive step distance to a quarter step half away from zero', () => {
    expect(inspectCoordinate({ x: 225, y: 0 }).notation)
      .toBe('0.25 Steps Inside Side 1 0, On Front Sideline');
  });

  it('retains unrounded FU and the exact raw step ratio for inspection', () => {
    const inspection = inspectCoordinate({ x: 117000, y: 44000 });
    expect(inspection.horizontal.rawDistance).toEqual({
      units: 1800,
      numeratorUnits: 1800,
      denominatorUnits: 1800,
    });
    expect(inspection.vertical.rawDistance).toEqual({
      units: 7200,
      numeratorUnits: 7200,
      denominatorUnits: 1800,
    });
  });
});
