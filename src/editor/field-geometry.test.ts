import { describe, expect, it } from 'vitest';
import { NFHS_11_PLAYER_FIELD } from '../geometry/nfhs';
import { createFieldTransform, FIELD_HEIGHT_PX, FIELD_MARGIN_PX, FIELD_WIDTH_PX } from './field-geometry';

describe('field-geometry SVG transform', () => {
  const transform = createFieldTransform(NFHS_11_PLAYER_FIELD);

  it('places the field boundary corners at the exact margin-offset pixel positions', () => {
    expect(transform.toPixel({ x: 0, y: 0 })).toEqual({ x: FIELD_MARGIN_PX, y: FIELD_MARGIN_PX });
    expect(transform.toPixel({ x: NFHS_11_PLAYER_FIELD.lengthUnits, y: NFHS_11_PLAYER_FIELD.widthUnits })).toEqual({
      x: FIELD_MARGIN_PX + FIELD_WIDTH_PX,
      y: FIELD_MARGIN_PX + FIELD_HEIGHT_PX,
    });
  });

  it('places the 50-yard line at the exact horizontal midpoint pixel', () => {
    const fifty = transform.toPixel({ x: NFHS_11_PLAYER_FIELD.lengthUnits / 2, y: 0 });
    expect(fifty.x).toBe(FIELD_MARGIN_PX + FIELD_WIDTH_PX / 2);
  });

  it('places the front and back hash marks at their exact canonical-ratio pixel positions', () => {
    const frontHash = transform.toPixel({ x: 0, y: NFHS_11_PLAYER_FIELD.frontHashY });
    const backHash = transform.toPixel({ x: 0, y: NFHS_11_PLAYER_FIELD.backHashY });
    // frontHashY / widthUnits === 1/3 and backHashY / widthUnits === 2/3 exactly,
    // per the NFHS_11_PLAYER_FIELD constants (51200/153600 and 102400/153600),
    // and FIELD_HEIGHT_PX (480) is divisible by 3, so both land on exact pixels.
    expect(frontHash.y).toBe(FIELD_MARGIN_PX + FIELD_HEIGHT_PX / 3);
    expect(backHash.y).toBe(FIELD_MARGIN_PX + (FIELD_HEIGHT_PX * 2) / 3);
  });

  it('round-trips pixel space back to integer, in-bounds canonical FU', () => {
    const dot = { x: 115200, y: 51200 };
    const pixel = transform.toPixel(dot);
    const roundTripped = transform.toFieldUnits(pixel);
    expect(roundTripped).toEqual(dot);
  });

  it('clamps out-of-bounds pixel positions to the nearest valid field edge', () => {
    expect(transform.toFieldUnits({ x: -1000, y: -1000 })).toEqual({ x: 0, y: 0 });
    expect(transform.toFieldUnits({ x: 100000, y: 100000 })).toEqual({
      x: NFHS_11_PLAYER_FIELD.lengthUnits,
      y: NFHS_11_PLAYER_FIELD.widthUnits,
    });
  });
});
