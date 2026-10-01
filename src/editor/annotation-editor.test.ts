// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument } from '../document/types';
import { renderAnnotationEditor } from './annotation-editor';
import { renderAnnotationContextView, renderAnnotationOverlay } from './annotation-renderer';

function makeDocument(): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0', show: { id: 'show', title: 'M6', totalCounts: 16 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'p1', rankCode: 'P1', displayName: 'Performer One' }],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { p1: { x: 100000, y: 50000 } } },
      { id: 'set-2', name: 'Set 2', startCount: 16, positions: { p1: { x: 120000, y: 60000 } } },
    ],
    transitions: [{ id: 'transition-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float' }],
    layers: [
      { id: 'bottom', name: 'Bottom', visible: true, print: true, locked: false },
      { id: 'top', name: 'Top', visible: true, print: true, locked: true },
    ],
    symbols: [{ id: 'star', name: 'Star', glyph: '★' }],
    annotations: [
      { id: 'show', kind: 'label', layerId: 'bottom', scope: { kind: 'show' }, visibility: { editor: true, print: true, performerPacket: false }, text: 'Show', anchor: { x: 0, y: 0 } },
      { id: 'set', kind: 'label', layerId: 'bottom', scope: { kind: 'set', setId: 'set-1' }, visibility: { editor: true, print: true, performerPacket: false }, text: 'Set', anchor: { x: 1000, y: 1000 } },
      { id: 'transition', kind: 'label', layerId: 'top', scope: { kind: 'transition', transitionId: 'transition-1' }, visibility: { editor: true, print: true, performerPacket: false }, text: 'Transition', anchor: { x: 2000, y: 2000 } },
    ],
  };
}

