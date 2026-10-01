import type { Dot, FreeformDocument } from '../document/types';

/**
 * Presentation-only SVG layout constants for the field renderer. Chosen so
 * every canonical landmark this card must verify — the 50-yard line and both
 * hash marks — lands on an exact integer pixel: the playing-field box is
 * 900x480 (matching the field's exact 288000:153600 = 15:8 aspect ratio, so
 * proportions are exact, not approximated), and 480 is divisible by 3 so the
 * hash marks (at exactly 1/3 and 2/3 of the field width) are whole pixels too.
 */
export const FIELD_MARGIN_PX = 40;
export const FIELD_WIDTH_PX = 900;
export const FIELD_HEIGHT_PX = 480;
export const FIELD_VIEWBOX_WIDTH = FIELD_WIDTH_PX + FIELD_MARGIN_PX * 2;
export const FIELD_VIEWBOX_HEIGHT = FIELD_HEIGHT_PX + FIELD_MARGIN_PX * 2;

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface FieldTransform {
  readonly viewBox: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Canonical FU -> presentation SVG pixel space. Never the reverse source of truth. */
  toPixel(dot: Dot): PixelPoint;
  /**
   * Presentation pixel -> canonical FU, rounded to the nearest integer FU and
   * clamped to the field bounds so every result is `isValidDot`-eligible.
   * This is the only place screen coordinates cross back into field units;
   * callers must still route the result through the command store, never
   * persist the pixel point itself, per the M1 decision record.
   */
  toFieldUnits(point: PixelPoint): Dot;
}

/** Builds the FU<->pixel transform for one field preset. Pure and stateless. */
export function createFieldTransform(field: FreeformDocument['field']): FieldTransform {
  const { lengthUnits, widthUnits } = field;

  return {
    viewBox: `0 0 ${FIELD_VIEWBOX_WIDTH} ${FIELD_VIEWBOX_HEIGHT}`,
    widthPx: FIELD_VIEWBOX_WIDTH,
    heightPx: FIELD_VIEWBOX_HEIGHT,
    toPixel(dot) {
      return {
        x: FIELD_MARGIN_PX + (dot.x / lengthUnits) * FIELD_WIDTH_PX,
        // Canonical y=0 is the front sideline. SVG y increases downward, so
        // invert only this presentation axis: the front is rendered at bottom
        // and the back at top while document coordinates stay canonical.
        y: FIELD_MARGIN_PX + ((widthUnits - dot.y) / widthUnits) * FIELD_HEIGHT_PX,
      };
    },
    toFieldUnits(point) {
      const rawX = ((point.x - FIELD_MARGIN_PX) / FIELD_WIDTH_PX) * lengthUnits;
      const rawY = widthUnits - ((point.y - FIELD_MARGIN_PX) / FIELD_HEIGHT_PX) * widthUnits;
      return {
        x: clamp(Math.round(rawX), 0, lengthUnits),
        y: clamp(Math.round(rawY), 0, widthUnits),
      };
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
