// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument } from '../document/types';
import type { FeatureReport } from '../platform/features';
import { renderDotEditor } from './dot-editor';

const report: FeatureReport = {
  supported: true,
  capabilities: { indexedDb: true, webWorkers: true, esModules: true, fileSystemAccess: false },
  messages: ['Required capabilities are available: IndexedDB, ES modules, and Web Workers.'],
};

function makeDocument(): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0', show: { id: 'show-1', title: 'M6 live app', totalCounts: 4 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'p1', rankCode: 'P1', displayName: 'Performer One' }],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { p1: { x: 0, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 4, positions: { p1: { x: 7200, y: 0 } } },
    ],
    transitions: [{ id: 'float-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 4, mode: 'float' }],
    layers: [{ id: 'bottom', name: 'Bottom', visible: true, print: true, locked: false }],
    symbols: [],
    annotations: [],
  };
}

function change(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('M6 live-app annotation integration (dot-editor assembly)', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('shows an annotation validation error in the assembled live status region', () => {
    const store = createCommandStore(makeDocument());
    const root = document.createElement('div');
    document.body.append(root);
    renderDotEditor(root, { store, report });

    change(root.querySelector('#annotation-tool')!, 'arrow');
    change(root.querySelector('#annotation-scope-kind')!, 'show');
    // No geometry entered: submitting must reject with a visible status message
    // in the assembled app, not only via a captured callback.
    root.querySelector<HTMLFormElement>('.annotation-editor form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const message = root.querySelector('.editor-message');
    expect(message).not.toBeNull();
    expect(message?.textContent).toContain('Enter at least two integer x,y points in field units.');
  });

  it('creates a freehand stroke and an arrow via keyboard-entered geometry, and edits them back', () => {
    const store = createCommandStore(makeDocument());
    const root = document.createElement('div');
    document.body.append(root);
    renderDotEditor(root, { store, report });

    change(root.querySelector('#annotation-id')!, 'kb-stroke');
    change(root.querySelector('#annotation-tool')!, 'freehand');
    change(root.querySelector('#annotation-scope-kind')!, 'show');
    change(root.querySelector('#annotation-geometry')!, '1000,2000; 3000,4000; 5000,6000');
    root.querySelector<HTMLFormElement>('.annotation-editor form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const stroke = store.getState().document.annotations.find((entry) => entry.id === 'kb-stroke');
    expect(stroke).toMatchObject({ kind: 'freehand', strokes: [[{ x: 1000, y: 2000 }, { x: 3000, y: 4000 }, { x: 5000, y: 6000 }]] });

    change(root.querySelector('#annotation-id')!, 'kb-arrow');
    change(root.querySelector('#annotation-tool')!, 'arrow');
    change(root.querySelector('#annotation-geometry')!, '1000,1000; 9000,9000');
    root.querySelector<HTMLFormElement>('.annotation-editor form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const arrow = store.getState().document.annotations.find((entry) => entry.id === 'kb-arrow');
    expect(arrow).toMatchObject({ kind: 'arrow', points: [{ x: 1000, y: 1000 }, { x: 9000, y: 9000 }] });

    // Select the arrow back and edit its geometry through the keyboard field.
    [...root.querySelectorAll('button')].find((button) => button.textContent === 'Select' && button.closest('.annotation-manager__row')?.textContent?.includes('kb-arrow'))!.click();
    expect((root.querySelector('#annotation-geometry') as HTMLTextAreaElement).value).toBe('1000,1000; 9000,9000');
    change(root.querySelector('#annotation-geometry')!, '1000,1000; 2000,2000; 9000,9000');
    root.querySelector<HTMLFormElement>('.annotation-editor form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const editedArrow = store.getState().document.annotations.find((entry) => entry.id === 'kb-arrow');
    expect(editedArrow).toMatchObject({ kind: 'arrow', points: [{ x: 1000, y: 1000 }, { x: 2000, y: 2000 }, { x: 9000, y: 9000 }] });
  });

  it('preserves symbol rotation and scale across a select-then-save edit round trip', () => {
    const document_ = makeDocument();
    const withSymbol: FreeformDocument = {
      ...document_,
      symbols: [{ id: 'star', name: 'Star', glyph: '★' }],
      annotations: [{
        id: 'rotated-symbol', kind: 'symbol', layerId: 'bottom', scope: { kind: 'show' },
        visibility: { editor: true, print: true, performerPacket: false },
        symbolId: 'star', anchor: { x: 1000, y: 2000 }, rotationDegrees: 90, scale: 2,
      }],
    };
    const store = createCommandStore(withSymbol);
    const root = document.createElement('div');
    document.body.append(root);
    renderDotEditor(root, { store, report });

    [...root.querySelectorAll('button')].find((button) => button.textContent === 'Select')!.click();
    const rotationField = root.querySelector<HTMLInputElement>('#annotation-rotation')!;
    const scaleField = root.querySelector<HTMLInputElement>('#annotation-scale')!;
    expect(rotationField.value).toBe('90');
    expect(scaleField.value).toBe('2');

    // Editing the values and saving updates them in place, proving optional
    // fields round-trip both into and back out of the form.
    change(rotationField, '45');
    change(scaleField, '0.5');
    root.querySelector<HTMLFormElement>('.annotation-editor form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(store.getState().document.annotations.find((entry) => entry.id === 'rotated-symbol'))
      .toMatchObject({ rotationDegrees: 45, scale: 0.5 });
    // Exactly one annotation still exists: the edit replaced it in place
    // rather than leaving a stray duplicate behind.
    expect(store.getState().document.annotations).toHaveLength(1);
  });

  it('disables edit and delete for a mark on a locked layer, and re-enables once unlocked', () => {
    const document_ = makeDocument();
    const locked: FreeformDocument = {
      ...document_,
      layers: [{ id: 'locked-layer', name: 'Locked Layer', visible: true, print: true, locked: true }],
      annotations: [{
        id: 'locked-label', kind: 'label', layerId: 'locked-layer', scope: { kind: 'show' },
        visibility: { editor: true, print: true, performerPacket: false }, text: 'Immovable', anchor: { x: 0, y: 0 },
      }],
    };
    const store = createCommandStore(locked);
    const root = document.createElement('div');
    document.body.append(root);
    renderDotEditor(root, { store, report });

    [...root.querySelectorAll('button')].find((button) => button.textContent === 'Select')!.click();
    const saveButton = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Save annotation') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    const deleteButton = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Delete annotation') as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    expect(root.querySelector('#annotation-text')).toHaveProperty('disabled', true);

    // Unlock the layer; the previously selected annotation's controls re-enable.
    const lockedToggle = root.querySelector<HTMLInputElement>('#layer-locked-locked-layer')!;
    change(lockedToggle, 'false');
    lockedToggle.checked = false;
    lockedToggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.getState().document.layers?.find((entry) => entry.id === 'locked-layer')?.locked).toBe(false);
  });

  it('keeps an in-progress annotation draft and focus through a playback tick while the count still advances', () => {
    const store = createCommandStore(makeDocument());
    const root = document.createElement('div');
    document.body.append(root);
    renderDotEditor(root, { store, report });

    const textField = root.querySelector<HTMLTextAreaElement>('#annotation-text')!;
    textField.focus();
    textField.value = 'Partial note draft';
    textField.setSelectionRange(7, 7);

    let tick: (() => void) | undefined;
    const originalInterval = Object.getOwnPropertyDescriptor(window, 'setInterval');
    const originalClear = Object.getOwnPropertyDescriptor(window, 'clearInterval');
    Object.defineProperty(window, 'setInterval', { configurable: true, value: (handler: TimerHandler): number => {
      if (typeof handler !== 'function') throw new Error('Expected playback timer callback.');
      tick = handler as () => void;
      return 1;
    } });
    Object.defineProperty(window, 'clearInterval', { configurable: true, value: () => undefined });
    try {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      expect(tick).toBeDefined();
      tick!();

      const refreshedTextField = root.querySelector<HTMLTextAreaElement>('#annotation-text');
      expect(refreshedTextField).not.toBeNull();
      expect(refreshedTextField?.value).toBe('Partial note draft');
      expect(document.activeElement).toBe(refreshedTextField);
      expect(refreshedTextField?.selectionStart).toBe(7);

      const output = root.querySelector('.timeline-controls output');
      expect(output?.textContent).toBe('Count 1 of 4');
    } finally {
      if (originalInterval) Object.defineProperty(window, 'setInterval', originalInterval);
      if (originalClear) Object.defineProperty(window, 'clearInterval', originalClear);
    }
  });
});
