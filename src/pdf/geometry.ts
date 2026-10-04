import type { Dot, FreeformDocument } from '../document/types';
import { DIRECTOR_FIELD_RECT } from './contracts';

export interface PdfPoint {
  readonly x: number;
  readonly y: number;
}

/** Maps canonical FU directly into the approved director PDF field rectangle. */
export function fieldPoint(
  dot: Dot,
  field: FreeformDocument['field'],
  rect: Readonly<{ x: number; y: number; width: number; height: number }> = DIRECTOR_FIELD_RECT,
): PdfPoint {
  return {
    x: rect.x + dot.x / field.lengthUnits * rect.width,
    y: rect.y + dot.y / field.widthUnits * rect.height,
  };
}
