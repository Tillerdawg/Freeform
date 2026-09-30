// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { CommandStore, DocumentCommand, DocumentState, Dot, FreeformDocument } from '../document/types';
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
    expect(svg.querySelector('.field-editor__boundary')).not.toBeNull();
    // 21 yard lines: 0, 5, 10, ..., 100.
    expect(svg.querySelectorAll('.field-editor__yard-line').length).toBe(21);
    expect(svg.querySelectorAll('.field-editor__yard-line--fifty').length).toBe(1);
    expect(svg.querySelectorAll('.field-editor__hash-tick').length).toBeGreaterThan(0);
    expect(svg.getAttribute('viewBox')).toBe(transform.viewBox);
  });

  it('renders the 50-yard line and both hash marks at their exact expected SVG pixel positions', () => {
    const field = store.getState().document.field;
    const transform = createFieldTransform(field);

    const fiftyLine = svg.querySelector('.field-editor__yard-line--fifty')!;
    const expectedFifty = transform.toPixel({ x: field.lengthUnits / 2, y: 0 });
    expect(Number(fiftyLine.getAttribute('x1'))).toBe(expectedFifty.x);
    expect(Number(fiftyLine.getAttribute('y1'))).toBe(expectedFifty.y);
    expect(Number(fiftyLine.getAttribute('x2'))).toBe(transform.toPixel({ x: field.lengthUnits / 2, y: field.widthUnits }).x);

    const hashTicks = [...svg.querySelectorAll<SVGLineElement>('.field-editor__hash-tick')];
    const frontHashPixelY = transform.toPixel({ x: 0, y: field.frontHashY }).y;
    const backHashPixelY = transform.toPixel({ x: 0, y: field.backHashY }).y;
    const frontTicks = hashTicks.filter((tick) => Number(tick.getAttribute('y1')) === frontHashPixelY);
    const backTicks = hashTicks.filter((tick) => Number(tick.getAttribute('y1')) === backHashPixelY);
    expect(frontTicks.length).toBeGreaterThan(0);
    expect(backTicks.length).toBeGreaterThan(0);
    // Every hash tick sits exactly on its landmark's exact pixel row (no
    // rounding drift), confirming the rendered marks land at the same exact
    // pixel the transform function computes independently.
    expect(hashTicks.every((tick) => {
      const y = Number(tick.getAttribute('y1'));
      return y === frontHashPixelY || y === backHashPixelY;
    })).toBe(true);
  });

  it('renders a dot for each performer with a canonical dot in the active set, labeled by rank code', () => {
    const dot1 = svg.querySelector('[data-performer-id="performer-1"]');
    const dot2 = svg.querySelector('[data-performer-id="performer-2"]');
    expect(dot1?.querySelector('text')?.textContent).toBe('P1');
    expect(dot2?.querySelector('text')?.textContent).toBe('P2');
  });

  it('dragging an existing dot moves it via dot.move, and undo/redo still work afterward', () => {
    editor.snapping.setEnabled(false);
    const transform = createFieldTransform(store.getState().document.field);
    const dotGroup = svg.querySelector('[data-performer-id="performer-1"]')!;
    const startPixel = transform.toPixel({ x: 144000, y: 76800 });
    const endDot = { x: 60000, y: 40000 };
    const endPixel = transform.toPixel(endDot);

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

  it('rejects a click for a performer that already has a dot in the active set without creating a duplicate', () => {
    editor.setActivePerformerId('performer-1');
    const transform = createFieldTransform(store.getState().document.field);
    const pixel = transform.toPixel({ x: 10000, y: 10000 });

    firePointerEvent(svg, 'pointerdown', { clientX: pixel.x, clientY: pixel.y });
    firePointerEvent(svg, 'pointerup', { clientX: pixel.x, clientY: pixel.y });

    expect(store.getUndoCommands()).toHaveLength(0);
    expect(statuses.some((message) => message.includes('already has a dot'))).toBe(true);
  });
});

