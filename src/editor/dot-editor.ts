import type { CommandStore, Dot } from '../document/types';
import {
  buildCoordinate,
  formatYardLine,
  parseQuarterSteps,
  type HorizontalCoordinateInput,
} from '../geometry/coordinate-builder';
import { inspectCoordinate, NFHS_11_PLAYER_FIELD } from '../geometry/nfhs';
import type { FeatureReport } from '../platform/features';
import { renderSvgFieldEditor, type SvgFieldEditor } from './svg-field-editor';
import { createTimelinePanel } from '../timeline/timeline-panel';

export interface DotEditorOptions {
  readonly store: CommandStore;
  readonly report: FeatureReport;
}

/** The string and checkbox values collected by the structured dot form. */
export interface DotEditorCoordinateValues {
  readonly useRawFu: boolean;
  readonly x: string;
  readonly y: string;
  readonly horizontalMode: string;
  readonly side: string;
  readonly lineYard: string;
  readonly splittingLower: string;
  readonly splittingHigher: string;
  readonly horizontalSteps: string;
  readonly horizontalDirection: 'Inside' | 'Outside';
  readonly horizontalFiftySide: 'side-1' | 'side-2';
  readonly verticalMode: string;
  readonly landmark: string;
  readonly verticalSteps: string;
  readonly verticalDirection: 'In Front Of' | 'Behind';
}

/** Converts browser form values to the canonical dot sent to the command store. */
export function buildDotFromEditorValues(values: DotEditorCoordinateValues): Dot {
  if (values.useRawFu) return rawDot(values.x, values.y);

  return buildCoordinate({
    horizontal: horizontalInput(
      values.horizontalMode,
      values.side,
      values.lineYard,
      values.splittingLower,
      values.splittingHigher,
      values.horizontalSteps,
      values.horizontalDirection,
      values.horizontalFiftySide,
    ),
    vertical: values.verticalMode === 'landmark'
      ? { kind: 'landmark', landmark: values.landmark as 'Front Sideline' | 'Front Hash' | 'Back Hash' | 'Back Sideline' }
      : {
        kind: 'offset',
        landmark: values.landmark as 'Front Sideline' | 'Front Hash' | 'Back Hash' | 'Back Sideline',
        quarterSteps: parseQuarterSteps(values.verticalSteps),
        direction: values.verticalDirection,
      },
  });
}

/**
 * A small DOM-only M2 editor. It deliberately exposes canonical FU entry rather
 * than a pixel coordinate so every placement crosses the document-command boundary.
 */
