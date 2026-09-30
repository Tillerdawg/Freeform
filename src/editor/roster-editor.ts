import type { CommandStore, Dot, FreeformDocument, Performer } from '../document/types';

const FIELD_CENTER: Dot = { x: 144000, y: 76800 };

export interface RosterPrefix {
  readonly prefix: string;
  readonly section?: string;
  readonly nextNumber: number;
}

export interface RosterEditorOptions {
  readonly store: CommandStore;
  readonly onCommitted: () => void;
  readonly setStatus: (message: string) => void;
}

/**
 * Lists existing numeric rank-code groups without making groups durable document
 * state. The setup wizard's rank codes are the stable grouping signal after
 * the initial layout has been edited.
 */
export function listRosterPrefixes(document: FreeformDocument): readonly RosterPrefix[] {
  const groups = new Map<string, {
    prefix: string;
    section?: string;
    highestNumber: number;
    performerIds: Set<string>;
    numbers: Set<number>;
  }>();
  for (const performer of document.performers) {
    for (const parts of rankCodeCandidates(performer.rankCode)) {
      const key = parts.prefix.toLowerCase();
      const current = groups.get(key);
      if (current) {
        current.highestNumber = Math.max(current.highestNumber, parts.number);
        current.performerIds.add(performer.id);
        current.numbers.add(parts.number);
      } else {
        groups.set(key, {
          prefix: parts.prefix,
          section: performer.section,
          highestNumber: parts.number,
          performerIds: new Set([performer.id]),
          numbers: new Set([parts.number]),
        });
      }
    }
  }
  const exactSequences = [...groups.values()].filter((group) => isSequenceFromOne(group.numbers));
  const candidates = exactSequences.length > 0 ? exactSequences : [...groups.values()];
  return candidates
    .filter((candidate) => !candidates.some((other) => other !== candidate
      && candidate.performerIds.size < other.performerIds.size
      && [...candidate.performerIds].every((id) => other.performerIds.has(id))))
    .map(({ prefix, section, highestNumber }) => ({
      prefix,
      section,
      nextNumber: nextNumber(prefix, highestNumber),
    }));
}

/** Adds the next rank-coded performer and covers every existing set at field center. */
export function addPerformerToRosterPrefix(store: CommandStore, prefix: string): Performer {
  const document = store.getState().document;
  const group = listRosterPrefixes(document).find((candidate) => candidate.prefix.toLowerCase() === prefix.toLowerCase());
  if (!group) throw new Error(`Choose an existing numeric rank-code prefix; ${prefix} is not available.`);

  const rankCode = `${group.prefix}${group.nextNumber}`;
  const performer: Performer = {
    id: nextPerformerId(document, rankCode),
    rankCode,
    displayName: rankCode,
    ...(group.section ? { section: group.section } : {}),
  };
  store.apply({
    type: 'performer.create',
    performer,
    positionsBySet: Object.fromEntries(document.sets.map((set) => [set.id, FIELD_CENTER])),
  });
  return performer;
}

/** Returns FTL transitions that will become repairable playback blocks after removal. */
export function ftlTransitionsAffectedByRemoval(document: FreeformDocument, performerId: string): readonly string[] {
  return document.transitions
    .filter((transition) => transition.mode === 'ftl' && transition.ftl
      && [transition.ftl.leaderId, ...transition.ftl.followerIds].includes(performerId))
    .map((transition) => transition.id);
}

