import type { CommandStore, Dot, FreeformDocument, Identifier } from '../document/types';
import { snapToQuarterStepGrid } from '../geometry/coordinate-builder';
import { FU_PER_STEP, inspectCoordinate, isValidDot, NFHS_11_PLAYER_FIELD } from '../geometry/nfhs';
import { createFieldTransform, type FieldTransform, type PixelPoint } from './field-geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Field-only label formatting; coordinate inspection keeps its normative side-prefixed labels. */
function yardNumberLabel(x: number, field: FreeformDocument['field']): string {
  const yardsFromSideOne = x / field.unitsPerYard;
  const totalYards = field.lengthUnits / field.unitsPerYard;
  return String(Math.min(yardsFromSideOne, totalYards - yardsFromSideOne));
}

export interface SvgFieldEditorOptions {
  readonly store: CommandStore;
  /** Reports status text the same way the structured form does. */
  readonly setStatus: (message: string) => void;
  /** Called after every store mutation so the host view (forms, tables) re-renders. */
  readonly onCommitted: () => void;
}

export interface SvgFieldEditor {
  readonly root: HTMLElement;
  /** Re-reads store state and the current set/performer selection and redraws. */
  refresh(): void;
  /** The set the graphical editor is currently placing/moving dots within. */
  getActiveSetId(): Identifier;
  setActiveSetId(setId: Identifier): void;
  /** The performer the next field click will move. */
  getActivePerformerId(): Identifier | undefined;
  setActivePerformerId(performerId: Identifier | undefined): void;
  readonly snapping: {
    isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
  };
}

interface DragState {
  readonly performerId: Identifier;
  readonly pointerId: number;
}

/**
 * Renders the interactive SVG field. This module owns no document state: every
 * every move crosses through `store.apply` with `dot.move`,
 * matching the structured form's boundary (M1 decision record; see also
 * `decisions/2026-09-30-svg-field-transform.md`). SVG pixel coordinates never
 * leave this module as persisted state — `toFieldUnits`/`snapToQuarterStepGrid`
 * convert back to canonical FU before every `store.apply` call.
 */
