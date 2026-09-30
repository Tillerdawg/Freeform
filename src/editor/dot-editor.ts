import type { CommandStore } from '../document/types';
import { inspectCoordinate, NFHS_11_PLAYER_FIELD } from '../geometry/nfhs';
import type { FeatureReport } from '../platform/features';
import { createTimelinePanel } from '../timeline/timeline-panel';

export interface DotEditorOptions {
  readonly store: CommandStore;
  readonly report: FeatureReport;
}

/**
 * A small DOM-only M2 editor. It deliberately exposes canonical FU entry rather
 * than a pixel coordinate so every placement crosses the document-command boundary.
 */
export function renderDotEditor(root: HTMLElement, { store, report }: DotEditorOptions): void {
  let message = '';
  const setMessage = (nextMessage: string): void => { message = nextMessage; };

  const render = (): void => {
    const state = store.getState();
    const document = state.document;
    root.dataset.support = String(report.supported);
    root.replaceChildren();

    const shell = element('section', 'app-shell');
    const header = element('header');
    header.append(
      textElement('p', 'eyebrow', 'Freeform · M3 sets and float timeline'),
      textElement('h1', undefined, 'Freeform'),
      textElement('p', 'subtitle', 'Canonical NFHS coordinates, complete sets, and count-by-count float playback.'),
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
        });
        setStatus(`Created performer ${code}. Place its dot with integer FU values.`);
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
    const x = input('dot-x', 'X (FU)', 'number');
    x.required = true;
    x.min = '0';
    x.max = String(NFHS_11_PLAYER_FIELD.lengthUnits);
    x.step = '1';
    const y = input('dot-y', 'Y (FU)', 'number');
    y.required = true;
    y.min = '0';
    y.max = String(NFHS_11_PLAYER_FIELD.widthUnits);
    y.step = '1';
    form.append(
      labelFor(setId, 'Set'), setId,
      labelFor(performerId, 'Performer'), performerId,
      labelFor(x, 'X (FU)'), x,
      labelFor(y, 'Y (FU)'), y,
      submit('Place dot'),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const selectedSet = setId.value;
      const selectedPerformer = performerId.value;
      const dot = { x: Number(x.value), y: Number(y.value) };
      const set = store.getState().document.sets.find((candidate) => candidate.id === selectedSet);
      const existing = Boolean(set && selectedPerformer in set.positions);
      try {
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
