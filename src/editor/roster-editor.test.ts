// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument } from '../document/types';
import type { FeatureReport } from '../platform/features';
import { renderDotEditor } from './dot-editor';
import {
  addPerformerToRosterPrefix,
  listRosterPrefixes,
  renderRosterEditor,
} from './roster-editor';

const supportedReport: FeatureReport = {
  supported: true,
  capabilities: { indexedDb: true, webWorkers: true, esModules: true, fileSystemAccess: false },
  messages: ['Required capabilities are available.'],
};
const originalConfirm = window.confirm;

function rosterDocument(): FreeformDocument {
  return {
    format: 'freeform',
    formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Roster editor', totalCounts: 16 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [
      { id: 'p1', rankCode: 'P1', displayName: 'P1', section: 'Piccolo' },
      { id: 'p2', rankCode: 'P2', displayName: 'P2', section: 'Piccolo' },
      { id: 'c1', rankCode: 'C1', displayName: 'C1', section: 'Clarinet' },
    ],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { p1: { x: 28800, y: 36000 }, p2: { x: 142200, y: 0 }, c1: { x: 145800, y: 7200 } } },
      { id: 'set-2', name: 'Set 2', startCount: 16, positions: { p1: { x: 259200, y: 118000 }, p2: { x: 142200, y: 0 }, c1: { x: 145800, y: 7200 } } },
    ],
    transitions: [],
    annotations: [],
  };
}

function ftlDocument(): FreeformDocument {
  return {
    format: 'freeform',
    formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'FTL roster editor', totalCounts: 4 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [
      { id: 'a', rankCode: 'A1', displayName: 'A1', section: 'Alto' },
      { id: 'b', rankCode: 'A2', displayName: 'A2', section: 'Alto' },
    ],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 4, positions: { a: { x: 100, y: 0 }, b: { x: 200, y: 0 } } },
    ],
    transitions: [{
      id: 'ftl-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 4, mode: 'ftl',
      ftl: {
        leaderId: 'a', followerIds: ['b'], offsetUnits: { a: 0, b: 100 }, distanceUnits: 100,
        path: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      },
    }],
    annotations: [],
  };
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function renderRoster(root: HTMLElement, store = createCommandStore(rosterDocument()), setStatus = vi.fn()): ReturnType<typeof createCommandStore> {
  const render = (): void => root.replaceChildren(renderRosterEditor({ store, onCommitted: render, setStatus }));
  render();
  return store;
}

afterEach(() => {
  document.body.replaceChildren();
  window.confirm = originalConfirm;
  vi.restoreAllMocks();
});

describe('post-wizard roster editor', () => {
  it('reconstructs existing prefix groups and adds the next rank code at field center without resetting manually shaped dots', () => {
    const store = createCommandStore(rosterDocument());

    expect(listRosterPrefixes(store.getState().document)).toEqual([
      { prefix: 'P', section: 'Piccolo', nextNumber: 3 },
      { prefix: 'C', section: 'Clarinet', nextNumber: 2 },
    ]);
    const performer = addPerformerToRosterPrefix(store, 'P');

    expect(performer).toEqual({ id: 'p3', rankCode: 'P3', displayName: 'P3', section: 'Piccolo' });
    expect(store.getState().document.sets.map((set) => set.positions.p3)).toEqual([
      { x: 144000, y: 76800 },
      { x: 144000, y: 76800 },
    ]);
    expect(store.getState().document.sets.map((set) => set.positions.p1)).toEqual([
      { x: 28800, y: 36000 },
      { x: 259200, y: 118000 },
    ]);
    expect(store.getUndoCommands().at(-1)).toMatchObject({ type: 'performer.create', performer: { rankCode: 'P3' } });
  });

  it('saves every changed display name as one atomic batch command from the roster table', () => {
    const root = document.createElement('div');
    const status = vi.fn();
    const store = renderRoster(root, createCommandStore(rosterDocument()), status);
    const names = root.querySelectorAll<HTMLInputElement>('.roster-display-name');
    names[0]!.value = 'Alex Kim';
    names[1]!.value = 'Bea Jones';

    submit(root.querySelector<HTMLFormElement>('#roster-display-names')!);

    expect(store.getState().document.performers.map((performer) => performer.displayName)).toEqual(['Alex Kim', 'Bea Jones', 'C1']);
    expect(store.getUndoCommands()).toEqual([{
      type: 'performer.displayName.batchSet',
      updates: { p1: 'Alex Kim', p2: 'Bea Jones' },
    }]);
    expect(status).toHaveBeenLastCalledWith('Saved 2 display names in one roster command.');
  });

  it('confirms removal, removes coverage from all sets, and routes FTL invalidation through the existing timeline block state', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const store = createCommandStore(ftlDocument());
    let confirmationMessage = '';
    window.confirm = (message) => {
      confirmationMessage = message ?? '';
      return true;
    };
    renderDotEditor(root, { store, report: supportedReport });

    root.querySelector<HTMLButtonElement>('button[data-performer-id="b"]')!.click();

    expect(store.getState().document.performers.map((performer) => performer.id)).toEqual(['a']);
    expect(store.getState().document.sets.every((set) => !('b' in set.positions))).toBe(true);
    expect(confirmationMessage).toBe('Remove A2? Transition ftl-1 uses it in FTL playback and will become blocked until repaired.');
    expect(root.textContent).toContain('FTL playback is blocked for transition ftl-1; see the Transition timeline to repair it.');
    expect(root.textContent).toContain('FTL playback blocked: FTL_MISSING_MEMBER: FTL formation references removed or unknown performer(s): b.');
  });

  it('leaves the document, dot coverage, FTL definition, and undo history unchanged when removal is cancelled', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const store = createCommandStore(ftlDocument());
    const before = store.getState();
    let confirmationMessage = '';
    window.confirm = (message) => {
      confirmationMessage = message ?? '';
      return false;
    };
    renderDotEditor(root, { store, report: supportedReport });

    root.querySelector<HTMLButtonElement>('button[data-performer-id="b"]')!.click();

    expect(confirmationMessage).toBe('Remove A2? Transition ftl-1 uses it in FTL playback and will become blocked until repaired.');
    expect(store.getState()).toBe(before);
    expect(store.getState().document.sets.map((set) => set.positions)).toEqual(before.document.sets.map((set) => set.positions));
    expect(store.getState().document.transitions).toEqual(before.document.transitions);
    expect(store.getUndoCommands()).toEqual([]);
  });
});
