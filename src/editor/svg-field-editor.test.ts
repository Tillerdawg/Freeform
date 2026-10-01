// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument } from '../document/types';
import { snapToQuarterStepGrid } from '../geometry/coordinate-builder';
import { inspectCoordinate } from '../geometry/nfhs';
import { createFieldTransform } from './field-geometry';
import { renderSvgFieldEditor, type SvgFieldEditor } from './svg-field-editor';

function makeDocument(): FreeformDocument {
  return {
    format: 'freeform',
    formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Field editor', totalCounts: 0 },
    field: {
      preset: 'NFHS_11_PLAYER',
      unitsPerYard: 2880,
      lengthUnits: 288000,
      widthUnits: 153600,
      frontHashY: 51200,
      backHashY: 102400,
    },
    settings: { collisionThresholdUnits: 2880 },
    // The command store enforces complete set coverage (every performer has a
    // dot in every existing set) at construction and after every apply — see
    // src/document/sets.ts validateSetCoverage, invoked from makeState on every
    // transition. So a real store can never reach a state where an existing
    // performer lacks a dot in an existing set; both performers start covered.
    performers: [
      { id: 'performer-1', rankCode: 'P1', displayName: 'Performer 1' },
      { id: 'performer-2', rankCode: 'P2', displayName: 'Performer 2' },
    ],
    sets: [{
      id: 'set-1',
      name: 'Set 1',
      startCount: 0,
      positions: {
        'performer-1': { x: 144000, y: 76800 },
        'performer-2': { x: 100000, y: 40000 },
      },
    }],
    transitions: [],
    annotations: [],
  };
}

/** Stubs getBoundingClientRect so client-pixel math matches the SVG's own pixel space 1:1. */
function stubBoundingClientRect(svg: SVGSVGElement, widthPx: number, heightPx: number): void {
  svg.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: widthPx, height: heightPx,
    right: widthPx, bottom: heightPx,
    toJSON() { return {}; },
  });
}

