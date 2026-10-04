// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument } from '../document/types';
import { createPdfExportUi } from './export-ui';

function fixture(): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Original title', totalCounts: 16 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A', displayName: 'Alpha' }],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 16, positions: { a: { x: 28800, y: 14400 } } },
    ],
    transitions: [{ id: 'move-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float' }],
    annotations: [],
  };
}

function change(control: HTMLInputElement): void { control.dispatchEvent(new Event('change', { bubbles: true })); }
function submit(root: HTMLElement): void { root.querySelector<HTMLFormElement>('.pdf-export-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
function input(control: HTMLInputElement, value: string): void { control.value = value; control.dispatchEvent(new Event('input', { bubbles: true })); }
function choose(control: HTMLSelectElement, value: string): void { control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); }

function threeSetFixture(): FreeformDocument {
  const base = fixture();
  return {
    ...base,
    sets: [...base.sets, { id: 'set-3', name: 'Set 3', startCount: 32, positions: { a: { x: 57600, y: 28800 } } }],
    transitions: [
      ...base.transitions,
      { id: 'move-2', fromSetId: 'set-2', toSetId: 'set-3', counts: 16, mode: 'float' },
    ],
  };
}

function overlapFixture(): FreeformDocument {
  const base = fixture();
  return {
    ...base,
    layers: [{ id: 'notes', name: 'Notes', visible: true, print: true, locked: false }],
    annotations: [{
      id: 'show-note', kind: 'label', layerId: 'notes', scope: { kind: 'show' },
      visibility: { editor: true, print: true, performerPacket: false }, text: 'Snapshot warning', anchor: { x: 0, y: 0 },
    }],
  };
}

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('M8 export panel', () => {
  it('keeps disabled packet transition controls visible and binds exact preflight validation without store mutation', () => {
    const store = createCommandStore(fixture());
    const root = document.createElement('main');
    document.body.append(root);
    root.append(createPdfExportUi(store).render());
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();

    const packet = root.querySelector<HTMLInputElement>('#pdf-export-packet')!;
    packet.checked = true;
    change(packet);
    expect(root.querySelector<HTMLElement>('fieldset')?.textContent).toContain('What do you want to export?');
    expect(root.querySelector<HTMLInputElement>('#pdf-export-transition-move-1')?.disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('#pdf-export-counts-move-1')?.disabled).toBe(true);
    expect(root.textContent).toContain("Transition pages aren't part of performer packets.");

    const before = store.getState();
    submit(root);
    expect(root.textContent).toContain('Choose at least one performer.');
    expect(store.getState()).toBe(before);
    expect(store.canUndo()).toBe(false);

    const director = root.querySelector<HTMLInputElement>('#pdf-export-director')!;
    director.checked = true;
    change(director);
    const transition = root.querySelector<HTMLInputElement>('#pdf-export-transition-move-1')!;
    transition.checked = true;
    change(transition);
    const counts = root.querySelector<HTMLInputElement>('#pdf-export-counts-move-1')!;
    counts.value = '-.';
    counts.dispatchEvent(new Event('input', { bubbles: true }));
    submit(root);
    expect(root.textContent).toContain('Use whole numbers separated by commas, like 0, 8, 16.');
    expect(store.getState()).toBe(before);
  });

  it('captures bytes from the pre-import snapshot and only dispatches on Download', async () => {
    const store = createCommandStore(fixture());
    const root = document.createElement('main');
    document.body.append(root);
    root.append(createPdfExportUi(store).render());
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();
    const before = store.getState();
    submit(root);
    store.apply({ type: 'show.title.set', title: 'Edited while exporting' });
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('#pdf-export-download')).not.toBeNull(), { timeout: 30_000 });
    const download = root.querySelector<HTMLButtonElement>('#pdf-export-download')!;
    expect(download.textContent).toContain('Original title-director-full-show.pdf');
    expect(store.getState().document.show.title).toBe('Edited while exporting');
    expect(store.getState().revision).toBe(before.revision + 1);
    [...root.querySelectorAll<HTMLButtonElement>('.pdf-export-panel button')].find((control) => control.textContent === 'Close')!.click();
    expect(root.querySelector('#pdf-export-download')).toBeNull();
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();
    expect(root.querySelector<HTMLButtonElement>('#pdf-export-download')?.textContent).toContain('Original title-director-full-show.pdf');
    const dispatch = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:m8'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(dispatch);
    download.click();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('Started downloading Original title-director-full-show.pdf.');
  });

  it('interpolates count failures exactly and retains focus across a control redraw', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    root.append(createPdfExportUi(createCommandStore(fixture())).render());
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();
    const packet = root.querySelector<HTMLInputElement>('#pdf-export-packet')!;
    packet.focus();
    packet.checked = true;
    change(packet);
    await Promise.resolve();
    expect(document.activeElement).toBe(root.querySelector('#pdf-export-packet'));

    const director = root.querySelector<HTMLInputElement>('#pdf-export-director')!;
    director.checked = true;
    change(director);
    await Promise.resolve();
    const transition = root.querySelector<HTMLInputElement>('#pdf-export-transition-move-1')!;
    transition.checked = true;
    change(transition);
    await Promise.resolve();
    const counts = () => root.querySelector<HTMLInputElement>('#pdf-export-counts-move-1')!;
    input(counts(), '1.5'); submit(root);
    expect(root.textContent).toContain("1.5 isn't a whole number. Counts can't have a decimal point.");
    input(counts(), '-08'); submit(root);
    expect(root.textContent).toContain("-08 can't be negative. Counts start at 0.");
    input(counts(), '17'); submit(root);
    expect(root.textContent).toContain("17 isn't a valid count for this transition. Use a whole number from 0 through 16.");
    input(counts(), '08, 8'); submit(root);
    expect(root.textContent).toContain('8 is listed more than once. Remove the duplicate.');
    await Promise.resolve();
    expect(document.activeElement).toBe(counts());
  });

  it('restores idless-selection replacements and disclosure summaries by logical control', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const ui = createPdfExportUi(createCommandStore(overlapFixture()));
    root.append(ui.render());
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();
    const packet = root.querySelector<HTMLInputElement>('#pdf-export-packet')!;
    packet.checked = true;
    change(packet);
    const selectAll = root.querySelector<HTMLButtonElement>('#pdf-export-performers-select-all')!;
    selectAll.focus();
    selectAll.click();
    await Promise.resolve();
    expect(document.activeElement).toBe(root.querySelector('#pdf-export-performers-select-all'));
    const clearAll = root.querySelector<HTMLButtonElement>('#pdf-export-performers-clear-all')!;
    clearAll.focus();
    clearAll.click();
    await Promise.resolve();
    expect(document.activeElement).toBe(root.querySelector('#pdf-export-performers-clear-all'));

    const director = root.querySelector<HTMLInputElement>('#pdf-export-director')!;
    director.checked = true;
    change(director);
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('#pdf-export-warning-details')).not.toBeNull(), { timeout: 30_000 });
    const warningSummary = root.querySelector<HTMLElement>('#pdf-export-warning-details')!;
    warningSummary.focus();
    ui.render();
    await Promise.resolve();
    expect(document.activeElement).toBe(root.querySelector('#pdf-export-warning-details'));

    root.querySelector<HTMLButtonElement>('#pdf-export-close')!.focus();
    root.querySelector<HTMLButtonElement>('#pdf-export-close')!.click();
    await Promise.resolve();
    expect(document.activeElement).toBe(root.querySelector('#pdf-export-invoke'));
  });

  it('refreshes range eligibility and rejects a retained checked transition instead of silently dropping it', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    root.append(createPdfExportUi(createCommandStore(threeSetFixture())).render());
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();
    const range = root.querySelector<HTMLInputElement>('#pdf-export-range')!;
    range.checked = true;
    change(range);
    choose(root.querySelector('#pdf-export-first-set')!, 'set-1');
    choose(root.querySelector('#pdf-export-last-set')!, 'set-2');
    const transition = root.querySelector<HTMLInputElement>('#pdf-export-transition-move-1')!;
    transition.checked = true;
    change(transition);
    input(root.querySelector('#pdf-export-counts-move-1')!, '0');
    const last = root.querySelector<HTMLSelectElement>('#pdf-export-last-set')!;
    last.focus();
    choose(last, 'set-1');
    await Promise.resolve();
    expect(root.querySelector('#pdf-export-transition-move-1')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('#pdf-export-last-set'));
    submit(root);
    expect(root.textContent).toContain("This transition isn't fully inside the sets you chose, so it can't be included.");
    await Promise.resolve();
    expect(document.activeElement).toBe(root.querySelector('#pdf-export-transitions'));
  });

  it('keeps ready bytes and a retry control after a simulated URL-dispatch failure', async () => {
    const store = createCommandStore(fixture());
    const root = document.createElement('main');
    document.body.append(root);
    root.append(createPdfExportUi(store).render());
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();
    submit(root);
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('#pdf-export-download')).not.toBeNull(), { timeout: 30_000 });
    const filename = root.querySelector<HTMLButtonElement>('#pdf-export-download')!.textContent;
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => { throw new Error('simulated'); }), revokeObjectURL: vi.fn() });
    root.querySelector<HTMLButtonElement>('#pdf-export-download')!.click();
    expect(root.textContent).toContain("Freeform built your PDF but this browser couldn't start the download from it.");
    expect(root.querySelector<HTMLButtonElement>('#pdf-export-download')?.textContent).toBe(filename);
    const dispatch = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:retry'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(dispatch);
    root.querySelector<HTMLButtonElement>('#pdf-export-download')!.click();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('Started downloading Original title-director-full-show.pdf.');
  });

  it('does not invoke document mutation, undo, or redo paths across success and dispatch failure', async () => {
    const store = createCommandStore(fixture());
    const apply = vi.spyOn(store, 'apply');
    const undo = vi.spyOn(store, 'undo');
    const redo = vi.spyOn(store, 'redo');
    const before = store.getState();
    const root = document.createElement('main');
    document.body.append(root);
    root.append(createPdfExportUi(store).render());
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();
    submit(root);
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('#pdf-export-download')).not.toBeNull(), { timeout: 30_000 });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => { throw new Error('simulated URL failure'); }), revokeObjectURL: vi.fn() });
    root.querySelector<HTMLButtonElement>('#pdf-export-download')!.click();
    expect(root.querySelector('#pdf-export-download')).not.toBeNull();
    expect(store.getState()).toBe(before);
    expect(store.getUndoCommands()).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it('keeps overlap warning labels and manual correction context bound to the exported snapshot', async () => {
    const store = createCommandStore(overlapFixture());
    const root = document.createElement('main');
    document.body.append(root);
    root.append(createPdfExportUi(store).render());
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();
    submit(root);
    await vi.waitFor(() => expect(root.textContent).toContain('possible overlaps in this export'), { timeout: 30_000 });
    expect(root.textContent).toContain('Set Set 1');
    expect(root.textContent).toContain("It doesn't move anything automatically.");
    const changed: FreeformDocument = { ...store.getState().document, sets: store.getState().document.sets.map((set) => set.id === 'set-1' ? { ...set, name: 'Renamed after export' } : set) };
    store.apply({ type: 'document.replace', document: changed });
    root.querySelector<HTMLButtonElement>('#pdf-export-close')!.click();
    root.querySelector<HTMLButtonElement>('#pdf-export-invoke')!.click();
    const warnings = root.querySelector<HTMLElement>('.pdf-export-warnings')!;
    expect(warnings.textContent).toContain('Set Set 1');
    expect(warnings.textContent).not.toContain('Renamed after export');
  });
});
