import { selectAnnotations, type AnnotationSelection } from '../document/annotations';
import type { Annotation, Dot, FreeformDocument } from '../document/types';
import { createFieldTransform } from './field-geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Renders only persisted, applicable annotations into an existing SVG. The
 * caller owns the SVG's field background and pointer handling. All geometry is
 * transformed from canonical field units at this presentation boundary.
 */
export function renderAnnotationOverlay(
  svg: SVGSVGElement,
  freeformDocument: FreeformDocument,
  selection: AnnotationSelection,
): void {
  const transform = createFieldTransform(freeformDocument.field);
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'annotation-overlay');
  group.setAttribute('data-context', selection.context.kind);

  const symbols = new Map((freeformDocument.symbols ?? []).map((symbol) => [symbol.id, symbol]));
  for (const annotation of selectAnnotations(freeformDocument, selection)) {
    group.append(renderAnnotation(annotation, symbols, transform.toPixel));
  }
  svg.append(group);
}

/** Small read-only context view used by timeline playback as well as authoring. */
export function renderAnnotationContextView(
  freeformDocument: FreeformDocument,
  selection: AnnotationSelection,
  description: string,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'annotation-context-view';
  const heading = document.createElement('h3');
  heading.textContent = 'Annotations in this playback context';
  const note = document.createElement('p');
  note.className = 'annotation-editor__hint';
  note.textContent = description;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('annotation-context-view__svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', description);
  const transform = createFieldTransform(freeformDocument.field);
  svg.setAttribute('viewBox', transform.viewBox);
  const lower = transform.toPixel({ x: 0, y: 0 });
  const upper = transform.toPixel({ x: freeformDocument.field.lengthUnits, y: freeformDocument.field.widthUnits });
  const boundary = document.createElementNS(SVG_NS, 'rect');
  boundary.setAttribute('class', 'annotation-preview__boundary');
  boundary.setAttribute('x', String(Math.min(lower.x, upper.x)));
  boundary.setAttribute('y', String(Math.min(lower.y, upper.y)));
  boundary.setAttribute('width', String(Math.abs(upper.x - lower.x)));
  boundary.setAttribute('height', String(Math.abs(upper.y - lower.y)));
  svg.append(boundary);
  renderAnnotationOverlay(svg, freeformDocument, selection);
  section.append(heading, note, svg);
  return section;
}

function renderAnnotation(
  annotation: Annotation,
  symbols: ReadonlyMap<string, { readonly glyph: string }>,
  toPixel: (dot: Dot) => { readonly x: number; readonly y: number },
): SVGElement {
  const group = svgElement('g');
  group.setAttribute('class', `annotation annotation--${annotation.kind}`);
  group.setAttribute('data-annotation-id', annotation.id);
  group.setAttribute('tabindex', '0');
  group.setAttribute('role', 'img');

  switch (annotation.kind) {
    case 'freehand':
      annotation.strokes.forEach((stroke) => group.append(polyline(stroke, toPixel)));
      group.setAttribute('aria-label', `Freehand annotation ${annotation.id}`);
      break;
    case 'arrow': {
      group.append(polyline(annotation.points, toPixel));
      const end = annotation.points.at(-1)!;
      const prior = annotation.points.at(-2)!;
      group.append(arrowHead(prior, end, toPixel));
      group.setAttribute('aria-label', `Arrow annotation ${annotation.id}`);
      break;
    }
    case 'label':
      group.append(annotationText(annotation.text, annotation.anchor, toPixel, 'annotation__label'));
      group.setAttribute('aria-label', `Label: ${annotation.text}`);
      break;
    case 'performerNote':
      group.append(annotationText(annotation.text, annotation.anchor, toPixel, 'annotation__note'));
      group.setAttribute('aria-label', `Performer note for ${annotation.performerId}: ${annotation.text}`);
      break;
    case 'symbol': {
      const glyph = symbols.get(annotation.symbolId)?.glyph ?? annotation.symbolId;
      const text = annotationText(glyph, annotation.anchor, toPixel, 'annotation__symbol');
      const scale = annotation.scale ?? 1;
      const rotation = annotation.rotationDegrees ?? 0;
      const point = toPixel(annotation.anchor);
      // SVG transform is presentation only; anchor remains canonical FU.
      text.setAttribute('transform', `rotate(${rotation} ${point.x} ${point.y}) scale(${scale})`);
      group.append(text);
      group.setAttribute('aria-label', `Symbol ${annotation.symbolId}`);
      break;
    }
  }
  return group;
}

function polyline(points: readonly Dot[], toPixel: (dot: Dot) => { readonly x: number; readonly y: number }): SVGPolylineElement {
  const line = svgElement('polyline');
  line.setAttribute('class', 'annotation__line');
  line.setAttribute('fill', 'none');
  line.setAttribute('points', points.map((point) => {
    const pixel = toPixel(point);
    return `${pixel.x},${pixel.y}`;
  }).join(' '));
  return line;
}

function arrowHead(
  from: Dot,
  to: Dot,
  toPixel: (dot: Dot) => { readonly x: number; readonly y: number },
): SVGPolygonElement {
  const start = toPixel(from);
  const end = toPixel(to);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const size = 9;
  const points = [
    [end.x, end.y],
    [end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6)],
    [end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6)],
  ];
  const head = svgElement('polygon');
  head.setAttribute('class', 'annotation__arrow-head');
  head.setAttribute('points', points.map(([x, y]) => `${x},${y}`).join(' '));
  return head;
}

function annotationText(
  value: string,
  anchor: Dot,
  toPixel: (dot: Dot) => { readonly x: number; readonly y: number },
  className: string,
): SVGTextElement {
  const point = toPixel(anchor);
  const text = svgElement('text');
  text.setAttribute('class', className);
  text.setAttribute('x', String(point.x));
  text.setAttribute('y', String(point.y));
  // Assigning textContent prevents any annotation text or glyph from becoming SVG/HTML markup.
  text.textContent = value;
  return text;
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}
