import { describe, expect, it } from 'vitest';
import { selectAnnotations, validateDocumentAnnotations } from './annotations';
import { createCommandStore } from './command-store';
import type { Annotation, FreeformDocument } from './types';

const visibility = { editor: true, print: true, performerPacket: false } as const;

function makeDocument(overrides: Partial<FreeformDocument> = {}): FreeformDocument {
  return {
    format: 'freeform',
    formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Annotation matrix', totalCounts: 32 },
    field: {
      preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600,
      frontHashY: 51200, backHashY: 102400,
    },
    settings: { collisionThresholdUnits: 2880 },
    performers: [
      { id: 'p1', rankCode: 'P1', displayName: 'Performer One' },
      { id: 'p2', rankCode: 'P2', displayName: 'Performer Two' },
    ],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { p1: { x: 100000, y: 50000 }, p2: { x: 110000, y: 50000 } } },
      { id: 'set-2', name: 'Set 2', startCount: 16, positions: { p1: { x: 120000, y: 50000 }, p2: { x: 130000, y: 50000 } } },
      { id: 'set-3', name: 'Set 3', startCount: 32, positions: { p1: { x: 140000, y: 50000 }, p2: { x: 150000, y: 50000 } } },
    ],
    transitions: [
      { id: 'transition-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float' },
      { id: 'transition-2', fromSetId: 'set-2', toSetId: 'set-3', counts: 16, mode: 'float' },
    ],
    layers: [
      { id: 'visible', name: 'Visible', visible: true, print: true, locked: false },
      { id: 'hidden', name: 'Hidden', visible: false, print: true, locked: false },
      { id: 'no-print', name: 'No Print', visible: true, print: false, locked: false },
      { id: 'locked', name: 'Locked', visible: true, print: true, locked: true },
    ],
    symbols: [{ id: 'star', name: 'Star', glyph: 'M0 0' }],
    annotations: [
      { id: 'show-label', kind: 'label', layerId: 'visible', scope: { kind: 'show' }, visibility, text: 'All show', anchor: { x: 100000, y: 50000 } },
      { id: 'set-1-label', kind: 'label', layerId: 'visible', scope: { kind: 'set', setId: 'set-1' }, visibility, text: 'Set one', anchor: { x: 100000, y: 50000 } },
      { id: 'set-2-print-only', kind: 'label', layerId: 'visible', scope: { kind: 'set', setId: 'set-2' }, visibility: { editor: false, print: true, performerPacket: false }, text: 'Print only', anchor: { x: 120000, y: 50000 } },
      { id: 'set-3-hidden', kind: 'label', layerId: 'hidden', scope: { kind: 'set', setId: 'set-3' }, visibility, text: 'Hidden editor', anchor: { x: 140000, y: 50000 } },
      { id: 'transition-1-arrow', kind: 'arrow', layerId: 'visible', scope: { kind: 'transition', transitionId: 'transition-1' }, visibility, points: [{ x: 100000, y: 50000 }, { x: 120000, y: 50000 }] },
      { id: 'transition-2-freehand', kind: 'freehand', layerId: 'no-print', scope: { kind: 'transition', transitionId: 'transition-2' }, visibility, strokes: [[{ x: 120000, y: 50000 }, { x: 140000, y: 50000 }]] },
      { id: 'show-symbol', kind: 'symbol', layerId: 'visible', scope: { kind: 'show' }, visibility, symbolId: 'star', anchor: { x: 100000, y: 60000 }, rotationDegrees: 45, scale: 1.5 },
      { id: 'p1-note', kind: 'performerNote', layerId: 'visible', scope: { kind: 'set', setId: 'set-2' }, visibility: { editor: true, print: false, performerPacket: true }, performerId: 'p1', text: 'P1 only', anchor: { x: 120000, y: 50000 } },
      { id: 'p2-note', kind: 'performerNote', layerId: 'visible', scope: { kind: 'transition', transitionId: 'transition-1' }, visibility: { editor: true, print: false, performerPacket: true }, performerId: 'p2', text: 'P2 only', anchor: { x: 130000, y: 50000 } },
      { id: 'locked-label', kind: 'label', layerId: 'locked', scope: { kind: 'show' }, visibility, text: 'Locked', anchor: { x: 100000, y: 70000 } },
    ],
    ...overrides,
  };
}

