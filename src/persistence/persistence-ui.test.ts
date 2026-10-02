// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createCommandStore } from '../document/command-store';
import { createEmptyDocument } from '../editor/setup-wizard';
import { createPersistenceUi } from './persistence-ui';

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
});

function fill(root: HTMLElement, selector: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
