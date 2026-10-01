import { describe, expect, it } from 'vitest';
import { NFHS_11_PLAYER_FIELD } from '../geometry/nfhs';
import { createFieldTransform, FIELD_MARGIN_PX, FIELD_WIDTH_PX } from './field-geometry';

describe('field-geometry SVG transform', () => {
  const transform = createFieldTransform(NFHS_11_PLAYER_FIELD);

  it('places the front at the lower margin and back at the upper margin using independent expected pixels', () => {
    // These are physical SVG landmark coordinates, not values calculated by
    // calling the transform under test: y=0 is canonical front and must render
    // at the lower field edge; y=153600 is canonical back and must render top.
    expect(transform.toPixel({ x: 0, y: 0 })).toEqual({ x: 40, y: 520 });
    expect(transform.toPixel({ x: NFHS_11_PLAYER_FIELD.lengthUnits, y: NFHS_11_PLAYER_FIELD.widthUnits })).toEqual({
      x: 940,
      y: 40,
    });
  });

  it('places the 50-yard line at the exact horizontal midpoint pixel', () => {
    const fifty = transform.toPixel({ x: NFHS_11_PLAYER_FIELD.lengthUnits / 2, y: 0 });
    expect(fifty.x).toBe(FIELD_MARGIN_PX + FIELD_WIDTH_PX / 2);
  });

  it('places the front hash below the back hash at independent exact pixel positions', () => {
    const frontHash = transform.toPixel({ x: 0, y: NFHS_11_PLAYER_FIELD.frontHashY });
    const backHash = transform.toPixel({ x: 0, y: NFHS_11_PLAYER_FIELD.backHashY });
    expect(frontHash.y).toBe(360);
    expect(backHash.y).toBe(200);
    expect(frontHash.y).toBeGreaterThan(backHash.y);
  });

  it('round-trips pixel space back to integer, in-bounds canonical FU', () => {
    for (const dot of [
      { x: 0, y: 0 },
      { x: NFHS_11_PLAYER_FIELD.lengthUnits, y: NFHS_11_PLAYER_FIELD.widthUnits },
      { x: 61111, y: 39999 },
      { x: 115200, y: 51200 },
      { x: 245678, y: 123456 },
    ]) {
      expect(transform.toFieldUnits(transform.toPixel(dot))).toEqual(dot);
    }
  });

  it('clamps out-of-bounds pixel positions to the nearest valid field edge', () => {
    expect(transform.toFieldUnits({ x: -1000, y: -1000 })).toEqual({
      x: 0,
      y: NFHS_11_PLAYER_FIELD.widthUnits,
    });
    expect(transform.toFieldUnits({ x: 100000, y: 100000 })).toEqual({
      x: NFHS_11_PLAYER_FIELD.lengthUnits,
      y: 0,
    });
  });
});