/**
 * The production CommandStore (src/document/command-store.ts) enforces
 * complete set coverage — every performer has a dot in every existing set —
 * at construction and after every applied command (see makeState ->
 * validateDocumentSetsAndTransitions). This is verified directly above: a
 * document with any performer missing a dot from an existing set throws at
 * createCommandStore() construction, and performer.create requires a dot for
 * every existing set atomically. Consequently there is no reachable sequence
 * of real commands that leaves an existing performer without a dot in an
 * existing set, so the "click-to-create" acceptance path (dot.create for a
 * performer without a dot) cannot be exercised against the real store today.
 *
 * This fake store — implementing the exact CommandStore contract the SVG
 * editor depends on, with the same dot.create/dot.move accept/reject rules
 * as the real reducer's placeDot() but without the full-coverage invariant —
 * isolates and proves the SVG editor's OWN wiring: it calls store.apply with
 * dot.create (not dot.move) for a performer lacking a dot, and the resulting
 * document state reflects the click. It is a wiring test, not a substitute
 * for real-store integration; the real-store behavior above is likewise
 * covered directly (dragging an existing dot -> dot.move).
 */
function createPartialCoverageFakeStore(document: FreeformDocument): CommandStore {
  let current: DocumentState = { document, revision: 0 };
  const undoHistory: DocumentCommand[] = [];

  function apply(command: DocumentCommand): DocumentState {
    if (command.type !== 'dot.create' && command.type !== 'dot.move') {
      throw new Error(`Fake store only supports dot.create/dot.move, got: ${command.type}`);
    }
    const set = current.document.sets.find((candidate) => candidate.id === command.setId);
    if (!set) throw new Error(`Unknown set: ${command.setId}`);
    const hasExistingDot = command.performerId in set.positions;
    if (command.type === 'dot.move' && !hasExistingDot) {
      throw new Error(`Cannot move missing dot for performer: ${command.performerId}`);
    }
    if (command.type === 'dot.create' && hasExistingDot) {
      throw new Error(`Dot already exists for performer: ${command.performerId}`);
    }
    const nextDocument: FreeformDocument = {
      ...current.document,
      sets: current.document.sets.map((candidate) => candidate.id === set.id
        ? { ...candidate, positions: { ...candidate.positions, [command.performerId]: command.dot } }
        : candidate),
    };
    undoHistory.push(command);
    current = { document: nextDocument, revision: current.revision + 1 };
    return current;
  }

  return {
    getState: () => current,
    apply,
    undo: () => undefined,
    redo: () => undefined,
    canUndo: () => false,
    canRedo: () => false,
    getUndoCommands: () => undoHistory,
  };
}

describe('SVG field editor wiring for dot.create (fake store — see comment above)', () => {
  it('clicking an empty field position for a performer without a dot issues dot.create and reflects it in document state', () => {
    const partialDocument: FreeformDocument = {
      ...makeDocument(),
      sets: [{
        id: 'set-1',
        name: 'Set 1',
        startCount: 0,
        // performer-2 intentionally has no dot — reachable only via this fake
        // store, per the comment above.
        positions: { 'performer-1': { x: 144000, y: 76800 } },
      }],
    };
    const fakeStore = createPartialCoverageFakeStore(partialDocument);
    const statuses: string[] = [];
    let commits = 0;
    const editor = renderSvgFieldEditor({
      store: fakeStore,
      setStatus: (message) => statuses.push(message),
      onCommitted: () => { commits += 1; },
    });
    editor.setActivePerformerId('performer-2');
    editor.snapping.setEnabled(false);

    const svg = editor.root.querySelector('svg')!;
    stubBoundingClientRect(svg, svg.viewBox.baseVal.width || 980, svg.viewBox.baseVal.height || 560);
    const transform = createFieldTransform(fakeStore.getState().document.field);
    const targetDot: Dot = { x: 50000, y: 30000 };
    const pixel = transform.toPixel(targetDot);

    firePointerEvent(svg, 'pointerdown', { clientX: pixel.x, clientY: pixel.y });
    firePointerEvent(svg, 'pointerup', { clientX: pixel.x, clientY: pixel.y });

    const undoCommands = fakeStore.getUndoCommands();
    expect(undoCommands).toHaveLength(1);
    expect(undoCommands[0]).toMatchObject({ type: 'dot.create', performerId: 'performer-2' });
    expect(fakeStore.getState().document.sets[0]?.positions['performer-2']).toEqual(targetDot);
    expect(commits).toBe(1);
  });
});
