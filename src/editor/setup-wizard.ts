import type { CommandStore, Dot, FreeformDocument } from '../document/types';
import { FU_PER_STEP, isValidDot, NFHS_11_PLAYER_FIELD } from '../geometry/nfhs';

export interface SetupSection {
  readonly instrument: string;
  readonly count: string;
  readonly prefix: string;
}

export interface GeneratedPerformer {
  readonly id: string;
  readonly rankCode: string;
  readonly displayName: string;
  readonly section: string;
  readonly dot: Dot;
}

interface DraftSection extends SetupSection {
  readonly key: number;
  readonly prefixTouched: boolean;
}

export interface SetupWizardOptions {
  readonly store: CommandStore;
  readonly onComplete: () => void;
}

const DOT_SPACING_UNITS = 2 * FU_PER_STEP;
const ROW_GAP_UNITS = 4 * FU_PER_STEP;
const FIELD_CENTER_X = NFHS_11_PLAYER_FIELD.lengthUnits / 2;
const MAX_PER_ROW = Math.floor(NFHS_11_PLAYER_FIELD.lengthUnits / DOT_SPACING_UNITS);

/**
 * Prefix suggestions intentionally cover common marching-band and drum-corps
 * sections. An exact match is suggested; the writer may freely replace it.
 */
const PREFIX_SUGGESTIONS: Readonly<Record<string, string>> = {
  piccolo: 'P',
  flute: 'F',
  oboe: 'O',
  clarinet: 'C',
  'bass clarinet': 'BC',
  'alto saxophone': 'AS',
  'tenor saxophone': 'TS',
  'baritone saxophone': 'BS',
  trumpet: 'T',
  mellophone: 'M',
  'french horn': 'H',
  trombone: 'TB',
  baritone: 'E',
  euphonium: 'E',
  tuba: 'TU',
  snare: 'S',
  'tenor drums': 'TD',
  'bass drum': 'BD',
  cymbals: 'CY',
  'color guard': 'G',
  flag: 'G',
};

/** Returns the conventional suggested rank-code prefix for a common section name. */
export function suggestPrefix(instrument: string): string {
  return PREFIX_SUGGESTIONS[instrument.trim().toLowerCase()] ?? '';
}

/** Returns every case-insensitive duplicate prefix, once each. */
export function duplicatePrefixes(sections: readonly SetupSection[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { prefix } of sections) {
    const normalized = prefix.trim().toLowerCase();
    if (normalized === '') continue;
    if (seen.has(normalized)) duplicates.add(normalized);
    seen.add(normalized);
  }
  return [...duplicates];
}

/** Creates the deliberately blank document displayed by the first-run wizard. */
export function createEmptyDocument(): FreeformDocument {
  return {
    format: 'freeform',
    formatVersion: '1.0.0',
    show: { id: 'untitled-show', title: 'Untitled Show', totalCounts: 0 },
    field: NFHS_11_PLAYER_FIELD,
    settings: { collisionThresholdUnits: 2880 },
    performers: [],
    sets: [],
    transitions: [],
    annotations: [],
  };
}

/**
 * Computes first-set positions in section-entry order. Rows begin at the front
 * sideline (y=0) and each row center, including a wrapped row, advances 7200 FU.
 */
export function layoutSections(sections: readonly SetupSection[]): readonly Dot[][] {
  let rowIndex = 0;
  return sections.map((section) => {
    const count = parseCount(section.count);
    if (count === undefined) throw new RangeError(`Section ${section.instrument || 'row'} needs a positive whole-number count.`);
    const dots: Dot[] = [];
    for (let first = 0; first < count; first += MAX_PER_ROW) {
      const rowCount = Math.min(MAX_PER_ROW, count - first);
      const y = rowIndex * ROW_GAP_UNITS;
      if (y > NFHS_11_PLAYER_FIELD.widthUnits) {
        throw new RangeError('The roster needs more front-to-back rows than this field can hold. Reduce the roster or use a larger field.');
      }
      for (let index = 0; index < rowCount; index += 1) {
        const x = FIELD_CENTER_X + (index - (rowCount - 1) / 2) * DOT_SPACING_UNITS;
        const dot = { x, y };
        if (!isValidDot(dot)) throw new RangeError('The roster layout produced an out-of-bounds dot.');
        dots.push(dot);
      }
      rowIndex += 1;
    }
    return dots;
  });
}

