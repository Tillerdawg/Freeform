import type { CommandStore, FreeformDocument, Identifier } from '../document/types';
import type { NoteOverlapWarning, PdfExportErrorCode, PdfExportRequest, PdfExportResult, PdfScope } from './contracts';
import { downloadPdf } from './download';

export interface PdfExportUi {
  render(): HTMLElement;
}

type ExportKind = 'director' | 'performer-packet';
type PanelError = Readonly<{ messageKey: string; message: string; controlId?: string }>;
type Outcome = Extract<PdfExportResult, { ok: true }> | Extract<PdfExportResult, { ok: false }>;

const messages: Readonly<Record<string, string>> = {
  'pdfExport.error.validation.noPerformersSelected': 'Choose at least one performer.',
  'pdfExport.error.validation.duplicatePerformerSelected': 'Each performer can only be selected once.',
  'pdfExport.error.validation.unknownPerformer': 'One of the selected performers is no longer in this show.',
  'pdfExport.error.validation.rangeNotChosen': 'Choose a set.',
  'pdfExport.error.validation.rangeReversed': 'This set comes before the one you chose as "From set." Choose a later set, or switch the order.',
  'pdfExport.error.validation.unknownSet': 'This set is no longer in the show. Choose another.',
  'pdfExport.error.validation.unknownTransition': 'This transition is no longer in the show.',
  'pdfExport.error.validation.duplicateTransitionRequest': 'This transition was selected more than once. Remove the duplicate.',
  'pdfExport.error.validation.transitionCountBlank': 'Enter at least one count, or turn this transition off.',
  'pdfExport.error.validation.transitionCountMalformed': 'Use whole numbers separated by commas, like 0, 8, 16.',
  'pdfExport.error.validation.transitionCountDecimal': "<count> isn't a whole number. Counts can't have a decimal point.",
  'pdfExport.error.validation.transitionCountNegative': "<count> can't be negative. Counts start at 0.",
  'pdfExport.error.validation.transitionCountOutOfDomain': "<count> isn't a valid count for this transition. Use a whole number from 0 through <counts>.",
  'pdfExport.error.validation.transitionCountDuplicate': '<count> is listed more than once. Remove the duplicate.',
  'pdfExport.error.validation.transitionOutsideRange': "This transition isn't fully inside the sets you chose, so it can't be included.",
  'pdfExport.error.documentInvalid.schema': "This show's data couldn't be read for export. Your document is unchanged. Try to save or download your current work first. Only reload this page once you've confirmed that save or download actually completed — if it fails, if you cancel it, or if you're not sure it finished, stay on this page instead; reloading can wait, and a reload with no confirmed saved or downloaded copy risks losing unsaved edits. Version History's \"Restore this version\" replaces your current working document and warns that anything not saved or backed up will be lost — use it only once you've confirmed your current work is safely saved or downloaded first.",
  'pdfExport.error.documentInvalid.ftl': "One of this show's follow-the-leader transitions has mismatched data and can't be exported. Your document is unchanged. Check that transition's follower assignments in the editor, then export again.",
  'pdfExport.error.noteLayoutOverflow': 'A note is too long to lay out in the exported PDF. Your document is unchanged. Try shortening your performer notes or on-field notes, then export again.',
  'pdfExport.error.unsupportedGlyph': "This show uses a character that can't be drawn in the exported PDF. Your document is unchanged. Try removing or replacing that character in the note or label, then export again.",
  'pdfExport.error.fontLoad': "Freeform couldn't load the font needed to build this PDF. Your document is unchanged. Try again — if this keeps happening, save or download your work first. Only reload the page once you've confirmed that save or download actually completed; if it fails, if you cancel it, or if you're not sure it finished, stay on this page instead.",
  'pdfExport.error.writerFailed': 'Freeform ran into a problem building this PDF. Your document is unchanged. Try again with a smaller range or fewer performers — if that doesn\'t help, try again later.',
  'pdfExport.error.blobUnavailable': "This browser can't prepare a PDF for download right now. Your document is unchanged. Try a different browser or window.",
  'pdfExport.error.urlUnavailable': "Freeform built your PDF but this browser couldn't start the download from it. Your document is unchanged. Try a different browser or window.",
  'pdfExport.error.downloadFailed': "Freeform built your PDF but couldn't start the download. Your document is unchanged. Check your browser's download settings and try again.",
};

