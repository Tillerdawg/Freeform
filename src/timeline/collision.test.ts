import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument, Transition } from '../document/types';
import {
  analyzeTransitionCollisions,
  collisionWarningSignature,
  CollisionAnalysisError,
} from './collision';

function floatDocument(overrides: Partial<FreeformDocument> = {}): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'collision-show', title: 'Collision test', totalCounts: 2 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [
      { id: 'a', rankCode: 'A', displayName: 'A' },
      { id: 'b', rankCode: 'B', displayName: 'B' },
    ],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 14400, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 2, positions: { a: { x: 14400, y: 0 }, b: { x: 0, y: 0 } } },
    ],
    transitions: [{ id: 'float-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 2, mode: 'float' }],
    annotations: [],
    ...overrides,
  };
}

function onlyTransition(document: FreeformDocument): Transition {
  return document.transitions[0]!;
}

describe('collision analyzer', () => {
  it('implements the exact independent counts=2 crossing vector and adaptive t=j/24 grid', () => {
    const document = floatDocument();
    const analysis = analyzeTransitionCollisions(document, onlyTransition(document));

    expect(analysis.sampleTimes).toHaveLength(25);
    analysis.sampleTimes.forEach((time, index) => expect(time).toBeCloseTo(index / 24, 14));
    expect(analysis.sampleTimes[12]).toBe(0.5);
    expect(14400 * (analysis.sampleTimes[1]! - analysis.sampleTimes[0]!)).toBe(600);
    expect(analysis.warnings).toHaveLength(1);
    expect(analysis.warnings[0]).toMatchObject({
      performerIds: ['a', 'b'], sampleCount: 1, t: 0.5, closestDistanceFU: 0, thresholdUnits: 2880, overridden: false,
    });
  });

  it('warns at threshold equality, at an endpoint, and does not warn on a safe pass', () => {
    const endpoint = floatDocument({
      sets: [
        { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } } },
        { id: 'set-2', name: 'Set 2', startCount: 2, positions: { a: { x: 14400, y: 0 }, b: { x: 2880, y: 0 } } },
      ],
    });
    expect(analyzeTransitionCollisions(endpoint, onlyTransition(endpoint)).warnings[0]).toMatchObject({ sampleCount: 0, closestDistanceFU: 0 });

    const equality = floatDocument({
      sets: [
        { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 2880, y: 0 } } },
        { id: 'set-2', name: 'Set 2', startCount: 2, positions: { a: { x: 0, y: 0 }, b: { x: 2880, y: 0 } } },
      ],
    });
    expect(analyzeTransitionCollisions(equality, onlyTransition(equality)).warnings[0]?.closestDistanceFU).toBe(2880);

    const safe = floatDocument({
      sets: [
        { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 2881, y: 0 } } },
        { id: 'set-2', name: 'Set 2', startCount: 2, positions: { a: { x: 0, y: 0 }, b: { x: 2881, y: 0 } } },
      ],
    });
    expect(analyzeTransitionCollisions(safe, onlyTransition(safe)).warnings).toEqual([]);
  });

  it('covers every unordered pair exactly once in canonical deterministic order', () => {
    const source = floatDocument();
    const document: FreeformDocument = {
      ...source,
      performers: [...source.performers, { id: 'c', rankCode: 'C', displayName: 'C' }],
      sets: source.sets.map((set) => ({ ...set, positions: { ...set.positions, c: { x: 0, y: 0 } } })),
    };
    expect(analyzeTransitionCollisions(document, onlyTransition(document)).warnings.map(({ performerIds }) => performerIds))
      .toEqual([['a', 'b'], ['a', 'c'], ['b', 'c']]);
  });

  it('samples FTL path corners that are not quarter-count samples and uses arc travel for adaptation', () => {
    const transition: Transition = {
      id: 'ftl-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 1, mode: 'ftl',
      ftl: {
        leaderId: 'a', followerIds: ['b'], offsetUnits: { a: 0, b: 300 }, distanceUnits: 3000,
        path: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 1800, y: 900 }, { x: 2700, y: 900 }, { x: 3600, y: 900 }],
        expectedEndPositions: { a: { x: 2100, y: 900 }, b: { x: 2400, y: 900 } },
      },
    };
    const document = floatDocument({
      show: { id: 'ftl-show', title: 'FTL collision test', totalCounts: 1 },
      sets: [
        { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } } },
        { id: 'set-2', name: 'Set 2', startCount: 1, positions: { a: { x: 2100, y: 900 }, b: { x: 2400, y: 900 } } },
      ],
      transitions: [transition],
    });
    const analysis = analyzeTransitionCollisions(document, transition);

    expect(analysis.sampleTimes).toContain(0.2);
    expect(analysis.sampleTimes).toContain(0.3);
    expect(analysis.warnings[0]?.performerIds).toEqual(['a', 'b']);
    expect(analysis.warnings[0]?.closestDistanceFU).toBeLessThanOrEqual(300);
  });

  it('fails visibly instead of returning a false-safe result for invalid FTL and excessive samples', () => {
    const invalid = floatDocument({ transitions: [{ id: 'bad-ftl', fromSetId: 'set-1', toSetId: 'set-2', counts: 2, mode: 'ftl' }] });
    expect(() => analyzeTransitionCollisions(invalid, onlyTransition(invalid))).toThrow(CollisionAnalysisError);
    expect(() => analyzeTransitionCollisions(invalid, onlyTransition(invalid))).toThrow('COLLISION_ANALYSIS_FTL_INVALID');

    const excessive = floatDocument({
      show: { id: 'large', title: 'Large', totalCounts: 25000 },
      sets: [
        { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 }, b: { x: 14400, y: 0 } } },
        { id: 'set-2', name: 'Set 2', startCount: 25000, positions: { a: { x: 14400, y: 0 }, b: { x: 0, y: 0 } } },
      ],
      transitions: [{ id: 'large-float', fromSetId: 'set-1', toSetId: 'set-2', counts: 25000, mode: 'float' }],
    });
    expect(() => analyzeTransitionCollisions(excessive, onlyTransition(excessive))).toThrow('COLLISION_ANALYSIS_SAMPLE_LIMIT');
  });

  it('uses stable pair signatures, records a persisted audit command, and never applies it after relevant inputs change', () => {
    const source = floatDocument();
    const signature = collisionWarningSignature(source, onlyTransition(source), ['a', 'b']);
    const expectedPayload = JSON.stringify({
      version: 'collision-warning-v1', transitionId: 'float-1', counts: 2, thresholdUnits: 2880,
      performerIds: ['a', 'b'],
      motion: { mode: 'float', starts: [[0, 0], [14400, 0]], ends: [[14400, 0], [0, 0]] },
    });
    expect(signature).toBe(`v1-sha256-${createHash('sha256').update(expectedPayload).digest('hex')}`);
    const reordered: FreeformDocument = { ...source, performers: [...source.performers].reverse() };
    expect(collisionWarningSignature(reordered, onlyTransition(reordered), ['b', 'a'])).toBe(signature);
    const reconstructedDots: FreeformDocument = {
      ...source,
      sets: source.sets.map((set) => ({
        ...set,
        positions: Object.fromEntries(Object.entries(set.positions).map(([id, dot]) => [id, { y: dot.y, x: dot.x }])),
      })),
    };
    expect(collisionWarningSignature(reconstructedDots, onlyTransition(reconstructedDots), ['a', 'b'])).toBe(signature);
    const changedMotion: FreeformDocument = {
      ...source,
      sets: source.sets.map((set) => set.id === 'set-2'
        ? { ...set, positions: { ...set.positions, a: { x: 12000, y: 0 } } }
        : set),
    };
    expect(collisionWarningSignature(changedMotion, onlyTransition(changedMotion), ['a', 'b'])).not.toBe(signature);
    const changedY: FreeformDocument = {
      ...source,
      sets: source.sets.map((set) => set.id === 'set-2'
        ? { ...set, positions: { ...set.positions, a: { x: 14400, y: 1 } } }
        : set),
    };
    expect(collisionWarningSignature(changedY, onlyTransition(changedY), ['a', 'b'])).not.toBe(signature);
    const changedThreshold: FreeformDocument = { ...source, settings: { collisionThresholdUnits: 2881 } };
    expect(collisionWarningSignature(changedThreshold, onlyTransition(changedThreshold), ['a', 'b'])).not.toBe(signature);
    expect(collisionWarningSignature(source, { ...onlyTransition(source), counts: 3 }, ['a', 'b'])).not.toBe(signature);

    const ftlDocument = floatDocument({
      transitions: [{
        ...onlyTransition(source), id: 'ftl-1', mode: 'ftl',
        ftl: {
          leaderId: 'a', followerIds: ['b'], offsetUnits: { a: 0, b: 14400 }, distanceUnits: 14400,
          path: [{ x: 0, y: 0 }, { x: 7200, y: 0 }, { x: 14400, y: 0 }],
        },
      }],
    });
    const ftlTransition = onlyTransition(ftlDocument);
    const ftlSignature = collisionWarningSignature(ftlDocument, ftlTransition, ['a', 'b']);
    const reorderedPath: FreeformDocument = {
      ...ftlDocument,
      transitions: [{ ...ftlTransition, ftl: { ...ftlTransition.ftl!, path: ftlTransition.ftl!.path.map(({ x, y }) => ({ y, x })) } }],
    };
    expect(collisionWarningSignature(reorderedPath, onlyTransition(reorderedPath), ['a', 'b'])).toBe(ftlSignature);
    const changedPath: FreeformDocument = {
      ...ftlDocument,
      transitions: [{ ...ftlTransition, ftl: { ...ftlTransition.ftl!, path: [{ x: 0, y: 0 }, { x: 7200, y: 1 }, { x: 14400, y: 0 }] } }],
    };
    expect(collisionWarningSignature(changedPath, onlyTransition(changedPath), ['a', 'b'])).not.toBe(ftlSignature);

    const store = createCommandStore(source);
    store.apply({ type: 'collision.override.record', transitionId: 'float-1', override: {
      performerIds: ['a', 'b'], warningSignature: signature, reason: 'Sightline is deliberately shared.',
      authorLabel: 'Local director', overriddenAt: '2026-10-01T00:00:00.000Z',
    } });
    expect(analyzeTransitionCollisions(store.getState().document, onlyTransition(store.getState().document)).warnings[0]?.overridden).toBe(true);
    expect(store.undo()?.document.transitions[0]?.collisionOverrides).toBeUndefined();
    expect(store.redo()?.document.transitions[0]?.collisionOverrides).toHaveLength(1);

    const changed = store.apply({ type: 'settings.collision-threshold.set', collisionThresholdUnits: 2000 });
    expect(analyzeTransitionCollisions(changed.document, onlyTransition(changed.document)).warnings[0]?.overridden).toBe(false);
    expect(store.undo()?.document.settings.collisionThresholdUnits).toBe(2880);
    expect(store.redo()?.document.settings.collisionThresholdUnits).toBe(2000);
  });

  it('atomically rejects malformed collision metadata without history or partial document changes', () => {
    const store = createCommandStore(floatDocument());
    const before = store.getState();
    expect(() => store.apply({ type: 'collision.override.record', transitionId: 'float-1', override: {
      performerIds: ['b', 'a'], warningSignature: 'not-a-signature', reason: ' ', authorLabel: ' ', overriddenAt: 'bad',
    } })).toThrow('canonical lexical order');
    expect(store.getState()).toBe(before);
    expect(store.canUndo()).toBe(false);
    expect(() => store.apply({ type: 'settings.collision-threshold.set', collisionThresholdUnits: 0 })).toThrow('1 through 28800');
    expect(store.getState()).toBe(before);
  });

  it('rejects impossible override calendar timestamps on initialization, commands, and replacement', () => {
    const source = floatDocument();
    const invalidOverride = {
      performerIds: ['a', 'b'] as const,
      warningSignature: `v1-sha256-${'a'.repeat(64)}`,
      reason: 'The local director accepts this advisory warning.',
      authorLabel: 'Local director',
      overriddenAt: '2026-02-31T00:00:00.000Z',
    };
    const invalidDocument: FreeformDocument = {
      ...source,
      transitions: [{ ...onlyTransition(source), collisionOverrides: [invalidOverride] }],
    };

    const validDocument: FreeformDocument = {
      ...source,
      transitions: [{
        ...onlyTransition(source),
        collisionOverrides: [{ ...invalidOverride, overriddenAt: '2024-02-29T23:59:59.1Z' }],
      }],
    };
    expect(() => createCommandStore(validDocument)).not.toThrow();
    expect(() => createCommandStore(invalidDocument)).toThrow('valid ISO 8601 date-time');

    const store = createCommandStore(source);
    const before = store.getState();
    expect(() => store.apply({ type: 'collision.override.record', transitionId: 'float-1', override: invalidOverride }))
      .toThrow('valid ISO 8601 date-time');
    expect(store.getState()).toBe(before);
    expect(store.getUndoCommands()).toEqual([]);

    expect(() => store.apply({ type: 'document.replace', document: invalidDocument }))
      .toThrow('valid ISO 8601 date-time');
    expect(store.getState()).toBe(before);
    expect(store.getUndoCommands()).toEqual([]);
  });
});