function firePointerEvent(
  target: EventTarget,
  type: string,
  init: { clientX: number; clientY: number; pointerId?: number },
): void {
  const event = new window.PointerEvent(type, {
    clientX: init.clientX,
    clientY: init.clientY,
    pointerId: init.pointerId ?? 1,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
}

describe('SVG field editor', () => {
  let store: ReturnType<typeof createCommandStore>;
  let editor: SvgFieldEditor;
  let svg: SVGSVGElement;
  let statuses: string[];
  let commits: number;

  beforeEach(() => {
    store = createCommandStore(makeDocument());
    statuses = [];
    commits = 0;
    editor = renderSvgFieldEditor({
      store,
      setStatus: (message) => statuses.push(message),
      onCommitted: () => { commits += 1; },
    });
    svg = editor.root.querySelector('svg')!;
    stubBoundingClientRect(svg, svg.viewBox.baseVal.width || 980, svg.viewBox.baseVal.height || 560);
  });

  it('renders the field boundary, yard lines at every 5 yards, and both hash marks', () => {
    const transform = createFieldTransform(store.getState().document.field);
    const boundary = svg.querySelector('.field-editor__boundary')!;
    // The front-to-back presentation flip must not produce the negative height
    // that a direct subtraction of y=0 and y=widthUnits would create.
    expect(boundary.getAttribute('x')).toBe('40');
    expect(boundary.getAttribute('y')).toBe('40');
    expect(boundary.getAttribute('width')).toBe('900');
    expect(boundary.getAttribute('height')).toBe('480');
    // 21 yard lines: 0, 5, 10, ..., 100.
    expect(svg.querySelectorAll('.field-editor__yard-line').length).toBe(21);
    expect(svg.querySelectorAll('.field-editor__yard-line--fifty').length).toBe(1);
    expect(svg.querySelectorAll('.field-editor__hash-tick').length).toBeGreaterThan(0);
    expect(svg.getAttribute('viewBox')).toBe(transform.viewBox);
  });

  it('renders bare yard numbers above and below both sides of the field', () => {
    const field = store.getState().document.field;
    const transform = createFieldTransform(field);
    const labels = [...svg.querySelectorAll<SVGTextElement>('.field-editor__yard-label')];

    for (const yard of [40, 60]) {
      const x = transform.toPixel({ x: yard * field.unitsPerYard, y: 0 }).x;
      const matchingLabels = labels.filter((label) => Number(label.getAttribute('x')) === x);
      expect(matchingLabels.map((label) => label.textContent)).toEqual(['40', '40']);
      expect(matchingLabels.map((label) => Number(label.getAttribute('y')))).toEqual([34, 536]);
    }

    const fiftyX = transform.toPixel({ x: field.lengthUnits / 2, y: 0 }).x;
    expect(labels.filter((label) => Number(label.getAttribute('x')) === fiftyX).map((label) => label.textContent)).toEqual(['50', '50']);
    expect(labels.some((label) => label.textContent?.includes('Side'))).toBe(false);
  });

  it('renders the vertical 8-to-5 grid with one half-step line and six thin lines per yard-line span', () => {
    const verticalLines = (selector: string) => [...svg.querySelectorAll<SVGLineElement>(selector)].filter((line) => (
      Number(line.getAttribute('x1')) === Number(line.getAttribute('x2'))
      && Math.min(Number(line.getAttribute('y1')), Number(line.getAttribute('y2'))) === 40
      && Math.max(Number(line.getAttribute('y1')), Number(line.getAttribute('y2'))) === 520
    ));
    const halfLines = verticalLines('.field-editor__step-line--half');
    const thinLines = verticalLines('.field-editor__step-line');

    expect(halfLines.map((line) => Number(line.getAttribute('x1')))).toEqual(expect.arrayContaining([62.5, 107.5]));
    expect(thinLines
      .filter((line) => Number(line.getAttribute('x1')) > 40 && Number(line.getAttribute('x1')) < 85)
      .map((line) => Number(line.getAttribute('x1'))))
      .toEqual([45.625, 51.25, 56.875, 68.125, 73.75, 79.375]);
  });

  it('renders horizontal half-step and thin grid lines upward from the lower front sideline', () => {
    const horizontalLines = (selector: string) => [...svg.querySelectorAll<SVGLineElement>(selector)].filter((line) => (
      Number(line.getAttribute('y1')) === Number(line.getAttribute('y2'))
      && Number(line.getAttribute('x1')) === 40
      && Number(line.getAttribute('x2')) === 940
    ));

    expect(horizontalLines('.field-editor__step-line--half')
      .slice(0, 4)
      .map((line) => Number(line.getAttribute('y1'))))
      .toEqual([520, 497.5, 475, 452.5]);
    expect(horizontalLines('.field-editor__step-line')
      .slice(0, 6)
      .map((line) => Number(line.getAttribute('y1'))))
      .toEqual([514.375, 508.75, 503.125, 491.875, 486.25, 480.625]);
  });

  it('renders the 50-yard line and both hash marks at their exact expected SVG pixel positions', () => {
    const fiftyLine = svg.querySelector('.field-editor__yard-line--fifty')!;
    expect(Number(fiftyLine.getAttribute('x1'))).toBe(490);
    expect(Number(fiftyLine.getAttribute('y1'))).toBe(520);
    expect(Number(fiftyLine.getAttribute('x2'))).toBe(490);
    expect(Number(fiftyLine.getAttribute('y2'))).toBe(40);

    const hashTicks = [...svg.querySelectorAll<SVGLineElement>('.field-editor__hash-tick')];
    const frontHashPixelY = 360;
    const backHashPixelY = 200;
    const frontTicks = hashTicks.filter((tick) => Number(tick.getAttribute('y1')) === frontHashPixelY);
    const backTicks = hashTicks.filter((tick) => Number(tick.getAttribute('y1')) === backHashPixelY);
    expect(frontTicks.length).toBeGreaterThan(0);
    expect(backTicks.length).toBeGreaterThan(0);
    // Every hash tick sits exactly on an independently asserted landmark row,
    // with no rounding drift in the rendered SVG.
    expect(hashTicks.every((tick) => {
      const y = Number(tick.getAttribute('y1'));
      return y === frontHashPixelY || y === backHashPixelY;
    })).toBe(true);
    expect(frontHashPixelY).toBeGreaterThan(backHashPixelY);
  });

  it('renders a dot for each performer with a canonical dot in the active set, labeled by rank code', () => {
    const dot1 = svg.querySelector('[data-performer-id="performer-1"]');
    const dot2 = svg.querySelector('[data-performer-id="performer-2"]');
    expect(dot1?.querySelector('text')?.textContent).toBe('P1');
    expect(dot2?.querySelector('text')?.textContent).toBe('P2');
    expect([...svg.querySelectorAll('.field-editor__yard-label, .field-editor__dot text')]
      .every((text) => text.getAttribute('transform') === null)).toBe(true);
  });

  it('dragging an existing dot to the lower rendered front moves it via dot.move, and undo/redo still work afterward', () => {
    editor.snapping.setEnabled(false);
    const dotGroup = svg.querySelector('[data-performer-id="performer-1"]')!;
    const startPixel = { x: 490, y: 280 };
    const endDot = { x: 60000, y: 0 };
    const endPixel = { x: 227.5, y: 520 };

    firePointerEvent(dotGroup, 'pointerdown', { clientX: startPixel.x, clientY: startPixel.y });
    firePointerEvent(svg, 'pointermove', { clientX: endPixel.x, clientY: endPixel.y });
    firePointerEvent(svg, 'pointerup', { clientX: endPixel.x, clientY: endPixel.y });

    const undoCommands = store.getUndoCommands();
    expect(undoCommands).toHaveLength(1);
    expect(undoCommands[0]).toMatchObject({ type: 'dot.move', performerId: 'performer-1' });
    expect(store.getState().document.sets[0]?.positions['performer-1']).toEqual(endDot);
    expect(commits).toBe(1);

    expect(store.canUndo()).toBe(true);
    const afterUndo = store.undo();
    expect(afterUndo?.document.sets[0]?.positions['performer-1']).toEqual({ x: 144000, y: 76800 });
    expect(store.canRedo()).toBe(true);
    const afterRedo = store.redo();
    expect(afterRedo?.document.sets[0]?.positions['performer-1']).toEqual(endDot);
  });

  it('does not commit a move when the browser cancels a drag sequence', () => {
    editor.snapping.setEnabled(false);
    const transform = createFieldTransform(store.getState().document.field);
    const dotGroup = svg.querySelector('[data-performer-id="performer-1"]')!;
    const startPixel = transform.toPixel({ x: 144000, y: 76800 });
    const cancelledTarget = transform.toPixel({ x: 60000, y: 40000 });

    firePointerEvent(dotGroup, 'pointerdown', { clientX: startPixel.x, clientY: startPixel.y });
    firePointerEvent(svg, 'pointermove', { clientX: cancelledTarget.x, clientY: cancelledTarget.y });
    firePointerEvent(svg, 'pointercancel', { clientX: cancelledTarget.x, clientY: cancelledTarget.y });

    expect(store.getUndoCommands()).toHaveLength(0);
    expect(store.getState().document.sets[0]?.positions['performer-1']).toEqual({ x: 144000, y: 76800 });
    expect(editor.root.querySelector('.field-editor__readout')?.textContent).toContain('Drag cancelled');
  });

  it('snaps a dragged position to exactly what snapToQuarterStepGrid produces by default', () => {
    const transform = createFieldTransform(store.getState().document.field);
    const dotGroup = svg.querySelector('[data-performer-id="performer-1"]')!;
    const startPixel = transform.toPixel({ x: 144000, y: 76800 });
    // An intentionally off-grid raw target; toFieldUnits rounds to the nearest FU.
    const rawTarget = { x: 61111, y: 39999 };
    const rawPixel = transform.toPixel(rawTarget);

    firePointerEvent(dotGroup, 'pointerdown', { clientX: startPixel.x, clientY: startPixel.y });
    firePointerEvent(svg, 'pointerup', { clientX: rawPixel.x, clientY: rawPixel.y });

    const committedDot = store.getState().document.sets[0]?.positions['performer-1'];
    expect(committedDot).toBeDefined();

    // Compute independently what the pixel->FU rounding produces, then assert
    // the committed dot equals snapToQuarterStepGrid applied to THAT raw dot —
    // proving the editor calls the shared function rather than approximating.
    const rawFieldUnitDot = transform.toFieldUnits(rawPixel);
    expect(committedDot).toEqual(snapToQuarterStepGrid(rawFieldUnitDot));
    // And it is not simply the unsnapped raw value (this drag is off-grid).
    expect(committedDot).not.toEqual(rawFieldUnitDot);
  });

  it('places a free, non-snapped position when the snap toggle is off', () => {
    editor.snapping.setEnabled(false);
    const transform = createFieldTransform(store.getState().document.field);
    const dotGroup = svg.querySelector('[data-performer-id="performer-1"]')!;
    const startPixel = transform.toPixel({ x: 144000, y: 76800 });
    const rawTarget = { x: 61111, y: 39999 };
    const rawPixel = transform.toPixel(rawTarget);

    firePointerEvent(dotGroup, 'pointerdown', { clientX: startPixel.x, clientY: startPixel.y });
    firePointerEvent(svg, 'pointerup', { clientX: rawPixel.x, clientY: rawPixel.y });

    const committedDot = store.getState().document.sets[0]?.positions['performer-1'];
    const rawFieldUnitDot = transform.toFieldUnits(rawPixel);
    expect(committedDot).toEqual(rawFieldUnitDot);
    expect(committedDot).not.toEqual(snapToQuarterStepGrid(rawFieldUnitDot));
  });

  it('shows a live derived-coordinate readout while dragging that matches inspectCoordinate, before commit', () => {
    const transform = createFieldTransform(store.getState().document.field);
    const dotGroup = svg.querySelector('[data-performer-id="performer-1"]')!;
    const startPixel = transform.toPixel({ x: 144000, y: 76800 });
    const dragTarget = { x: 115200, y: 51200 };
    const dragPixel = transform.toPixel(dragTarget);

    firePointerEvent(dotGroup, 'pointerdown', { clientX: startPixel.x, clientY: startPixel.y });
    firePointerEvent(svg, 'pointermove', { clientX: dragPixel.x, clientY: dragPixel.y });

    const readout = editor.root.querySelector('.field-editor__readout');
    expect(readout?.textContent).toContain(inspectCoordinate(dragTarget).notation);
    // Not yet committed to the store — still mid-drag.
    expect(store.getState().document.sets[0]?.positions['performer-1']).toEqual({ x: 144000, y: 76800 });
  });

  it('reflects snap-off in the live readout and matches inspectCoordinate for the raw cursor position', () => {
    editor.snapping.setEnabled(false);
    const transform = createFieldTransform(store.getState().document.field);
    const dotGroup = svg.querySelector('[data-performer-id="performer-1"]')!;
    const startPixel = transform.toPixel({ x: 144000, y: 76800 });
    const rawTarget = { x: 61111, y: 39999 };
    const dragPixel = transform.toPixel(rawTarget);

    firePointerEvent(dotGroup, 'pointerdown', { clientX: startPixel.x, clientY: startPixel.y });
    firePointerEvent(svg, 'pointermove', { clientX: dragPixel.x, clientY: dragPixel.y });

    const rawFieldUnitDot = transform.toFieldUnits(dragPixel);
    const readout = editor.root.querySelector('.field-editor__readout');
    expect(readout?.textContent).toContain(inspectCoordinate(rawFieldUnitDot).notation);
    expect(readout?.textContent).toContain('snap off');
  });

  it('clicking a field position moves the selected performer via dot.move and supports undo/redo', () => {
    editor.setActivePerformerId('performer-1');
    const originalDot = { x: 144000, y: 76800 };
    // Direct lower/upper SVG landmarks independently exercise the inverse
    // pointer conversion with snap-on default, not a test-side transform.
    const lowerFrontPixel = { x: 40, y: 520 };
    const upperBackPixel = { x: 940, y: 40 };

    firePointerEvent(svg, 'pointerdown', { clientX: lowerFrontPixel.x, clientY: lowerFrontPixel.y });
    firePointerEvent(svg, 'pointerup', { clientX: lowerFrontPixel.x, clientY: lowerFrontPixel.y });

    const undoCommands = store.getUndoCommands();
    expect(undoCommands).toHaveLength(1);
    expect(undoCommands[0]).toMatchObject({ type: 'dot.move', performerId: 'performer-1' });
    expect(store.getState().document.sets[0]?.positions['performer-1']).toEqual({ x: 0, y: 0 });
    expect(commits).toBe(1);

    firePointerEvent(svg, 'pointerdown', { clientX: upperBackPixel.x, clientY: upperBackPixel.y });
    firePointerEvent(svg, 'pointerup', { clientX: upperBackPixel.x, clientY: upperBackPixel.y });
    expect(store.getState().document.sets[0]?.positions['performer-1']).toEqual({ x: 288000, y: 153600 });
    expect(store.getUndoCommands()).toHaveLength(2);

    expect(store.undo()?.document.sets[0]?.positions['performer-1']).toEqual({ x: 0, y: 0 });
    expect(store.undo()?.document.sets[0]?.positions['performer-1']).toEqual(originalDot);
    expect(store.redo()?.document.sets[0]?.positions['performer-1']).toEqual({ x: 0, y: 0 });
    expect(store.redo()?.document.sets[0]?.positions['performer-1']).toEqual({ x: 288000, y: 153600 });
  });

  it('snaps a lower rendered off-grid pointer to the expected canonical quarter-step point', () => {
    editor.setActivePerformerId('performer-1');
    // At this physical SVG position, inverse conversion is (60800, 640) FU;
    // the established quarter-step snap result is (60750, 450) FU.
    firePointerEvent(svg, 'pointerdown', { clientX: 230, clientY: 518 });
    expect(store.getState().document.sets[0]?.positions['performer-1']).toEqual({ x: 60750, y: 450 });
  });

  it('does not mutate the document merely by rendering or refreshing the presentation orientation', () => {
    const before = structuredClone(store.getState().document);
    editor.refresh();
    expect(store.getState().document).toEqual(before);
    expect(store.getUndoCommands()).toHaveLength(0);
  });

  it('renders show-scoped and active-set-scoped annotations into the real static graphical field', () => {
    const withAnnotations: FreeformDocument = {
      ...store.getState().document,
      layers: [{ id: 'bottom', name: 'Bottom', visible: true, print: true, locked: false }],
      annotations: [
        {
          id: 'show-label', kind: 'label', layerId: 'bottom', scope: { kind: 'show' },
          visibility: { editor: true, print: true, performerPacket: false }, text: 'Show mark', anchor: { x: 1000, y: 2000 },
        },
        {
          id: 'set-label', kind: 'label', layerId: 'bottom', scope: { kind: 'set', setId: 'set-1' },
          visibility: { editor: true, print: true, performerPacket: false }, text: 'Set mark', anchor: { x: 3000, y: 4000 },
        },
      ],
    };
    const annotatedStore = createCommandStore(withAnnotations);
    const annotatedEditor = renderSvgFieldEditor({
      store: annotatedStore,
      setStatus: () => undefined,
      onCommitted: () => undefined,
    });
    const annotatedSvg = annotatedEditor.root.querySelector('svg')!;
    const ids = [...annotatedSvg.querySelectorAll('[data-annotation-id]')].map((node) => node.getAttribute('data-annotation-id'));
    expect(ids.sort()).toEqual(['set-label', 'show-label']);
    // Dot rendering and performer coordinates remain unaffected by the overlay.
    expect(annotatedSvg.querySelector('[data-performer-id="performer-1"]')).not.toBeNull();
  });
});