/** Validates setup input before any command-store command is issued. */
export function validateSetup(title: string, sections: readonly SetupSection[]): string | undefined {
  if (title.trim() === '') return 'A drill file name is required.';
  if (sections.length === 0) return 'Add at least one section.';
  const duplicates = duplicatePrefixes(sections);
  if (duplicates.length > 0) return `Each rank-code prefix must be unique (duplicate: ${duplicates.join(', ').toUpperCase()}).`;
  for (const section of sections) {
    const instrument = section.instrument.trim();
    const prefix = section.prefix.trim();
    const count = parseCount(section.count);
    if (instrument === '') return 'Every section needs an instrument or equipment name.';
    if (count === undefined) return `Section ${instrument} needs a positive whole-number count.`;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
      return `Section ${instrument} needs a prefix beginning with a letter and using only letters, digits, underscores, or hyphens.`;
    }
    const lastRankCode = `${prefix}${count}`;
    if (lastRankCode.length > 32) return `Section ${instrument} creates a rank code longer than 32 characters.`;
  }
  const generatedRankCodes = new Set<string>();
  for (const section of sections) {
    const prefix = section.prefix.trim();
    const count = parseCount(section.count)!;
    for (let index = 1; index <= count; index += 1) {
      const normalized = `${prefix}${index}`.toLowerCase();
      if (generatedRankCodes.has(normalized)) {
        return `Generated rank code collision: ${prefix}${index}. Choose prefixes that produce unique rank codes.`;
      }
      generatedRankCodes.add(normalized);
    }
  }
  try {
    layoutSections(sections);
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not lay out the roster.';
  }
  return undefined;
}

/** Applies the initial title, Set 1, and one atomic performer.create command per generated performer. */
export function applySetup(store: CommandStore, title: string, sections: readonly SetupSection[]): void {
  const error = validateSetup(title, sections);
  if (error) throw new RangeError(error);

  const dotsBySection = layoutSections(sections);
  store.apply({ type: 'show.title.set', title: title.trim() });
  store.apply({ type: 'set.create', set: { id: 'set-1', name: 'Set 1', startCount: 0, positions: {} } });
  sections.forEach((section, sectionIndex) => {
    const prefix = section.prefix.trim();
    const instrument = section.instrument.trim();
    dotsBySection[sectionIndex]!.forEach((dot, index) => {
      const rankCode = `${prefix}${index + 1}`;
      store.apply({
        type: 'performer.create',
        performer: {
          id: rankCode.toLowerCase(),
          rankCode,
          displayName: rankCode,
          section: instrument,
        },
        positionsBySet: { 'set-1': dot },
      });
    });
  });
}

