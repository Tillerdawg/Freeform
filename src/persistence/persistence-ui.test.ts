// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommandStore } from '../document/command-store';
import { createEmptyDocument } from '../editor/setup-wizard';
import { decodeDocument, encodeDocument } from './freeform-file';
import { createPersistenceUi } from './persistence-ui';
import { openPersistenceAdapter } from './idb-adapter';
import { writeWorkingCopy } from './working-copy-store';

const report = {
  supported: true,
  capabilities: { indexedDb: true, webWorkers: true, esModules: true, fileSystemAccess: false },
  messages: ['Required capabilities are available: IndexedDB, ES modules, and Web Workers.'],
} as const;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('createPersistenceUi', () => {
  it('adds the real persistence controls after first-run setup', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const ui = createPersistenceUi(root, createCommandStore(createEmptyDocument()), report);
    ui.start();

    fill(root, '#setup-title', 'Persistence Test');
    fill(root, '#setup-instrument-1', 'Trumpet');
    fill(root, '#setup-count-1', '1');
    fill(root, '#setup-prefix-1', 'T');
    root.querySelector<HTMLFormElement>('.setup-wizard')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(root.textContent).toContain('Document name');
    expect(root.textContent).toContain('Save As…');
    expect(root.textContent).toContain('Version history');
    expect(root.textContent).toContain('Choose backup folder…');
    expect(root.textContent).toContain('Keyboard shortcuts');
    expect(root.querySelector('#persistence-controls')).not.toBeNull();
    ui.dispose();
  });

  it('keeps native undo in text inputs and routes editor undo through the command store', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const ui = createPersistenceUi(root, createCommandStore(createEmptyDocument()), report);
    ui.start();
    ui.store.apply({ type: 'show.title.set', title: 'Changed title' });

    const input = root.querySelector<HTMLInputElement>('#setup-title')!;
    const nativeUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(nativeUndo);
    expect(nativeUndo.defaultPrevented).toBe(false);

    const appUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    root.dispatchEvent(appUndo);
    expect(appUndo.defaultPrevented).toBe(true);
    expect(ui.store.getState().document.show.title).toBe('Untitled Show');
    ui.dispose();
  });

  it('keeps the focused document-title element and its uncommitted draft through an unrelated control refresh', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const ui = createPersistenceUi(root, createCommandStore(createEmptyDocument()), report);
    ui.start();
    completeSetup(root);

    const title = root.querySelector<HTMLInputElement>('#document-title')!;
    title.focus();
    title.value = 'Typing without committing';
    title.setSelectionRange(7, 14);
    ui.store.apply({ type: 'show.title.set', title: 'Committed elsewhere' });
    root.querySelector<HTMLInputElement>('#rank-code')!.value = 'T2';
    root.querySelector<HTMLInputElement>('#display-name')!.value = 'Two';
    root.querySelector<HTMLFormElement>('form.editor-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(root.querySelector('#document-title')).toBe(title);
    expect(document.activeElement).toBe(title);
    expect(title.value).toBe('Typing without committing');
    expect(title.selectionStart).toBe(7);
    expect(title.selectionEnd).toBe(14);
    ui.dispose();
  });

  it('commits repeated rename-back values to the current document and preserves history, saved/dirty status, and export bytes', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const ui = createPersistenceUi(root, createCommandStore(createEmptyDocument()), report);
    ui.start();
    completeSetup(root);

    const title = root.querySelector<HTMLInputElement>('#document-title')!;
    const initialRevision = ui.store.getState().revision;
    rename(title, 'First rename');
    rename(title, 'Second rename');
    rename(title, 'Persistence Test');

    expect(ui.store.getState().document.show.title).toBe('Persistence Test');
    expect(ui.store.getState().revision).toBe(initialRevision + 3);
    expect(ui.store.getUndoCommands().slice(-3)).toEqual([
      { type: 'show.title.set', title: 'First rename' },
      { type: 'show.title.set', title: 'Second rename' },
      { type: 'show.title.set', title: 'Persistence Test' },
    ]);
    expect(root.querySelector('#persistence-state')?.textContent).toBe('Unsaved changes');

    expect(ui.store.undo()?.document.show.title).toBe('Second rename');
    expect(ui.store.redo()?.document.show.title).toBe('Persistence Test');
    const exported = decodeDocument(encodeDocument(ui.store.getState().document));
    expect(exported).toMatchObject({ kind: 'editable', document: { show: { title: 'Persistence Test' } } });
    const download = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: download.mockReturnValue('blob:freeform-test'), revokeObjectURL: vi.fn() });
    root.querySelector<HTMLButtonElement>('.persistence-controls__buttons button')!.click();
    await vi.waitFor(() => expect(root.querySelector('#persistence-state')?.textContent).toBe('Saved'));
    expect(download).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();

    const previousDocument = ui.store.getState().document;
    ui.store.apply({
      type: 'document.replace',
      document: { ...previousDocument, show: { ...previousDocument.show, id: 'switched-document', title: 'Switched document' } },
    });
    expect(root.querySelector('#document-title')).toBe(title);
    rename(title, 'Switched document renamed');
    expect(ui.store.getState().document.show).toMatchObject({ id: 'switched-document', title: 'Switched document renamed' });
    expect(previousDocument.show.title).toBe('Persistence Test');
    ui.dispose();
  });

  it('does not mutate an unchanged live status during committed editor refreshes', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const ui = createPersistenceUi(root, createCommandStore(createEmptyDocument()), report);
    ui.start();
    completeSetup(root);

    const chip = root.querySelector<HTMLElement>('#persistence-state')!;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(chip, { attributes: true, attributeFilter: ['class', 'title'], childList: true, characterData: true, subtree: true });
    ui.store.apply({ type: 'show.title.set', title: 'Refresh one' });
    ui.store.apply({ type: 'show.title.set', title: 'Refresh two' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chip.textContent).toBe('Unsaved changes');
    expect(mutations).toEqual([]);
    observer.disconnect();
    ui.dispose();
  });

  it('mutates the live status when local backup meaningfully fails', async () => {
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('IndexedDB unavailable'); });
    const root = document.createElement('main');
    document.body.append(root);
    const ui = createPersistenceUi(root, createCommandStore(createEmptyDocument()), report);
    ui.start();
    completeSetup(root);

    const chip = root.querySelector<HTMLElement>('#persistence-state')!;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(chip, { attributes: true, attributeFilter: ['class', 'title'], childList: true, characterData: true, subtree: true });
    await vi.waitFor(() => expect(chip.textContent).toBe('Local backup failed'));

    expect(mutations.length).toBeGreaterThan(0);
    expect(chip.className).toContain('persistence-state--failed');
    observer.disconnect();
    ui.dispose();
    open.mockRestore();
  });

  it('warns accurately about recovery replacement: undoable this session, not a durable backup claim', async () => {
    const candidateId = 'recovery-copy-test-candidate';
    localStorage.setItem('freeform-known-document-ids', JSON.stringify([candidateId]));
    const adapter = await openPersistenceAdapter();
    const base = createEmptyDocument();
    const candidateDocument = {
      ...base,
      show: { id: candidateId, title: 'Recovered Show', totalCounts: 0 },
      performers: [{ id: 'p1', rankCode: 'T1', displayName: 'One' }],
      sets: [{ id: 'set-1', name: 'Opener', startCount: 0, positions: { p1: { x: 0, y: 0 } } }],
    };
    await writeWorkingCopy(adapter, candidateId, 1, candidateDocument, Date.now());
    adapter.close();

    const root = document.createElement('main');
    document.body.append(root);
    const originalDocument = createEmptyDocument();
    const ui = createPersistenceUi(root, createCommandStore(originalDocument), report);
    ui.start();
    await vi.waitFor(() => expect(root.querySelector('.recovery-panel')).not.toBeNull());

    const findButton = (text: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.recovery-panel__row button')).find((b) => b.textContent === text)!;
    findButton('Replace current with this').click();

    const dialog = document.querySelector<HTMLElement>('.persistence-dialog')!;
    const warningText = dialog.textContent ?? '';
    // The warning must not claim the replacement is permanently unrecoverable:
    // document.replace is a normal undo-history entry (command-store.ts),
    // so Ctrl+Z/Cmd+Z restores the prior document within this session.
    expect(warningText).not.toContain("can't be undone");
    expect(warningText).toContain('Ctrl+Z');
    expect(warningText).toContain('Cmd+Z');
    // It also must not promise durable/file-level recovery after a restart —
    // only that in-session undo works.
    expect(warningText).not.toMatch(/restart|backup file|automatically restored/i);

    const dialogButton = (text: string) =>
      Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)!;

    // Cancelling must leave the document and history untouched.
    dialogButton('Cancel').click();
    expect(document.querySelector('.persistence-dialog')).toBeNull();
    expect(ui.store.getState().document.show.id).toBe(originalDocument.show.id);
    expect(ui.store.getUndoCommands()).toEqual([]);

    // Replacing, then actually exercising the undo shortcut the warning
    // promises, must restore the exact original document.
    findButton('Replace current with this').click();
    const secondDialog = document.querySelector<HTMLElement>('.persistence-dialog')!;
    Array.from(secondDialog.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Replace')!.click();
    await vi.waitFor(() => expect(ui.store.getState().document.show.id).toBe(candidateId));

    const restored = ui.store.undo();
    expect(restored?.document.show.id).toBe(originalDocument.show.id);
    ui.dispose();
  });
});

function fill(root: HTMLElement, selector: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function completeSetup(root: HTMLElement): void {
  fill(root, '#setup-title', 'Persistence Test');
  fill(root, '#setup-instrument-1', 'Trumpet');
  fill(root, '#setup-count-1', '1');
  fill(root, '#setup-prefix-1', 'T');
  root.querySelector<HTMLFormElement>('.setup-wizard')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function rename(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