export function renderDotEditor(root: HTMLElement, { store, report }: DotEditorOptions): void {
  let message = '';
  const setMessage = (nextMessage: string): void => { message = nextMessage; };

  const fieldEditor: SvgFieldEditor = renderSvgFieldEditor({
    store,
    setStatus: (nextMessage) => { message = nextMessage; render(); },
    onCommitted: () => render(),
  });

  const render = (): void => {
    const state = store.getState();
    const document = state.document;
    root.dataset.support = String(report.supported);
    root.replaceChildren();

    const shell = element('section', 'app-shell');
    const header = element('header');
    header.append(
      textElement('p', 'eyebrow', 'Freeform · M4 FTL paths and timeline'),
      textElement('h1', undefined, 'Freeform'),
      textElement('p', 'subtitle', 'Canonical NFHS coordinates, complete sets, and count-by-count float or FTL playback.'),
    );
    shell.append(header);

    const capability = element('section', `capability ${report.supported ? 'capability--ready' : 'capability--blocked'}`);
    capability.setAttribute('aria-labelledby', 'capability-title');
    capability.setAttribute('role', 'status');
    capability.append(textElement('h2', undefined, 'Browser compatibility'));
    report.messages.forEach((entry) => capability.append(textElement('p', undefined, entry)));
    shell.append(capability);

    const editor = element('section');
    editor.setAttribute('aria-labelledby', 'dot-editor-title');
    const editorTitle = textElement('h2', undefined, 'Dot editor');
    editorTitle.id = 'dot-editor-title';
    editor.append(
      editorTitle,
      textElement(
        'p',
        'muted',
        `NFHS_11_PLAYER · x 0–${NFHS_11_PLAYER_FIELD.lengthUnits} FU · y 0–${NFHS_11_PLAYER_FIELD.widthUnits} FU`,
      ),
      textElement('p', 'muted', `${document.show.title} · revision ${state.revision}`),
    );

    fieldEditor.refresh();
    const fieldSection = element('section');
    fieldSection.setAttribute('aria-labelledby', 'field-editor-title');
    const fieldTitle = textElement('h3', undefined, 'Graphical field placement');
    fieldTitle.id = 'field-editor-title';
    fieldSection.append(
      fieldTitle,
      textElement(
        'p',
        'muted',
        'Click an empty field position to place the selected performer\u2019s dot, or drag an existing dot to move it. The structured form below remains available for exact keyboard entry.',
      ),
      fieldEditor.root,
    );
    editor.append(fieldSection);

    const controls = element('div', 'editor-controls');
    controls.append(createPerformerForm(render, setMessage), createDotForm(render, setMessage));
    editor.append(controls);

    const history = element('p', 'history-controls');
    const undo = button('Undo', () => {
      store.undo();
      setMessage('Undid the most recent document command.');
      render();
    });
    undo.disabled = !store.canUndo();
    const redo = button('Redo', () => {
      store.redo();
      setMessage('Redid the most recent document command.');
      render();
    });
    redo.disabled = !store.canRedo();
    history.append(undo, redo);
    editor.append(history);
    editor.append(timeline.render());

    if (message) editor.append(textElement('p', 'editor-message', message, 'status'));
    editor.append(createInspectionTable());
    shell.append(editor);
    root.append(shell);
  };

  const timeline = createTimelinePanel(store, render, setMessage);
  root.addEventListener('keydown', (event) => timeline.handleKeyDown(event));

  const createPerformerForm = (rerender: () => void, setStatus: (message: string) => void): HTMLFormElement => {
    const form = element('form', 'editor-form');
    form.append(textElement('h3', undefined, 'Create performer'));
    const rankCode = input('rank-code', 'Rank code', 'text');
    rankCode.required = true;
    rankCode.pattern = '[A-Za-z][A-Za-z0-9_-]{0,31}';
    rankCode.maxLength = 32;
    const displayName = input('display-name', 'Display name', 'text');
    displayName.required = true;
    displayName.maxLength = 120;
    form.append(
      labelFor(rankCode, 'Rank code'), rankCode,
      labelFor(displayName, 'Display name'), displayName,
      submit('Create performer'),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = rankCode.value.trim();
      const name = displayName.value.trim();
      try {
        store.apply({
          type: 'performer.create',
          performer: { id: `performer-${code.toLowerCase()}`, rankCode: code, displayName: name },
          positionsBySet: Object.fromEntries(store.getState().document.sets.map((set) => [
            set.id,
            { x: 144000, y: 76800 },
          ])),
        });
        setStatus(`Created performer ${code} at the field center in every set. Move its dots with integer FU values.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not create performer.');
      }
      rerender();
    });
    return form;
  };

  const createDotForm = (rerender: () => void, setStatus: (message: string) => void): HTMLFormElement => {
    const form = element('form', 'editor-form');
    form.append(textElement('h3', undefined, 'Place or move dot'));
    const setId = select('set-id', 'Set', store.getState().document.sets.map((set) => ({ value: set.id, label: set.name })));
    const performerId = select(
      'performer-id',
      'Performer',
      store.getState().document.performers.map((performer) => ({ value: performer.id, label: `${performer.rankCode} — ${performer.displayName}` })),
    );
    const horizontalMode = select('horizontal-mode', 'Horizontal placement', [
      { value: 'line', label: 'On yard line' },
      { value: 'splitting', label: 'Splitting adjacent lines' },
      { value: 'offset', label: 'Inside / Outside yard line' },
    ]);
    const side = select('horizontal-side', 'Side', [
      { value: 'side-1', label: 'Side 1' },
      { value: 'side-2', label: 'Side 2' },
      { value: '50', label: '50' },
    ]);
    const lineYard = select('horizontal-yard-line', 'Yard line', yardOptions(0, 45));
    const splittingLower = select('splitting-lower-line', 'Splitting line nearer Side 1', fieldLineOptions(0, 95));
    const splittingHigher = select('splitting-higher-line', 'Splitting line nearer Side 2', fieldLineOptions(5, 100));
    splittingLower.value = '40';
    splittingHigher.value = '45';
    const horizontalSteps = input('horizontal-steps', 'Steps', 'number');
    horizontalSteps.min = '0.25';
    horizontalSteps.step = '0.25';
    horizontalSteps.value = '1';
    const inside = radio('horizontal-direction', 'Inside', 'Inside', true);
    const outside = radio('horizontal-direction', 'Outside', 'Outside');
    const horizontalStepControls = element('div');
    horizontalStepControls.append(labelFor(horizontalSteps, 'Steps (multiples of 0.25)'), horizontalSteps);
    const horizontalDirectionControls = element('div');
    horizontalDirectionControls.append(
      textElement('p', 'muted', 'Direction'),
      labelFor(inside, 'Inside'), inside,
      labelFor(outside, 'Outside'), outside,
    );
    const horizontalOffsetControls = element('div');
    horizontalOffsetControls.append(horizontalStepControls, horizontalDirectionControls);
    const splittingControls = element('div');
    splittingControls.append(
      labelFor(splittingLower, 'Splitting line nearer Side 1'), splittingLower,
      labelFor(splittingHigher, 'Splitting line nearer Side 2'), splittingHigher,
    );
    const yardLineControls = element('div');
    yardLineControls.append(labelFor(lineYard, 'Yard line'), lineYard);
    const singleLineControls = element('div');
    singleLineControls.append(labelFor(side, 'Side'), side, yardLineControls);
    const fiftySide = select('horizontal-fifty-side', 'Side from 50', [
      { value: 'side-1', label: 'Side 1' },
      { value: 'side-2', label: 'Side 2' },
    ]);
    const fiftyOffsetControls = element('div');
    fiftyOffsetControls.append(labelFor(fiftySide, 'Side from 50'), fiftySide);

    const verticalMode = select('vertical-mode', 'Vertical placement', [
      { value: 'landmark', label: 'On landmark' },
      { value: 'offset', label: 'In Front Of / Behind landmark' },
    ]);
    const landmark = select('vertical-landmark', 'Landmark', [
      { value: 'Front Sideline', label: 'Front Sideline' },
      { value: 'Front Hash', label: 'Front Hash' },
      { value: 'Back Hash', label: 'Back Hash' },
      { value: 'Back Sideline', label: 'Back Sideline' },
    ]);
    landmark.value = 'Front Hash';
    const verticalSteps = input('vertical-steps', 'Steps', 'number');
    verticalSteps.min = '0.25';
    verticalSteps.step = '0.25';
    verticalSteps.value = '1';
    const inFrontOf = radio('vertical-direction', 'In Front Of', 'In Front Of', true);
    const behind = radio('vertical-direction', 'Behind', 'Behind');
    const verticalOffsetControls = element('div');
    verticalOffsetControls.append(
      labelFor(verticalSteps, 'Steps (multiples of 0.25)'), verticalSteps,
      textElement('p', 'muted', 'Direction'),
      labelFor(inFrontOf, 'In Front Of'), inFrontOf,
      labelFor(behind, 'Behind'), behind,
    );

    const advanced = element('details');
    advanced.append(textElement('summary', undefined, 'Advanced: exact raw FU entry'));
    const useRawFu = input('use-raw-fu', 'Use raw FU entry', 'checkbox');
    const x = input('dot-x', 'X (FU)', 'number');
    x.min = '0';
    x.max = String(NFHS_11_PLAYER_FIELD.lengthUnits);
    x.step = '1';
    const y = input('dot-y', 'Y (FU)', 'number');
    y.min = '0';
    y.max = String(NFHS_11_PLAYER_FIELD.widthUnits);
    y.step = '1';
    advanced.append(
      labelFor(useRawFu, 'Use raw FU instead of the derived coordinate'), useRawFu,
      labelFor(x, 'X (FU)'), x,
      labelFor(y, 'Y (FU)'), y,
    );

    const updateVisibleControls = (): void => {
      singleLineControls.hidden = horizontalMode.value === 'splitting';
      splittingControls.hidden = horizontalMode.value !== 'splitting';
      horizontalOffsetControls.hidden = horizontalMode.value !== 'offset';
      verticalOffsetControls.hidden = verticalMode.value !== 'offset';
      const fiftyOffset = horizontalMode.value === 'offset' && side.value === '50';
      yardLineControls.hidden = side.value === '50';
      horizontalOffsetControls.hidden = horizontalMode.value !== 'offset';
      horizontalDirectionControls.hidden = fiftyOffset;
      fiftyOffsetControls.hidden = !fiftyOffset;
    };
    horizontalMode.addEventListener('change', updateVisibleControls);
    side.addEventListener('change', updateVisibleControls);
    verticalMode.addEventListener('change', updateVisibleControls);

    form.append(
      labelFor(setId, 'Set'), setId,
      labelFor(performerId, 'Performer'), performerId,
      textElement('h4', undefined, 'Derived coordinate'),
      labelFor(horizontalMode, 'Horizontal placement'), horizontalMode,
      singleLineControls,
      splittingControls,
      horizontalOffsetControls,
      fiftyOffsetControls,
      labelFor(verticalMode, 'Vertical placement'), verticalMode,
      labelFor(landmark, 'Landmark'), landmark,
      verticalOffsetControls,
      advanced,
      submit('Place dot'),
    );
    updateVisibleControls();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const selectedSet = setId.value;
      const selectedPerformer = performerId.value;
      const set = store.getState().document.sets.find((candidate) => candidate.id === selectedSet);
      const existing = Boolean(set && selectedPerformer in set.positions);
      try {
        const dot = buildDotFromEditorValues({
          useRawFu: useRawFu.checked,
          x: x.value,
          y: y.value,
          horizontalMode: horizontalMode.value,
          side: side.value,
          lineYard: lineYard.value,
          splittingLower: splittingLower.value,
          splittingHigher: splittingHigher.value,
          horizontalSteps: horizontalSteps.value,
          horizontalDirection: inside.checked ? 'Inside' : 'Outside',
          horizontalFiftySide: fiftySide.value as 'side-1' | 'side-2',
          verticalMode: verticalMode.value,
          landmark: landmark.value,
          verticalSteps: verticalSteps.value,
          verticalDirection: inFrontOf.checked ? 'In Front Of' : 'Behind',
        });
        store.apply({
          type: existing ? 'dot.move' : 'dot.create',
          setId: selectedSet,
          performerId: selectedPerformer,
          dot,
        });
        setStatus(`${existing ? 'Moved' : 'Placed'} dot at (${dot.x}, ${dot.y}) FU.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not place dot.');
      }
      rerender();
    });
    return form;
  };

  const createInspectionTable = (): HTMLTableElement => {
    const table = element('table', 'inspection-table');
    const caption = document.createElement('caption');
    caption.textContent = 'Coordinate inspection — displayed rounding never replaces canonical values';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Rank', 'Canonical dot', 'Derived coordinate', 'Horizontal raw', 'Vertical raw'].forEach((title) => {
      headRow.append(textElement('th', undefined, title));
    });
    head.append(headRow);
    const body = document.createElement('tbody');
    const documentState = store.getState().document;
    const activeSet = documentState.sets[0];
    if (activeSet) {
      documentState.performers.forEach((performer) => {
        const row = document.createElement('tr');
        const dot = activeSet.positions[performer.id];
        row.append(textElement('th', undefined, performer.rankCode));
        if (!dot) {
          const empty = textElement('td', 'muted', 'No dot placed');
          empty.colSpan = 4;
          row.append(empty);
        } else {
          const inspection = inspectCoordinate(dot);
          row.append(
            textElement('td', undefined, `(${dot.x}, ${dot.y}) FU`),
            textElement('td', undefined, inspection.notation),
            textElement('td', undefined, rawDistance(inspection.horizontal.rawDistance)),
            textElement('td', undefined, rawDistance(inspection.vertical.rawDistance)),
          );
        }
        body.append(row);
      });
    }
    table.append(caption, head, body);
    return table;
  };

  render();
}