/** Renders the first-run DOM wizard before the normal dot editor is available. */
export function renderSetupWizard(root: HTMLElement, { store, onComplete }: SetupWizardOptions): void {
  let title = '';
  let nextKey = 1;
  let message = '';
  let sections: DraftSection[] = [newDraftSection(nextKey++)];

  const render = (): void => {
    root.replaceChildren();
    const shell = element('section', 'app-shell');
    const header = element('header');
    header.append(
      textElement('p', 'eyebrow', 'Freeform · first-run setup'),
      textElement('h1', undefined, 'Start a drill file'),
      textElement('p', 'subtitle', 'Name the drill and create its initial section roster. Every performer begins in Set 1.'),
    );
    const form = element('form', 'setup-wizard');
    form.noValidate = true;
    const titleInput = input('setup-title', 'Drill file name', 'text');
    titleInput.required = true;
    titleInput.value = title;
    titleInput.addEventListener('input', () => { title = titleInput.value; updateStatus(form); });
    form.append(textElement('h2', undefined, 'Drill file name'), labelFor(titleInput, 'Drill file name'), titleInput);

    const roster = element('section', 'setup-wizard__roster');
    roster.append(textElement('h2', undefined, 'Section roster'));
    const rows = element('div', 'setup-wizard__rows');
    sections.forEach((section, index) => rows.append(sectionRow(section, index)));
    const add = button('Add section', () => {
      sections = [...sections, newDraftSection(nextKey++)];
      render();
    });
    roster.append(rows, add);
    form.append(roster);

    const total = textElement('p', 'setup-wizard__total', '');
    total.id = 'setup-total';
    const error = textElement('p', 'setup-wizard__error', '');
    error.id = 'setup-prefix-error';
    error.setAttribute('role', 'alert');
    const submit = submitButton('Create drill file');
    form.append(total, error, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const validationError = validateSetup(title, sections);
      if (validationError) {
        message = validationError;
        updateStatus(form);
        return;
      }
      try {
        applySetup(store, title, sections);
        onComplete();
      } catch (caught) {
        message = caught instanceof Error ? caught.message : 'Could not create the drill file.';
        updateStatus(form);
      }
    });

    shell.append(header, form);
    root.append(shell);
    updateStatus(form);
  };

  const sectionRow = (section: DraftSection, index: number): HTMLElement => {
    const row = element('fieldset', 'setup-wizard__row');
    row.append(textElement('legend', undefined, `Section ${index + 1}`));
    const instrument = input(`setup-instrument-${section.key}`, 'Instrument or equipment', 'text');
    instrument.value = section.instrument;
    instrument.addEventListener('input', () => {
      const suggested = suggestPrefix(instrument.value);
      sections = sections.map((candidate) => candidate.key === section.key
        ? { ...candidate, instrument: instrument.value, prefix: candidate.prefixTouched ? candidate.prefix : suggested }
        : candidate);
      render();
    });
    const count = input(`setup-count-${section.key}`, 'Count', 'number');
    count.min = '1';
    count.step = '1';
    count.value = section.count;
    count.addEventListener('input', () => {
      sections = sections.map((candidate) => candidate.key === section.key ? { ...candidate, count: count.value } : candidate);
      updateCurrentStatus();
    });
    const prefix = input(`setup-prefix-${section.key}`, 'Rank-code prefix', 'text');
    prefix.className = 'setup-prefix';
    prefix.value = section.prefix;
    prefix.addEventListener('input', () => {
      sections = sections.map((candidate) => candidate.key === section.key
        ? { ...candidate, prefix: prefix.value, prefixTouched: true }
        : candidate);
      updateCurrentStatus();
    });
    const remove = button('Remove section', () => {
      sections = sections.filter((candidate) => candidate.key !== section.key);
      render();
    });
    row.append(
      labelFor(instrument, 'Instrument or equipment'), instrument,
      labelFor(count, 'Count'), count,
      labelFor(prefix, 'Rank-code prefix'), prefix,
      remove,
    );
    return row;
  };

  const updateCurrentStatus = (): void => {
    const form = root.querySelector<HTMLFormElement>('.setup-wizard');
    if (form) updateStatus(form);
  };

  const updateStatus = (form: HTMLFormElement): void => {
    const total = form.querySelector<HTMLElement>('#setup-total');
    const error = form.querySelector<HTMLElement>('#setup-prefix-error');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const totalCount = sections.reduce((sum, section) => sum + (parseCount(section.count) ?? 0), 0);
    if (total) total.textContent = `Total performers: ${totalCount}`;
    const validationError = message || validateSetup(title, sections);
    if (error) error.textContent = validationError ?? '';
    if (submit) submit.disabled = validationError !== undefined;
  };

  render();
}

function parseCount(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

function newDraftSection(key: number): DraftSection {
  return { key, instrument: '', count: '1', prefix: '', prefixTouched: false };
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
): HTMLElementTagNameMap[K] {
  const item = element(tagName, className);
  item.textContent = text;
  return item;
}

function input(id: string, labelText: string, type: string): HTMLInputElement {
  const field = document.createElement('input');
  field.id = id;
  field.name = id;
  field.type = type;
  field.setAttribute('aria-label', labelText);
  return field;
}

function labelFor(control: HTMLInputElement, text: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.htmlFor = control.id;
  label.textContent = text;
  return label;
}

function button(label: string, click: () => void): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = label;
  control.addEventListener('click', click);
  return control;
}

function submitButton(label: string): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'submit';
  control.textContent = label;
  return control;
}