/** Renders the incremental roster editor used after setup has generated the first roster. */
export function renderRosterEditor({ store, onCommitted, setStatus }: RosterEditorOptions): HTMLElement {
  const currentDocument = store.getState().document;
  const panel = element('section', 'roster-editor');
  panel.setAttribute('aria-labelledby', 'roster-editor-title');
  const title = textElement('h3', 'Roster editor');
  title.id = 'roster-editor-title';
  panel.append(
    title,
    textElement('p', 'Add a late arrival to an existing rank-code prefix, assign display names, or remove a departed performer. Existing dots are never relaid out.', 'muted'),
    createAddForm(currentDocument),
    createRosterTable(currentDocument),
  );
  return panel;

  function createAddForm(currentDocument: FreeformDocument): HTMLFormElement {
    const form = element('form', 'editor-form');
    form.id = 'roster-add-performer';
    form.append(textElement('h4', 'Add performer to an existing prefix'));
    const prefixes = listRosterPrefixes(currentDocument);
    if (prefixes.length === 0) {
      form.append(textElement('p', 'Create a numeric rank-coded performer before adding to a roster prefix.', 'muted'));
      return form;
    }
    const prefix = select('roster-prefix', 'Existing rank-code prefix', prefixes.map((candidate) => ({
      value: candidate.prefix,
      label: `${candidate.prefix} — next ${candidate.prefix}${candidate.nextNumber}${candidate.section ? ` (${candidate.section})` : ''}`,
    })));
    form.append(
      labelFor(prefix, 'Existing rank-code prefix'),
      prefix,
      textElement('p', 'The new dot starts at field center in every existing set.', 'muted'),
      submitButton('Add performer'),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const performer = addPerformerToRosterPrefix(store, prefix.value);
        setStatus(`Added ${performer.rankCode} at field center in every existing set; existing dots were unchanged.`);
        onCommitted();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not add performer.');
      }
    });
    return form;
  }

  function createRosterTable(currentDocument: FreeformDocument): HTMLFormElement {
    const form = element('form', 'roster-editor__table');
    form.id = 'roster-display-names';
    form.append(textElement('h4', 'Display names'));
    if (currentDocument.performers.length === 0) {
      form.append(textElement('p', 'The roster is empty.', 'muted'));
      return form;
    }
    const table = document.createElement('table');
    table.className = 'inspection-table';
    const caption = textElement('caption', 'Roster display names');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Rank', 'Section', 'Display name', ''].forEach((value) => {
      const heading = textElement('th', value);
      heading.scope = 'col';
      headRow.append(heading);
    });
    head.append(headRow);
    const body = document.createElement('tbody');
    currentDocument.performers.forEach((performer) => {
      const row = document.createElement('tr');
      const name = input(`roster-display-name-${performer.id}`, `Display name for ${performer.rankCode}`, 'text');
      name.className = 'roster-display-name';
      name.dataset.performerId = performer.id;
      name.maxLength = 120;
      name.required = true;
      name.value = performer.displayName;
      const remove = button(`Remove ${performer.rankCode}`, () => {
        const affectedTransitions = ftlTransitionsAffectedByRemoval(store.getState().document, performer.id);
        const ftlWarning = affectedTransitions.length > 0
          ? ` ${affectedTransitions.length === 1 ? 'Transition' : 'Transitions'} ${affectedTransitions.join(', ')} ${affectedTransitions.length === 1 ? 'uses' : 'use'} it in FTL playback and will become blocked until repaired.`
          : ' This removes its dot from every set and cannot preserve FTL membership.';
        if (!window.confirm(`Remove ${performer.rankCode}?${ftlWarning}`)) return;
        try {
          store.apply({ type: 'performer.remove', performerId: performer.id });
          const ftlNotice = affectedTransitions.length > 0
            ? ` FTL playback is blocked for transition${affectedTransitions.length === 1 ? '' : 's'} ${affectedTransitions.join(', ')}; see the Transition timeline to repair it.`
            : '';
          setStatus(`Removed ${performer.rankCode} and its dots from every set.${ftlNotice}`);
          onCommitted();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Could not remove performer.');
        }
      });
      remove.className = 'roster-remove';
      remove.dataset.performerId = performer.id;
      row.append(
        rowHeader(performer.rankCode),
        textElement('td', performer.section ?? '—'),
        cellWith(name),
        cellWith(remove),
      );
      body.append(row);
    });
    table.append(caption, head, body);
    form.append(table, submitButton('Save display names'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const updates = Object.fromEntries(
        Array.from(form.querySelectorAll<HTMLInputElement>('.roster-display-name'))
          .map((input) => [input.dataset.performerId!, input.value.trim()] as const)
          .filter(([performerId, displayName]) => currentDocument.performers
            .some((performer) => performer.id === performerId && performer.displayName !== displayName)),
      );
      if (Object.keys(updates).length === 0) {
        setStatus('No display names changed.');
        return;
      }
      try {
        store.apply({ type: 'performer.displayName.batchSet', updates });
        setStatus(`Saved ${Object.keys(updates).length} display name${Object.keys(updates).length === 1 ? '' : 's'} in one roster command.`);
        onCommitted();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not save display names.');
      }
    });
    return form;
  }
}

function rankCodeCandidates(rankCode: string): readonly { readonly prefix: string; readonly number: number }[] {
  const candidates: { prefix: string; number: number }[] = [];
  for (let suffixStart = 1; suffixStart < rankCode.length; suffixStart += 1) {
    const prefix = rankCode.slice(0, suffixStart);
    const suffix = rankCode.slice(suffixStart);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix) || !/^\d+$/.test(suffix)) continue;
    // The setup wizard appends canonical decimal sequence numbers. A leading-zero
    // suffix can therefore only be part of the persisted prefix (A01 is A0 + 1,
    // not A + 01), otherwise a legal zero-ending prefix would gain a bogus group.
    if (suffix.length > 1 && suffix.startsWith('0')) continue;
    const number = Number(suffix);
    if (Number.isSafeInteger(number)) candidates.push({ prefix, number });
  }
  return candidates;
}

function isSequenceFromOne(numbers: ReadonlySet<number>): boolean {
  const highestNumber = Math.max(...numbers);
  return highestNumber === numbers.size && [...numbers].every((number) => number >= 1 && number <= highestNumber);
}

function nextNumber(prefix: string, highestNumber: number): number {
  if (highestNumber >= Number.MAX_SAFE_INTEGER - 1) throw new RangeError(`Cannot create another ${prefix} rank code safely.`);
  const next = highestNumber + 1;
  if (`${prefix}${next}`.length > 32) throw new RangeError(`The next ${prefix} rank code would exceed 32 characters.`);
  return next;
}

function nextPerformerId(document: FreeformDocument, rankCode: string): string {
  const usedIds = new Set(document.performers.map((performer) => performer.id));
  const preferred = rankCode.toLowerCase();
  if (!usedIds.has(preferred)) return preferred;
  const base = `performer-${preferred}`;
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!usedIds.has(candidate)) return candidate;
  }
  throw new RangeError(`Could not allocate a performer ID for ${rankCode}.`);
}

function element<K extends keyof HTMLElementTagNameMap>(tagName: K, className?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tagName);
  if (className) item.className = className;
  return item;
}

function textElement<K extends keyof HTMLElementTagNameMap>(tagName: K, text: string, className?: string): HTMLElementTagNameMap[K] {
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

function labelFor(control: HTMLInputElement | HTMLSelectElement, text: string): HTMLLabelElement {
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

function cellWith(child: HTMLElement): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.append(child);
  return cell;
}

function rowHeader(value: string): HTMLTableCellElement {
  const cell = textElement('th', value);
  cell.scope = 'row';
  return cell;
}