export function renderSvgFieldEditor(options: SvgFieldEditorOptions): SvgFieldEditor {
  const { store, setStatus, onCommitted } = options;

  let activeSetId = store.getState().document.sets[0]?.id ?? '';
  let activePerformerId: Identifier | undefined = store.getState().document.performers[0]?.id;
  let snappingEnabled = true;
  let drag: DragState | undefined;
  let transform: FieldTransform = createFieldTransform(NFHS_11_PLAYER_FIELD);

  const root = document.createElement('div');
  root.className = 'field-editor';

  const readout = document.createElement('p');
  readout.className = 'field-editor__readout';
  readout.setAttribute('role', 'status');
  readout.setAttribute('aria-live', 'polite');
  readout.textContent = 'Click a field position to move the selected performer, or drag an existing dot.';

  const toolbar = document.createElement('div');
  toolbar.className = 'field-editor__toolbar';

  const setSelectLabel = document.createElement('label');
  setSelectLabel.textContent = 'Set';
  const setSelect = document.createElement('select');
  setSelect.setAttribute('aria-label', 'Active set for the field editor');
  setSelect.id = 'field-editor-set';
  setSelectLabel.htmlFor = setSelect.id;
  setSelect.addEventListener('change', () => {
    activeSetId = setSelect.value;
    drawField();
  });

  const performerSelectLabel = document.createElement('label');
  performerSelectLabel.textContent = 'Performer to move';
  const performerSelect = document.createElement('select');
  performerSelect.setAttribute('aria-label', 'Performer the next field click moves');
  performerSelect.id = 'field-editor-performer';
  performerSelectLabel.htmlFor = performerSelect.id;
  performerSelect.addEventListener('change', () => {
    activePerformerId = performerSelect.value || undefined;
  });

  toolbar.append(setSelectLabel, setSelect, performerSelectLabel, performerSelect);

  const snapLabel = document.createElement('label');
  snapLabel.className = 'field-editor__snap-toggle';
  const snapCheckbox = document.createElement('input');
  snapCheckbox.type = 'checkbox';
  snapCheckbox.checked = snappingEnabled;
  snapCheckbox.id = 'field-snap-toggle';
  snapCheckbox.addEventListener('change', () => {
    snappingEnabled = snapCheckbox.checked;
  });
  const snapLabelText = document.createElement('span');
  snapLabelText.textContent = 'Snap to quarter-step grid';
  snapLabel.append(snapCheckbox, snapLabelText);
  snapLabel.htmlFor = snapCheckbox.id;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'field-editor__svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'NFHS 11-player field with performer dots. Use the dot editor form and inspection table below for keyboard and screen-reader placement.');

  root.append(toolbar, snapLabel, svg, readout);

  const dotElementsByPerformerId = new Map<Identifier, SVGGElement>();

  function currentSet() {
    return store.getState().document.sets.find((set) => set.id === activeSetId);
  }

  function syncToolbar(): void {
    const documentState = store.getState().document;
    setSelect.replaceChildren();
    documentState.sets.forEach((set) => {
      const option = document.createElement('option');
      option.value = set.id;
      option.textContent = set.name;
      setSelect.append(option);
    });
    setSelect.value = activeSetId;

    performerSelect.replaceChildren();
    documentState.performers.forEach((performer) => {
      const option = document.createElement('option');
      option.value = performer.id;
      option.textContent = `${performer.rankCode} — ${performer.displayName}`;
      performerSelect.append(option);
    });
    if (activePerformerId) performerSelect.value = activePerformerId;
  }

  function drawField(): void {
    syncToolbar();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    dotElementsByPerformerId.clear();

    const field = store.getState().document.field;
    transform = createFieldTransform(field);
    svg.setAttribute('viewBox', transform.viewBox);
    svg.setAttribute('width', String(transform.widthPx));
    svg.setAttribute('height', String(transform.heightPx));

    const topLeft = transform.toPixel({ x: 0, y: 0 });
    const bottomRight = transform.toPixel({ x: field.lengthUnits, y: field.widthUnits });

    const yardLineUnits = field.unitsPerYard * 5;
    const halfYardLineUnits = yardLineUnits / 2;
    const horizontalHalfStepUnits = FU_PER_STEP * 4;

    function appendStepLine(start: Dot, end: Dot, isHalfLine: boolean): void {
      const startPixel = transform.toPixel(start);
      const endPixel = transform.toPixel(end);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', isHalfLine ? 'field-editor__step-line--half' : 'field-editor__step-line');
      line.setAttribute('x1', String(startPixel.x));
      line.setAttribute('y1', String(startPixel.y));
      line.setAttribute('x2', String(endPixel.x));
      line.setAttribute('y2', String(endPixel.y));
      svg.append(line);
    }

    // Lay down the full 8-to-5 grid before the field landmarks so the heavier
    // yard lines, hash marks, and performer dots stay visually prominent.
    for (let x = FU_PER_STEP; x < field.lengthUnits; x += FU_PER_STEP) {
      if (x % yardLineUnits === 0) continue;
      appendStepLine(
        { x, y: 0 },
        { x, y: field.widthUnits },
        x % yardLineUnits === halfYardLineUnits,
      );
    }
    for (let y = 0; y <= field.widthUnits; y += FU_PER_STEP) {
      appendStepLine(
        { x: 0, y },
        { x: field.lengthUnits, y },
        y % horizontalHalfStepUnits === 0,
      );
    }

    const boundary = document.createElementNS(SVG_NS, 'rect');
    boundary.setAttribute('class', 'field-editor__boundary');
    boundary.setAttribute('x', String(topLeft.x));
    boundary.setAttribute('y', String(topLeft.y));
    boundary.setAttribute('width', String(bottomRight.x - topLeft.x));
    boundary.setAttribute('height', String(bottomRight.y - topLeft.y));
    svg.append(boundary);

    for (let yard = 0; yard <= 100; yard += 5) {
      const x = yard * field.unitsPerYard;
      const top = transform.toPixel({ x, y: 0 });
      const bottom = transform.toPixel({ x, y: field.widthUnits });
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', yard === 50 ? 'field-editor__yard-line field-editor__yard-line--fifty' : 'field-editor__yard-line');
      line.setAttribute('x1', String(top.x));
      line.setAttribute('y1', String(top.y));
      line.setAttribute('x2', String(bottom.x));
      line.setAttribute('y2', String(bottom.y));
      svg.append(line);

      const labelText = yardNumberLabel(x, field);
      for (const labelY of [top.y - 6, bottom.y + 16]) {
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('class', 'field-editor__yard-label');
        label.setAttribute('x', String(top.x));
        label.setAttribute('y', String(labelY));
        label.setAttribute('text-anchor', 'middle');
        label.textContent = labelText;
        svg.append(label);
      }
    }

    for (const hashY of [field.frontHashY, field.backHashY]) {
      for (let yard = 0; yard < 100; yard += 1) {
        const x0 = yard * field.unitsPerYard;
        const x1 = x0 + field.unitsPerYard * 0.5;
        if (x1 > field.lengthUnits) continue;
        const start = transform.toPixel({ x: x0 + field.unitsPerYard * 0.25, y: hashY });
        const end = transform.toPixel({ x: x1, y: hashY });
        const tick = document.createElementNS(SVG_NS, 'line');
        tick.setAttribute('class', 'field-editor__hash-tick');
        tick.setAttribute('x1', String(start.x));
        tick.setAttribute('y1', String(start.y));
        tick.setAttribute('x2', String(end.x));
        tick.setAttribute('y2', String(end.y));
        svg.append(tick);
      }
    }

    const set = currentSet();
    const documentState = store.getState().document;
    if (set) {
      for (const performer of documentState.performers) {
        const dot = set.positions[performer.id];
        if (!dot) continue;
        svg.append(createDotElement(performer.id, performer.rankCode, dot));
      }
    }
  }

  function createDotElement(performerId: Identifier, rankCode: string, dot: Dot): SVGGElement {
    const point = transform.toPixel(dot);
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'field-editor__dot');
    group.setAttribute('data-performer-id', performerId);
    group.setAttribute('tabindex', '-1');

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(point.x));
    circle.setAttribute('cy', String(point.y));
    circle.setAttribute('r', '9');
    group.append(circle);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(point.x));
    label.setAttribute('y', String(point.y + 3));
    label.setAttribute('text-anchor', 'middle');
    label.textContent = rankCode;
    group.append(label);

    dotElementsByPerformerId.set(performerId, group);
    return group;
  }

  function moveDotElement(performerId: Identifier, dot: Dot): void {
    const group = dotElementsByPerformerId.get(performerId);
    if (!group) return;
    const point = transform.toPixel(dot);
    const circle = group.querySelector('circle');
    const label = group.querySelector('text');
    circle?.setAttribute('cx', String(point.x));
    circle?.setAttribute('cy', String(point.y));
    label?.setAttribute('x', String(point.x));
    label?.setAttribute('y', String(point.y + 3));
  }

  function clientPointToSvgPoint(event: PointerEvent): PixelPoint {
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width > 0 ? transform.widthPx / rect.width : 1;
    const scaleY = rect.height > 0 ? transform.heightPx / rect.height : 1;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function resolveDragDot(event: PointerEvent): Dot {
    const rawDot = transform.toFieldUnits(clientPointToSvgPoint(event));
    return snappingEnabled ? snapToQuarterStepGrid(rawDot) : rawDot;
  }

  function handleSvgPointerDown(event: PointerEvent): void {
    const target = event.target as Element | null;
    const dotGroup = target?.closest<SVGGElement>('[data-performer-id]');
    if (!dotGroup) {
      handleFieldClick(event);
      return;
    }
    const performerId = dotGroup.getAttribute('data-performer-id');
    if (!performerId) return;
    drag = { performerId, pointerId: event.pointerId };
    svg.setPointerCapture?.(event.pointerId);
    updateReadout(resolveDragDot(event));
    event.preventDefault();
  }

  function handleSvgPointerMove(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dot = resolveDragDot(event);
    moveDotElement(drag.performerId, dot);
    updateReadout(dot);
  }

  function handleSvgPointerUp(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const performerId = drag.performerId;
    const dot = resolveDragDot(event);
    drag = undefined;
    svg.releasePointerCapture?.(event.pointerId);
    commitDot(performerId, dot);
  }

  function handleSvgPointerCancel(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = undefined;
    svg.releasePointerCapture?.(event.pointerId);
    // A cancelled pointer sequence has no user-confirmed drop location. Restore
    // the visual from canonical store state rather than turning cancellation
    // into an accidental dot.move command.
    drawField();
    readout.textContent = 'Drag cancelled; dot position unchanged.';
  }

  function handleFieldClick(event: PointerEvent): void {
    if (!activePerformerId) {
      setStatus('Choose a performer before moving a dot on the field.');
      return;
    }
    const dot = resolveDragDot(event);
    commitDot(activePerformerId, dot);
  }

  function commitDot(performerId: Identifier, dot: Dot): void {
    if (!isValidDot(dot)) {
      setStatus('That position is outside the field bounds.');
      drawField();
      return;
    }
    try {
      store.apply({
        type: 'dot.move',
        setId: activeSetId,
        performerId,
        dot,
      });
      setStatus(`Moved dot at (${dot.x}, ${dot.y}) FU via the field.`);
      onCommitted();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not update the dot.');
      drawField();
    }
  }

  function updateReadout(dot: Dot): void {
    if (!isValidDot(dot)) {
      readout.textContent = 'Outside the field — release to cancel.';
      return;
    }
    const inspection = inspectCoordinate(dot);
    readout.textContent = `(${dot.x}, ${dot.y}) FU — ${inspection.notation}${snappingEnabled ? '' : ' (snap off)'}`;
  }

  drawField();
  svg.addEventListener('pointerdown', handleSvgPointerDown);
  svg.addEventListener('pointermove', handleSvgPointerMove);
  svg.addEventListener('pointerup', handleSvgPointerUp);
  svg.addEventListener('pointercancel', handleSvgPointerCancel);

  return {
    root,
    refresh() {
      const state = store.getState();
      if (!state.document.sets.some((set) => set.id === activeSetId)) {
        activeSetId = state.document.sets[0]?.id ?? '';
      }
      if (activePerformerId && !state.document.performers.some((performer) => performer.id === activePerformerId)) {
        activePerformerId = state.document.performers[0]?.id;
      }
      drawField();
    },
    getActiveSetId: () => activeSetId,
    setActiveSetId(setId) {
      activeSetId = setId;
      drawField();
    },
    getActivePerformerId: () => activePerformerId,
    setActivePerformerId(performerId) {
      activePerformerId = performerId;
      syncToolbar();
    },
    snapping: {
      isEnabled: () => snappingEnabled,
      setEnabled(enabled) {
        snappingEnabled = enabled;
        snapCheckbox.checked = enabled;
      },
    },
  };
}