function change(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string | boolean): void {
  if (typeof value === 'boolean' && control instanceof HTMLInputElement) control.checked = value;
  else control.value = String(value);
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('M6 annotation editor and renderer', () => {
  it('renders canonical-FU annotations with front-bottom orientation and excludes endpoint marks in transition context', () => {
    const documentState = makeDocument();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    renderAnnotationOverlay(svg, documentState, { audience: 'editor', context: { kind: 'static-set', setId: 'set-1' } });
    const texts = [...svg.querySelectorAll('text')];
    expect(texts.map((entry) => entry.textContent)).toEqual(['Show', 'Set']);
    expect(texts[0]?.getAttribute('x')).toBe('40');
    expect(texts[0]?.getAttribute('y')).toBe('520');
    expect(texts.every((entry) => entry.getAttribute('transform') === null)).toBe(true);

    const transitionSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    renderAnnotationOverlay(transitionSvg, documentState, { audience: 'editor', context: { kind: 'active-transition', transitionId: 'transition-1' } });
    expect([...transitionSvg.querySelectorAll('text')].map((entry) => entry.textContent)).toEqual(['Show', 'Transition']);
    expect(renderAnnotationContextView(documentState, { audience: 'editor', context: { kind: 'active-transition', transitionId: 'transition-1' } }, 'Transition context').textContent).toContain('Transition context');
  });

  it('creates a structured label from keyboard fields and preserves raw text as textContent', () => {
    const store = createCommandStore(makeDocument());
    const root = renderAnnotationEditor({ store, onCommitted: () => undefined, setStatus: () => undefined });
    document.body.append(root);
    change(root.querySelector('#annotation-id')!, 'safe-label');
    change(root.querySelector('#annotation-tool')!, 'label');
    change(root.querySelector('#annotation-scope-kind')!, 'show');
    change(root.querySelector('#annotation-text')!, '<img src=x onerror=alert(1)>');
    change(root.querySelector('#annotation-x')!, '144000');
    change(root.querySelector('#annotation-y')!, '76800');
    root.querySelector<HTMLFormElement>('.annotation-editor form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const created = store.getState().document.annotations.find((entry) => entry.id === 'safe-label');
    expect(created).toMatchObject({ kind: 'label', text: '<img src=x onerror=alert(1)>', anchor: { x: 144000, y: 76800 } });
    expect(root.querySelectorAll('img')).toHaveLength(0);
    document.body.replaceChildren();
  });

  it('does not create a command when a freehand pointer sequence is cancelled, and keeps locked layer properties disabled until unlocking', () => {
    const store = createCommandStore(makeDocument());
    const statuses: string[] = [];
    const root = renderAnnotationEditor({ store, onCommitted: () => undefined, setStatus: (message) => statuses.push(message) });
    document.body.append(root);
    const canvas = root.querySelector<SVGSVGElement>('.annotation-preview__svg')!;
    canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 980, height: 560, right: 980, bottom: 560, toJSON() { return {}; } });
    change(root.querySelector('#annotation-tool')!, 'freehand');
    const initialCommands = store.getUndoCommands().length;
    canvas.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 40, clientY: 520 }));
    canvas.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 100, clientY: 450 }));
    canvas.dispatchEvent(new window.PointerEvent('pointercancel', { bubbles: true, pointerId: 1, clientX: 100, clientY: 450 }));
    expect(store.getUndoCommands()).toHaveLength(initialCommands);
    expect(statuses).toEqual([]);

    const lockedName = root.querySelector<HTMLInputElement>('#layer-name-top')!;
    const lockedVisible = root.querySelector<HTMLInputElement>('#layer-visible-top')!;
    const lockedToggle = root.querySelector<HTMLInputElement>('#layer-locked-top')!;
    expect(lockedName.disabled).toBe(true);
    expect(lockedVisible.disabled).toBe(true);
    change(lockedToggle, false);
    expect(store.getState().document.layers?.find((entry) => entry.id === 'top')?.locked).toBe(false);
    document.body.replaceChildren();
  });

  it('authors freehand, arrow, symbol, and performer-note variants through the real controls', () => {
    const store = createCommandStore(makeDocument());
    const root = renderAnnotationEditor({ store, onCommitted: () => undefined, setStatus: () => undefined });
    document.body.append(root);
    const canvas = root.querySelector<SVGSVGElement>('.annotation-preview__svg')!;
    canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 980, height: 560, right: 980, bottom: 560, toJSON() { return {}; } });
    const pointer = (type: string, pointerId: number, clientX: number, clientY: number) => canvas.dispatchEvent(new window.PointerEvent(type, { bubbles: true, pointerId, clientX, clientY }));
    const tool = root.querySelector<HTMLSelectElement>('#annotation-tool')!;
    const annotationId = root.querySelector<HTMLInputElement>('#annotation-id')!;

    change(tool, 'freehand'); change(annotationId, 'stroke');
    pointer('pointerdown', 1, 40, 520); pointer('pointermove', 1, 120, 440); pointer('pointerup', 1, 200, 360);
    const stroke = store.getState().document.annotations.find((entry) => entry.id === 'stroke');
    expect(stroke?.kind).toBe('freehand');
    if (stroke?.kind === 'freehand') expect(stroke.strokes[0]?.[0]).toEqual({ x: 0, y: 0 });

    change(tool, 'arrow'); change(annotationId, 'arrow');
    pointer('pointerdown', 2, 120, 440); pointer('pointerup', 2, 200, 360);
    expect(store.getState().document.annotations.find((entry) => entry.id === 'arrow')).toMatchObject({ kind: 'arrow', points: [{ x: 25600, y: 25600 }, { x: 51200, y: 51200 }] });

    const form = root.querySelector<HTMLFormElement>('.annotation-editor form')!;
    change(tool, 'symbol'); change(annotationId, 'symbol'); change(root.querySelector('#annotation-symbol')!, 'star'); change(root.querySelector('#annotation-x')!, '1000'); change(root.querySelector('#annotation-y')!, '2000');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    change(tool, 'performerNote'); change(annotationId, 'note'); change(root.querySelector('#annotation-performer')!, 'p1'); change(root.querySelector('#annotation-text')!, 'Watch interval'); change(root.querySelector('#annotation-x')!, '3000'); change(root.querySelector('#annotation-y')!, '4000');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(store.getState().document.annotations.find((entry) => entry.id === 'symbol')).toMatchObject({ kind: 'symbol', symbolId: 'star' });
    expect(store.getState().document.annotations.find((entry) => entry.id === 'note')).toMatchObject({ kind: 'performerNote', performerId: 'p1', text: 'Watch interval' });
    expect(store.getUndoCommands().slice(-4).map((entry) => entry.type)).toEqual(['annotation.create', 'annotation.create', 'annotation.create', 'annotation.create']);
    document.body.replaceChildren();
  });
});