function rawDistance(distance: { readonly units: number; readonly numeratorUnits: number; readonly denominatorUnits: number }): string {
  return `${distance.units} FU; ${distance.numeratorUnits}/${distance.denominatorUnits} steps`;
}

function yardOptions(start: number, end: number): readonly { readonly value: string; readonly label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let yard = start; yard <= end; yard += 5) options.push({ value: String(yard), label: `${yard}` });
  return options;
}

function fieldLineOptions(start: number, end: number): readonly { readonly value: string; readonly label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let yard = start; yard <= end; yard += 5) {
    options.push({ value: String(yard), label: formatYardLine(yard) });
  }
  return options;
}

function horizontalInput(
  mode: string,
  side: string,
  lineYard: string,
  splittingLower: string,
  splittingHigher: string,
  steps: string,
  direction: 'Inside' | 'Outside',
  fiftySide: 'side-1' | 'side-2',
): HorizontalCoordinateInput {
  if (mode === 'splitting') {
    return { kind: 'splitting', lowerLine: Number(splittingLower), higherLine: Number(splittingHigher) };
  }
  const line = yardLineFromSide(side, lineYard);
  if (mode === 'line') return { kind: 'line', line };
  if (mode === 'offset') {
    return line === 50
      ? { kind: 'offset', line, quarterSteps: parseQuarterSteps(steps), direction: 'Outside', fiftySide: fiftySide === 'side-1' ? 'Side 1' : 'Side 2' }
      : { kind: 'offset', line, quarterSteps: parseQuarterSteps(steps), direction };
  }
  throw new RangeError(`Unknown horizontal placement mode: ${mode}`);
}