function ids(annotations: readonly Annotation[]): readonly string[] {
  return annotations.map(({ id }) => id);
}

describe('annotations, layers, and symbols', () => {
  it('accepts every normative annotation variant and rejects malformed or unknown references atomically', () => {
    const document = makeDocument();
    expect(() => validateDocumentAnnotations(document)).not.toThrow();
    expect(() => createCommandStore(document)).not.toThrow();

    const malformed = {
      ...document,
      annotations: [{
        id: 'bad', kind: 'label', layerId: 'visible', scope: { kind: 'set', setId: 'missing' },
        visibility, text: 'Bad', anchor: { x: 0.5, y: 1 }, extra: true,
      }],
    } as unknown as FreeformDocument;
    const store = createCommandStore(document);
    const initial = store.getState();
    expect(() => store.apply({ type: 'document.replace', document: malformed })).toThrow('unsupported property: extra');
    expect(store.getState()).toBe(initial);

    const packetWithoutPerformer = {
      ...document.annotations[0]!, id: 'packet-without-performer', visibility: { editor: true, print: false, performerPacket: true },
    } as unknown as Annotation;
    expect(() => store.apply({ type: 'annotation.create', annotation: packetWithoutPerformer }))
      .toThrow('Performer packet visibility requires a performer ID.');
    expect(store.getState()).toBe(initial);

    const unknownScope = {
      ...document.annotations[0]!, id: 'unknown-scope', scope: { kind: 'transition', transitionId: 'missing' },
    } as Annotation;
    expect(() => store.apply({ type: 'annotation.create', annotation: unknownScope }))
      .toThrow('unknown transition scope: missing');
    expect(store.getState()).toBe(initial);
  });

  it('applies every annotation, layer, and symbol command immutably with complete undo/redo snapshots', () => {
    const document = makeDocument({ annotations: [], layers: [{ id: 'visible', name: 'Visible', visible: true, print: true, locked: false }], symbols: [] });
    const store = createCommandStore(document);
    const expected = [store.getState().document];
    const apply = (command: Parameters<typeof store.apply>[0]) => {
      expected.push(store.apply(command).document);
    };
    const symbol = { id: 'dot', name: 'Dot', glyph: 'circle' } as const;
    const updatedSymbol = { id: 'dot', name: 'Filled Dot', glyph: 'circle-filled' } as const;
    const label = {
      id: 'new-note', kind: 'label', layerId: 'visible', scope: { kind: 'set', setId: 'set-1' }, visibility,
      text: 'Original', anchor: { x: 100000, y: 50000 },
    } as const;
    const updatedAnnotation = {
      id: 'new-note', kind: 'symbol', layerId: 'visible', scope: { kind: 'transition', transitionId: 'transition-1' }, visibility,
      symbolId: 'dot', anchor: { x: 110000, y: 50000 }, rotationDegrees: 90, scale: 2,
    } as const;
    const secondary = { id: 'secondary', name: 'Secondary', visible: false, print: false, locked: false } as const;
    const updatedSecondary = { id: 'secondary', name: 'Published secondary', visible: true, print: true, locked: false } as const;

    apply({ type: 'symbol.create', symbol });
    apply({ type: 'symbol.update', symbol: updatedSymbol });
    apply({ type: 'annotation.create', annotation: label });
    apply({ type: 'annotation.update', annotation: updatedAnnotation });
    apply({ type: 'annotation.remove', annotationId: 'new-note' });
    apply({ type: 'layer.create', layer: secondary });
    apply({ type: 'layer.update', layer: updatedSecondary });
    apply({ type: 'layer.reorder', layerId: 'secondary', index: 0 });
    apply({ type: 'layer.remove', layerId: 'visible' });
    apply({ type: 'layer.remove', layerId: 'secondary' });
    apply({ type: 'symbol.remove', symbolId: 'dot' });

    expect(store.getState().document).toEqual(expected.at(-1));
    expect(Object.isFrozen(store.getState().document.annotations)).toBe(true);
    for (let index = expected.length - 2; index >= 0; index -= 1) {
      expect(store.undo()?.document).toEqual(expected[index]);
    }
    for (let index = 1; index < expected.length; index += 1) {
      expect(store.redo()?.document).toEqual(expected[index]);
    }
  });

  it('rejects null optional arrays and preserves state, history, revision, and redo on rejected replacement', () => {
    const document = makeDocument({ annotations: [] });
    expect(() => createCommandStore({ ...document, layers: null } as unknown as FreeformDocument)).toThrow('Layers must be an array.');
    expect(() => createCommandStore({ ...document, symbols: null } as unknown as FreeformDocument)).toThrow('Symbols must be an array.');

    for (const malformed of [
      { ...document, layers: null },
      { ...document, symbols: null },
    ] as const) {
      const store = createCommandStore(document);
      store.apply({ type: 'show.title.set', title: 'changed' });
      store.undo();
      const before = store.getState();
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(true);
      expect(() => store.apply({ type: 'document.replace', document: malformed as unknown as FreeformDocument })).toThrow('must be an array');
      expect(store.getState()).toBe(before);
      expect(store.getState().revision).toBe(0);
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(true);
      expect(store.redo()?.document.show.title).toBe('changed');
    }
  });

  it('uses JSON Schema Unicode code-point limits for M6 layer, label, and symbol strings', () => {
    const emoji = '😀';
    expect(() => validateDocumentAnnotations(makeDocument({
      layers: [{ id: 'visible', name: emoji.repeat(120), visible: true, print: true, locked: false }],
      symbols: [{ id: 'star', name: emoji.repeat(120), glyph: emoji.repeat(8000) }],
      annotations: [{
        id: 'label', kind: 'label', layerId: 'visible', scope: { kind: 'show' }, visibility,
        text: emoji.repeat(10000), anchor: { x: 100000, y: 50000 },
      }],
    }))).not.toThrow();
    expect(() => validateDocumentAnnotations(makeDocument({
      symbols: [{ id: 'star', name: 'Star', glyph: emoji.repeat(8001) }],
    }))).toThrow('Symbol glyph must contain 1 through 8000 characters.');
  });

  it('rejects each new command type atomically without consuming redo history', () => {
    const document = makeDocument({ annotations: [], layers: [{ id: 'visible', name: 'Visible', visible: true, print: true, locked: false }], symbols: [] });
    const store = createCommandStore(document);
    store.apply({ type: 'show.title.set', title: 'changed' });
    store.undo();
    const rejectedCommands = [
      { type: 'annotation.create', annotation: { id: 'bad-annotation', kind: 'label', layerId: 'missing', scope: { kind: 'show' }, visibility, text: 'Bad', anchor: { x: 1, y: 1 } } },
      { type: 'annotation.update', annotation: { id: 'missing', kind: 'label', layerId: 'visible', scope: { kind: 'show' }, visibility, text: 'Bad', anchor: { x: 1, y: 1 } } },
      { type: 'annotation.remove', annotationId: 'missing' },
      { type: 'layer.create', layer: { id: 'visible', name: 'Duplicate', visible: true, print: true, locked: false } },
      { type: 'layer.update', layer: { id: 'missing', name: 'Missing', visible: true, print: true, locked: false } },
      { type: 'layer.reorder', layerId: 'visible', index: 1 },
      { type: 'layer.remove', layerId: 'missing' },
      { type: 'symbol.create', symbol: { id: 'bad', name: 'Bad', glyph: '' } },
      { type: 'symbol.update', symbol: { id: 'missing', name: 'Missing', glyph: 'x' } },
      { type: 'symbol.remove', symbolId: 'missing' },
    ] as const;

    for (const command of rejectedCommands) {
      const before = store.getState();
      expect(() => store.apply(command)).toThrow();
      expect(store.getState()).toBe(before);
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(true);
    }
  });

  it('preserves existing shaped dots, transition motion, notes, and M5 audits through successful M6 commands', () => {
    const document = makeDocument({
      annotations: [],
      transitions: [
        {
          id: 'transition-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float', notes: 'Keep transition note',
          collisionOverrides: [{ performerIds: ['p1', 'p2'], warningSignature: `v1-sha256-${'0'.repeat(64)}`, reason: 'Approved spacing', overriddenAt: '2026-10-01T00:00:00Z', authorLabel: 'Writer' }],
        },
        { id: 'transition-2', fromSetId: 'set-2', toSetId: 'set-3', counts: 16, mode: 'float' },
      ],
    });
    const preserved = structuredClone({ sets: document.sets, transitions: document.transitions });
    const store = createCommandStore(document);
    store.apply({ type: 'symbol.create', symbol: { id: 'dot', name: 'Dot', glyph: 'circle' } });
    store.apply({ type: 'layer.create', layer: { id: 'secondary', name: 'Secondary', visible: true, print: true, locked: false } });
    store.apply({
      type: 'annotation.create',
      annotation: { id: 'new-label', kind: 'label', layerId: 'secondary', scope: { kind: 'transition', transitionId: 'transition-1' }, visibility, text: 'M6 only', anchor: { x: 100000, y: 50000 } },
    });
    expect({ sets: store.getState().document.sets, transitions: store.getState().document.transitions }).toEqual(preserved);
  });

  it('enforces locks and rejects linked deletion without mutating unrelated state', () => {
    const store = createCommandStore(makeDocument());
    const initial = store.getState();

    expect(() => store.apply({ type: 'annotation.remove', annotationId: 'locked-label' })).toThrow('Layer locked is locked.');
    expect(() => store.apply({ type: 'layer.reorder', layerId: 'locked', index: 0 })).toThrow('Layer locked is locked.');
    expect(() => store.apply({ type: 'layer.remove', layerId: 'locked' })).toThrow('Layer locked is locked.');
    expect(() => store.apply({ type: 'layer.remove', layerId: 'visible' })).toThrow('Remove annotations from layer visible');
    expect(() => store.apply({ type: 'symbol.remove', symbolId: 'star' })).toThrow('Remove symbol annotations using star');
    expect(() => store.apply({ type: 'performer.remove', performerId: 'p1' })).toThrow('Remove annotations associated with performer p1');
    expect(() => store.apply({ type: 'transition.remove', transitionId: 'transition-1' })).toThrow('Remove annotations scoped to transition transition-1');
    expect(() => store.apply({ type: 'set.remove', setId: 'set-3' })).toThrow('Remove transitions connected to set set-3');
    expect(store.getState()).toBe(initial);
    expect(store.canUndo()).toBe(false);

    store.apply({ type: 'layer.update', layer: { id: 'locked', name: 'Locked', visible: true, print: true, locked: false } });
    store.apply({ type: 'annotation.remove', annotationId: 'locked-label' });
    expect(store.getState().document.annotations.some(({ id }) => id === 'locked-label')).toBe(false);
    expect(store.undo()?.document.annotations.some(({ id }) => id === 'locked-label')).toBe(true);
    expect(store.redo()?.document.layers?.find(({ id }) => id === 'locked')?.locked).toBe(false);
  });

  it('keeps transition notes and M5 collision audits from disappearing through transition deletion', () => {
    const document = makeDocument({
      annotations: [],
      transitions: [{
        id: 'transition-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float', notes: 'Do not lose this',
        collisionOverrides: [{ performerIds: ['p1', 'p2'], warningSignature: `v1-sha256-${'0'.repeat(64)}`, reason: 'Allowed', overriddenAt: '2026-10-01T00:00:00Z', authorLabel: 'Writer' }],
      }, { id: 'transition-2', fromSetId: 'set-2', toSetId: 'set-3', counts: 16, mode: 'float' }],
    });
    const store = createCommandStore(document);
    const initial = store.getState();
    expect(() => store.apply({ type: 'transition.remove', transitionId: 'transition-1' })).toThrow('has notes');
    expect(store.getState()).toBe(initial);

    const auditOnly = {
      ...document,
      transitions: document.transitions.map((transition) => transition.id === 'transition-1'
        ? { ...transition, notes: undefined }
        : transition),
    };
    const auditStore = createCommandStore(auditOnly);
    expect(() => auditStore.apply({ type: 'transition.remove', transitionId: 'transition-1' })).toThrow('collision overrides');
  });

  it('rejects a set deletion that would orphan a scoped annotation', () => {
    const document = makeDocument({
      transitions: [],
      annotations: [{
        id: 'set-2-label', kind: 'label', layerId: 'visible', scope: { kind: 'set', setId: 'set-2' }, visibility,
        text: 'Keep me', anchor: { x: 120000, y: 50000 },
      }],
    });
    const store = createCommandStore(document);
    const initial = store.getState();
    expect(() => store.apply({ type: 'set.remove', setId: 'set-2' })).toThrow('Remove annotations scoped to set set-2');
    expect(store.getState()).toBe(initial);
  });

  it('selects explicit static, transition, show, range, print, and performer contexts without endpoint leakage', () => {
    const document = makeDocument();
    expect(ids(selectAnnotations(document, { audience: 'editor', context: { kind: 'static-set', setId: 'set-1' } })))
      .toEqual(['show-label', 'set-1-label', 'show-symbol', 'locked-label']);
    expect(ids(selectAnnotations(document, { audience: 'editor', context: { kind: 'static-set', setId: 'set-2' } })))
      .toEqual(['show-label', 'show-symbol', 'p1-note', 'locked-label']);
    expect(ids(selectAnnotations(document, { audience: 'editor', context: { kind: 'static-set', setId: 'set-3' } })))
      .toEqual(['show-label', 'show-symbol', 'locked-label']);
    expect(ids(selectAnnotations(document, { audience: 'editor', context: { kind: 'active-transition', transitionId: 'transition-1' } })))
      .toEqual(['show-label', 'transition-1-arrow', 'show-symbol', 'p2-note', 'locked-label']);
    expect(ids(selectAnnotations(document, { audience: 'editor', context: { kind: 'active-transition', transitionId: 'transition-2' } })))
      .toEqual(['show-label', 'transition-2-freehand', 'show-symbol', 'locked-label']);
    expect(ids(selectAnnotations(document, { audience: 'editor', context: { kind: 'show' } })))
      .toEqual(['show-label', 'show-symbol', 'locked-label']);
    expect(ids(selectAnnotations(document, { audience: 'editor', context: { kind: 'set-range', firstSetId: 'set-1', lastSetId: 'set-2' } })))
      .toEqual(['show-label', 'set-1-label', 'transition-1-arrow', 'show-symbol', 'p1-note', 'p2-note', 'locked-label']);
    expect(ids(selectAnnotations(document, { audience: 'director-print', context: { kind: 'static-set', setId: 'set-2' } })))
      .toEqual(['show-label', 'set-2-print-only', 'show-symbol', 'locked-label']);
    expect(ids(selectAnnotations(document, { audience: 'director-print', context: { kind: 'active-transition', transitionId: 'transition-2' } })))
      .toEqual(['show-label', 'show-symbol', 'locked-label']);
    expect(ids(selectAnnotations(document, { audience: 'performer-packet', performerId: 'p1', context: { kind: 'static-set', setId: 'set-2' } })))
      .toEqual(['p1-note']);
    expect(ids(selectAnnotations(document, { audience: 'performer-packet', performerId: 'p1', context: { kind: 'active-transition', transitionId: 'transition-1' } })))
      .toEqual([]);
    expect(() => selectAnnotations(document, { audience: 'performer-packet', context: { kind: 'show' } }))
      .toThrow('requires a performer ID');
    expect(() => selectAnnotations(document, { audience: 'editor', context: { kind: 'set-range', firstSetId: 'set-2', lastSetId: 'set-1' } }))
      .toThrow('follow document order');
  });
});