/**
 * Application controller for M8 export. It owns only panel drafts/results; it
 * never invokes CommandStore.apply(), so rendering, failed exports, and download
 * dispatch cannot become document edits or persistence writes.
 */
export function createPdfExportUi(store: CommandStore): PdfExportUi {
  let open = false;
  let kind: ExportKind = 'director';
  let range = false;
  let firstSetId = '';
  let lastSetId = '';
  const selectedPerformers = new Set<Identifier>();
  const selectedTransitions = new Set<Identifier>();
  const transitionCounts = new Map<Identifier, string>();
  let pending = false;
  let outcome: Outcome | undefined;
  let dispatchError: Extract<PdfExportResult, { ok: false }> | undefined;
  let resultSnapshot: FreeformDocument | undefined;
  let fieldError: PanelError | undefined;
  let status = '';
  const host = element('section', 'pdf-export-controls');
  const statusNode = text('p', '');
  statusNode.id = 'pdf-export-status';
  statusNode.setAttribute('role', 'status');
  statusNode.setAttribute('aria-live', 'polite');
  statusNode.tabIndex = -1;
  let requestSerial = 0;
  let focusTarget: string | undefined;

  function redraw(): void {
    const active = document.activeElement;
    const focusedInside = active instanceof HTMLElement && host.contains(active);
    const priorId = focusedInside && active.id !== '' ? `#${active.id}` : undefined;
    host.replaceChildren(build());
    const target = focusTarget ?? priorId;
    focusTarget = undefined;
    if (!focusedInside || !target) return;
    queueMicrotask(() => restoreFocus(target));
  }

  function restoreFocus(selector: string): void {
    const intended = host.querySelector<HTMLElement>(selector);
    if (intended && !isDisabled(intended)) {
      intended.focus();
      return;
    }
    const fallback = open ? host.querySelector<HTMLElement>('#export-panel-heading') : host.querySelector<HTMLElement>('#pdf-export-invoke');
    fallback?.focus();
  }

  function build(): DocumentFragment {
    const invoke = button('Export PDF…', () => {
      open = true;
      if (dispatchError || (outcome && !outcome.ok)) focusTarget = '#pdf-export-status';
      else if (outcome?.ok) focusTarget = '#pdf-export-download';
      redraw();
    });
    invoke.id = 'pdf-export-invoke';
    const contents = document.createDocumentFragment();
    contents.append(invoke);
    if (open) contents.append(buildPanel());
    return contents;
  }

  function buildPanel(): HTMLElement {
    const panel = element('section', 'persistence-dialog pdf-export-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'export-panel-heading');
    const heading = text('h2', 'Export PDF');
    heading.id = 'export-panel-heading';
    heading.tabIndex = -1;
    const form = document.createElement('form');
    form.noValidate = true;
    form.className = 'pdf-export-form';
    form.append(buildKindFields(), buildScopeFields(), buildTransitionFields(), buildPerformerFields());

    statusNode.textContent = status;
    form.append(statusNode);
    if (fieldError) {
      const errorNode = text('p', fieldError.message, 'pdf-export-error');
      errorNode.id = 'pdf-export-field-error';
      form.append(errorNode);
    }
    if (outcome?.ok) form.append(buildReady(outcome));
    const visibleError = dispatchError ?? (outcome && !outcome.ok ? outcome : undefined);
    if (visibleError && visibleError.detail.length > 0) {
      const details = document.createElement('details');
      const summary = text('summary', 'Technical details');
      summary.id = 'pdf-export-technical-details';
      details.append(summary, text('p', visibleError.detail.join(', ')));
      form.append(details);
    }
    form.append(text('p', 'Freeform is still verifying that exported PDFs have selectable, searchable text. They are not tagged, and have not been verified to work with screen readers — if that matters for your use, let us know.', 'muted'));
    const actions = element('p', 'pdf-export-actions');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.id = 'pdf-export-submit';
    submit.textContent = pending ? 'Generating…' : 'Export';
    submit.disabled = pending || (kind === 'performer-packet' && store.getState().document.performers.length === 0);
    const close = button('Close', () => { open = false; redraw(); });
    close.id = 'pdf-export-close';
    actions.append(submit, close);
    form.append(actions);
    if (pending) form.append(text('p', "Closing this panel doesn't stop an export already underway. Reopen it to download the file once it's ready.", 'muted'));
    form.addEventListener('submit', (event) => { event.preventDefault(); void generate(); });
    panel.append(heading, form);
    return panel;
  }

  function buildKindFields(): HTMLFieldSetElement {
    const fields = document.createElement('fieldset');
    fields.append(text('legend', 'What do you want to export?'));
    fields.append(radio('pdf-export-kind', 'pdf-export-director', 'director', 'Director pages', kind === 'director', () => { kind = 'director'; fieldError = undefined; redraw(); }),
      text('p', 'One full-field page per set or transition count, for the person calling the show.', 'muted'),
      radio('pdf-export-kind', 'pdf-export-packet', 'performer-packet', 'Performer packets', kind === 'performer-packet', () => { kind = 'performer-packet'; fieldError = undefined; redraw(); }),
      text('p', 'One booklet per performer, with their own coordinates and notes.', 'muted'));
    return fields;
  }

  function buildScopeFields(): HTMLFieldSetElement {
    const doc = store.getState().document;
    const fields = document.createElement('fieldset');
    fields.append(text('legend', 'Which sets?'));
    fields.append(radio('pdf-export-scope', 'pdf-export-full-show', 'full', 'Full show', !range, () => { range = false; fieldError = undefined; redraw(); }), text('p', 'Every set in the show, in order.', 'muted'),
      radio('pdf-export-scope', 'pdf-export-range', 'range', 'A range of sets', range, () => { range = true; fieldError = undefined; redraw(); }));
    const options = doc.sets.map((set) => ({ value: set.id, label: set.name }));
    const first = select('pdf-export-first-set', 'From set', options, firstSetId, range, (value) => { firstSetId = value; redraw(); });
    const last = select('pdf-export-last-set', 'To set', options, lastSetId, range, (value) => { lastSetId = value; redraw(); });
    associateError(first, fieldError); associateError(last, fieldError);
    fields.append(label('From set', first), first, label('To set', last), last, text('p', 'Includes both sets you choose, and every set between them. A transition is included only if both of its sets are in range.', 'muted'));
    return fields;
  }

  function buildTransitionFields(): HTMLFieldSetElement {
    const doc = store.getState().document;
    const disabled = kind === 'performer-packet';
    const fields = document.createElement('fieldset');
    fields.id = 'pdf-export-transitions';
    fields.tabIndex = -1;
    fields.append(text('legend', 'Include transition pages?'), text('p', disabled ? "Transition pages aren't part of performer packets." : 'Off by default. Turn on a transition below to also export a page for one or more exact counts during that move.', 'muted'));
    for (const transition of eligibleTransitions(doc)) {
      const from = doc.sets.find((set) => set.id === transition.fromSetId)?.name ?? transition.fromSetId;
      const to = doc.sets.find((set) => set.id === transition.toSetId)?.name ?? transition.toSetId;
      const checked = selectedTransitions.has(transition.id);
      const check = checkbox(`pdf-export-transition-${transition.id}`, `${from} → ${to}`, checked, disabled, () => {
        checked ? selectedTransitions.delete(transition.id) : selectedTransitions.add(transition.id);
        fieldError = undefined;
        redraw();
      });
      const counts = document.createElement('input');
      counts.id = `pdf-export-counts-${transition.id}`;
      counts.type = 'text';
      counts.placeholder = 'e.g. 0, 8, 16';
      counts.value = transitionCounts.get(transition.id) ?? '';
      counts.disabled = disabled || !checked;
      counts.setAttribute('aria-label', 'Counts');
      counts.addEventListener('input', () => { transitionCounts.set(transition.id, counts.value); fieldError = undefined; });
      associateError(check.querySelector('input')!, fieldError); associateError(counts, fieldError);
      fields.append(check, label('Counts', counts), counts, text('p', `Comma-separated whole numbers from 0 through ${transition.counts}. A checked transition needs at least one count; leave the checkbox unchecked to skip it entirely.`, 'muted'));
    }
    return fields;
  }

  function buildPerformerFields(): HTMLFieldSetElement {
    const fields = document.createElement('fieldset');
    fields.append(text('legend', 'Which performers?'));
    const packet = kind === 'performer-packet';
    const performers = store.getState().document.performers;
    const all = button('Select all', () => { performers.forEach(({ id }) => selectedPerformers.add(id)); fieldError = undefined; redraw(); });
    all.id = 'pdf-export-performers-select-all';
    const clear = button('Clear all', () => { selectedPerformers.clear(); fieldError = undefined; redraw(); });
    clear.id = 'pdf-export-performers-clear-all';
    all.disabled = !packet || performers.length === 0;
    clear.disabled = !packet || performers.length === 0;
    fields.append(all, clear);
    if (performers.length === 0) fields.append(text('p', 'This show has no performers yet. Add performers before exporting packets.', 'muted'));
    for (const performer of performers) {
      const selected = selectedPerformers.has(performer.id);
      const check = checkbox(`pdf-export-performer-${performer.id}`, `${performer.rankCode} — ${performer.displayName}`, selected, !packet, () => {
        selected ? selectedPerformers.delete(performer.id) : selectedPerformers.add(performer.id);
        fieldError = undefined;
      });
      associateError(check.querySelector('input')!, fieldError);
      fields.append(check);
    }
    return fields;
  }

  function buildReady(result: Extract<PdfExportResult, { ok: true }>): HTMLElement {
    const group = element('p', 'pdf-export-ready');
    group.append(text('span', 'Your PDF is ready. '));
    const control = button(`Download ${result.filename}`, () => {
      const dispatched = downloadPdf(result.bytes, result.filename);
      if (dispatched.ok) {
        status = `Started downloading ${result.filename}.`;
        fieldError = undefined;
        dispatchError = undefined;
      } else {
        dispatchError = { ok: false, code: dispatched.code, messageKey: downloadMessageKey(dispatched.code), detail: [] };
        status = messageFor(dispatchError.messageKey);
        fieldError = undefined;
        focusTarget = '#pdf-export-status';
      }
      redraw();
    });
    control.id = 'pdf-export-download';
    group.append(control);
    if (result.warnings.length > 0 && resultSnapshot) group.append(buildWarnings(result, resultSnapshot));
    return group;
  }

  function buildWarnings(result: Extract<PdfExportResult, { ok: true }>, snapshot: FreeformDocument): HTMLElement {
    const details = document.createElement('details');
    details.className = 'pdf-export-warnings';
    const summary = text('summary', `${result.warnings.length} possible overlaps in this export`);
    summary.id = 'pdf-export-warning-details';
    details.append(summary);
    for (const warning of result.warnings) {
      if (warning.code !== 'note-overlap') continue;
      details.append(text('p', warningText(snapshot, result, warning), 'pdf-export-warning-detail'));
      details.append(text('p', warningExplanation(snapshot, warning), 'muted'));
    }
    return details;
  }

  async function generate(): Promise<void> {
    const request = normalizedRequest();
    if ('message' in request) {
      fieldError = request;
      status = '';
      focusTarget = fieldError.controlId ? `#${fieldError.controlId}` : '#pdf-export-status';
      redraw();
      return;
    }
    const serial = ++requestSerial;
    // Both values are captured before the lazy writer/font import. This is the
    // export's immutable boundary; no store/persistence API is called below.
    const snapshot = structuredClone(store.getState().document);
    const frozenRequest = structuredClone(request);
    pending = true;
    outcome = undefined;
    dispatchError = undefined;
    resultSnapshot = undefined;
    fieldError = undefined;
    status = 'Generating your PDF. This can take a moment for a long show.';
    redraw();
    try {
      const [{ buildPdfExport }, { loadBundledPdfAssets }] = await Promise.all([import('./pdf-export'), import('./assets')]);
      const result = await buildPdfExport(snapshot, frozenRequest, loadBundledPdfAssets());
      if (serial !== requestSerial) return;
      pending = false;
      outcome = result;
      if (result.ok) resultSnapshot = snapshot;
      status = result.ok ? 'Your PDF is ready.' : messageFor(result.messageKey);
      // An async result can arrive after the user has deliberately focused the
      // editor. Announce through the live node, but do not steal that focus.
      if (open && host.contains(document.activeElement)) focusTarget = result.ok ? '#pdf-export-download' : '#pdf-export-status';
      redraw();
    } catch {
      if (serial !== requestSerial) return;
      pending = false;
      outcome = { ok: false, code: 'writer-failed', messageKey: 'pdfExport.error.writerFailed', detail: [] };
      status = messageFor('pdfExport.error.writerFailed');
      if (open && host.contains(document.activeElement)) focusTarget = '#pdf-export-status';
      redraw();
    }
  }

  function normalizedRequest(): PdfExportRequest | PanelError {
    const doc = store.getState().document;
    const scope = normalizedScope(doc);
    if ('message' in scope) return scope;
    if (kind === 'performer-packet') {
      if (selectedPerformers.size === 0) return error('pdfExport.error.validation.noPerformersSelected', performersFirstControl(doc));
      if ([...selectedPerformers].some((performerId) => !doc.performers.some(({ id }) => id === performerId))) return error('pdfExport.error.validation.unknownPerformer', performersFirstControl(doc));
      return { kind, performerIds: [...selectedPerformers], scope };
    }
    const frames: { transitionId: Identifier; counts: number[] }[] = [];
    for (const transitionId of selectedTransitions) {
      const transition = doc.transitions.find(({ id }) => id === transitionId);
      if (!transition) return error('pdfExport.error.validation.unknownTransition', 'pdf-export-transitions');
      if (!transitionInScope(doc, transition, scope)) return error('pdfExport.error.validation.transitionOutsideRange', 'pdf-export-transitions');
      const parsed = parseCounts(transitionCounts.get(transition.id) ?? '', transition.counts, `pdf-export-counts-${transition.id}`);
      if ('message' in parsed) return parsed;
      frames.push({ transitionId: transition.id, counts: parsed });
    }
    return { kind, scope, transitionFrames: frames };
  }

  function normalizedScope(doc: FreeformDocument): PdfScope | PanelError {
    if (!range) return { kind: 'full-show' };
    if (firstSetId === '') return error('pdfExport.error.validation.rangeNotChosen', 'pdf-export-first-set');
    if (lastSetId === '') return error('pdfExport.error.validation.rangeNotChosen', 'pdf-export-last-set');
    const first = doc.sets.findIndex(({ id }) => id === firstSetId);
    const last = doc.sets.findIndex(({ id }) => id === lastSetId);
    if (first < 0 || last < 0) return error('pdfExport.error.validation.unknownSet', first < 0 ? 'pdf-export-first-set' : 'pdf-export-last-set');
    if (first > last) return error('pdfExport.error.validation.rangeReversed', 'pdf-export-last-set');
    return { kind: 'inclusive-set-range', firstSetId, lastSetId };
  }

  function eligibleTransitions(doc: FreeformDocument): readonly FreeformDocument['transitions'][number][] {
    if (!range) return doc.transitions;
    const first = doc.sets.findIndex(({ id }) => id === firstSetId);
    const last = doc.sets.findIndex(({ id }) => id === lastSetId);
    return first < 0 || last < 0 || first > last ? [] : doc.transitions.filter((transition) => {
      const from = doc.sets.findIndex(({ id }) => id === transition.fromSetId);
      const to = doc.sets.findIndex(({ id }) => id === transition.toSetId);
      return from >= first && from <= last && to >= first && to <= last;
    });
  }

  return { render: () => { redraw(); return host; } };
}

function parseCounts(raw: string, maximum: number, controlId: string): number[] | PanelError {
  if (raw.trim() === '') return error('pdfExport.error.validation.transitionCountBlank', controlId);
  const seen = new Set<number>();
  const values: number[] = [];
  for (const token of raw.split(',').map((value) => value.trim())) {
    if (token === '' || /[^0-9.-]/.test(token) || (token.match(/-/g)?.length ?? 0) > 1 || (token.match(/\./g)?.length ?? 0) > 1 || (token.includes('-') && !token.startsWith('-')) || !/[0-9]/.test(token)) return error('pdfExport.error.validation.transitionCountMalformed', controlId);
    if (token.includes('.')) return error('pdfExport.error.validation.transitionCountDecimal', controlId, undefined, { count: token });
    if (token.startsWith('-')) return error('pdfExport.error.validation.transitionCountNegative', controlId, undefined, { count: token });
    const count = Number(token);
    if (count > maximum) return error('pdfExport.error.validation.transitionCountOutOfDomain', controlId, undefined, { count, counts: maximum });
    if (seen.has(count)) return error('pdfExport.error.validation.transitionCountDuplicate', controlId, undefined, { count });
    seen.add(count);
    values.push(count);
  }
  return values;
}

function warningText(document: FreeformDocument, result: Extract<PdfExportResult, { ok: true }>, warning: NoteOverlapWarning): string {
  const page = result.manifest.pages[warning.pageIndex];
  const performer = document.performers.find(({ id }) => id === warning.performerId);
  const rank = performer?.rankCode ?? warning.performerId;
  const annotation = document.annotations.find(({ id }) => id === warning.annotationId);
  const annotationLabel = annotation?.kind === 'label' || annotation?.kind === 'performerNote' ? annotation.text : 'note';
  const obstacle = warning.obstacleKind === 'dot' ? 'a dot' : 'a rank label';
  const bounds = `note ${rectangle(warning.noteBounds)}; ${obstacle} ${rectangle(warning.obstacleBounds)}`;
  const context = warningContext(document, warning);
  if (page?.kind === 'performer-packet') return `⚠ ${rank} (id ${warning.performerId}) packet, ${context}: a note (${annotationLabel}, id ${warning.annotationId}) may overlap ${obstacle} on this performer's own entry. Bounds: ${bounds}.`;
  return `⚠ Page ${warning.pageIndex + 1}, ${context}: a note (${annotationLabel}, id ${warning.annotationId}) near ${rank} may overlap ${obstacle} for ${rank} (id ${warning.performerId}). Bounds: ${bounds}.`;
}

function warningExplanation(document: FreeformDocument, warning: NoteOverlapWarning): string {
  const context = warning.context;
  if (context.kind === 'static-set') {
    const setName = document.sets.find(({ id }) => id === context.setId)?.name ?? context.setId;
    return `Freeform found possible overlaps between note text and dots or labels on these pages. It doesn't move anything automatically. Open ${setName} in the editor, move the note, and export again to check it.`;
  }
  const transition = document.transitions.find(({ id }) => id === context.transitionId);
  const from = document.sets.find(({ id }) => id === transition?.fromSetId)?.name ?? context.transitionId;
  const to = document.sets.find(({ id }) => id === transition?.toSetId)?.name ?? context.transitionId;
  return `Freeform found possible overlaps between note text and dots or labels on these pages. It doesn't move anything automatically. Open the transition ${from} → ${to} in the editor at count ${context.count}, move the note, and export again to check it.`;
}

function rectangle(bounds: Readonly<{ x: number; y: number; width: number; height: number }>): string {
  return `x ${bounds.x.toFixed(2)}, y ${bounds.y.toFixed(2)}, w ${bounds.width.toFixed(2)}, h ${bounds.height.toFixed(2)}`;
}

function error(messageKey: string, controlId?: string, fallbackControlId?: string, values: Readonly<Record<string, string | number>> = {}): PanelError {
  return { messageKey, message: messageFor(messageKey, values), controlId: controlId ?? fallbackControlId };
}
function messageFor(key: string, values: Readonly<Record<string, string | number>> = {}): string {
  const template = messages[key] ?? 'Freeform ran into a problem building this PDF. Your document is unchanged. Try again with a smaller range or fewer performers — if that doesn\'t help, try again later.';
  return template.replace(/<(count|counts)>/g, (placeholder, name: 'count' | 'counts') => String(values[name] ?? placeholder));
}
function downloadMessageKey(code: Extract<PdfExportErrorCode, 'blob-unavailable' | 'url-unavailable' | 'download-dispatch-failed' | 'cancelled'>): string {
  if (code === 'blob-unavailable') return 'pdfExport.error.blobUnavailable';
  if (code === 'url-unavailable') return 'pdfExport.error.urlUnavailable';
  if (code === 'download-dispatch-failed') return 'pdfExport.error.downloadFailed';
  return 'pdfExport.error.cancelled';
}
function performersFirstControl(document: FreeformDocument): string | undefined { return document.performers[0] ? `pdf-export-performer-${document.performers[0].id}` : undefined; }
function warningContext(document: FreeformDocument, warning: NoteOverlapWarning): string {
  const context = warning.context;
  if (context.kind === 'static-set') return `Set ${document.sets.find(({ id }) => id === context.setId)?.name ?? context.setId}`;
  const transition = document.transitions.find(({ id }) => id === context.transitionId);
  const from = document.sets.find(({ id }) => id === transition?.fromSetId)?.name ?? context.transitionId;
  const to = document.sets.find(({ id }) => id === transition?.toSetId)?.name ?? context.transitionId;
  return `${from} → ${to}, count ${context.count}`;
}
function transitionInScope(document: FreeformDocument, transition: FreeformDocument['transitions'][number], scope: PdfScope): boolean {
  if (scope.kind === 'full-show') return true;
  const first = document.sets.findIndex(({ id }) => id === scope.firstSetId);
  const last = document.sets.findIndex(({ id }) => id === scope.lastSetId);
  const from = document.sets.findIndex(({ id }) => id === transition.fromSetId);
  const to = document.sets.findIndex(({ id }) => id === transition.toSetId);
  return first >= 0 && last >= first && from >= first && from <= last && to >= first && to <= last;
}
function associateError(control: HTMLElement, failure: PanelError | undefined): void {
  if (!failure || failure.controlId !== control.id) return;
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', 'pdf-export-field-error');
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (className) node.className = className; return node; }
function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string): HTMLElementTagNameMap[K] { const node = element(tag, className); node.textContent = value; return node; }
function button(labelText: string, click: () => void): HTMLButtonElement { const node = document.createElement('button'); node.type = 'button'; node.textContent = labelText; node.addEventListener('click', click); return node; }
function label(value: string, control: HTMLInputElement | HTMLSelectElement): HTMLLabelElement { const node = document.createElement('label'); node.htmlFor = control.id; node.textContent = value; return node; }
function isDisabled(control: HTMLElement): boolean { return control instanceof HTMLButtonElement || control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement ? control.disabled : control.getAttribute('aria-disabled') === 'true'; }
function radio(name: string, id: string, value: string, visibleLabel: string, checked: boolean, change: () => void): HTMLElement { const wrapper = element('p', 'pdf-export-choice'); const control = document.createElement('input'); control.type = 'radio'; control.id = id; control.name = name; control.value = value; control.checked = checked; control.setAttribute('aria-label', visibleLabel); control.addEventListener('change', change); wrapper.append(control, label(visibleLabel, control)); return wrapper; }
function checkbox(id: string, visibleLabel: string, checked: boolean, disabled: boolean, change: () => void): HTMLElement { const wrapper = element('p', 'pdf-export-choice'); const control = document.createElement('input'); control.type = 'checkbox'; control.id = id; control.checked = checked; control.disabled = disabled; control.setAttribute('aria-label', visibleLabel); control.addEventListener('change', change); wrapper.append(control, label(visibleLabel, control)); return wrapper; }
function select(id: string, visibleLabel: string, options: readonly Readonly<{ value: string; label: string }>[], value: string, enabled: boolean, change: (value: string) => void): HTMLSelectElement { const control = document.createElement('select'); control.id = id; control.value = value; control.disabled = !enabled; control.setAttribute('aria-label', visibleLabel); control.append(new Option('Choose a set.', '')); for (const option of options) control.append(new Option(option.label, option.value)); control.value = value; control.addEventListener('change', () => change(control.value)); return control; }