function yardLineFromSide(side: string, yard: string): number {
  const line = Number(yard);
  if (!Number.isInteger(line)) throw new RangeError('Choose a valid yard line.');
  if (side === 'side-1') return line;
  if (side === 'side-2') return 100 - line;
  if (side === '50') return 50;
  throw new RangeError(`Unknown side: ${side}`);
}

function rawDot(x: string, y: string): { readonly x: number; readonly y: number } {
  if (x.trim() === '' || y.trim() === '') throw new RangeError('Raw FU entry requires both X and Y.');
  return { x: Number(x), y: Number(y) };
}

function element<K extends keyof HTMLElementTagNameMap>(tagName: K, className?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tagName);
  if (className) item.className = className;
  return item;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string | undefined,
  text: string,
  role?: string,
): HTMLElementTagNameMap[K] {
  const item = element(tagName, className);
  item.textContent = text;
  if (role) item.setAttribute('role', role);
  return item;
}

function input(id: string, labelText: string, type: string): HTMLInputElement {
  const field = document.createElement('input');
  field.id = id;
  field.name = id;
  field.type = type;
  field.setAttribute('aria-label', labelText);
  field.placeholder = labelText;
  return field;
}

function radio(name: string, id: string, value: string, checked = false): HTMLInputElement {
  const field = input(id, value, 'radio');
  field.name = name;
  field.value = value;
  field.checked = checked;
  return field;
}

function labelFor(control: HTMLInputElement | HTMLSelectElement, text: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.htmlFor = control.id;
  label.textContent = text;
  return label;
}

function select(id: string, labelText: string, options: readonly { readonly value: string; readonly label: string }[]): HTMLSelectElement {
  const field = document.createElement('select');
  field.id = id;
  field.name = id;
  field.setAttribute('aria-label', labelText);
  options.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    field.append(option);
  });
  return field;
}

function button(label: string, click: () => void): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = label;
  control.addEventListener('click', click);
  return control;
}

function submit(label: string): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'submit';
  control.textContent = label;
  return control;
}
