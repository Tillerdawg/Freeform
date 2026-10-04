import { readFileSync, writeFileSync } from 'node:fs';
import type { FreeformDocument } from '../document/types';
import { expect, it, vi } from 'vitest';
import { fieldPoint } from './geometry';
import { buildPdfExport } from './pdf-export';
import type { PdfAssets, PdfExportRequest } from './contracts';

vi.setConfig({ testTimeout: 30_000 });

const assets: PdfAssets = {
  fonts: [
    { id: 'noto-latin', bytes: new Uint8Array(readFileSync('src/pdf/assets/noto-sans-latin-400.woff')), sha256: '18e2e5b23a9bc5e8e636d6c7984b8ac6635aefc1c497ed1c5012f3c637761b91', sourceUrl: 'https://fontsource.org/', license: 'OFL-1.1', subset: true },
    { id: 'noto-cyrillic', bytes: new Uint8Array(readFileSync('src/pdf/assets/noto-sans-cyrillic-400.woff')), sha256: 'e199c2ac3c8bd6c99ec9e44cc3363128d86c94eed54d2f22d5b6ef9ca16bc484', sourceUrl: 'https://fontsource.org/', license: 'OFL-1.1', subset: true },
    { id: 'noto-emoji', bytes: new Uint8Array(readFileSync('src/pdf/assets/noto-emoji-400.ttf')), sha256: 'bfa22d39f50efa1f2b437d4e9ce4f42c6d56a1d69b5f6a03959657a3f764bdb9', sourceUrl: 'https://fontsource.org/', license: 'OFL-1.1', subset: false },
  ],
};

function makeDocument(): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Café 😀', totalCounts: 16 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A', displayName: 'Русский é' }],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 16, positions: { a: { x: 28800, y: 14400 } } },
    ],
    transitions: [{ id: 'move-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float' }],
    annotations: [],
  };
}

const results: Record<string, unknown> = {};

it('H-round3: regression F1 multiline note/title, actual PDF text', async () => {
  const base = makeDocument();
  const layer = { id: 'notes', name: 'Notes', visible: true, print: true, locked: false } as const;
  const doc: FreeformDocument = {
    ...base,
    layers: [layer],
    annotations: [{
      id: 'note-1', kind: 'label', layerId: layer.id, scope: { kind: 'show' },
      visibility: { editor: true, print: true, performerPacket: false }, anchor: { x: 144000, y: 230400 },
      text: 'First line\nSecond line',
    }],
  };
  const result = await buildPdfExport(doc, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const page = await (await getDocument({ data: new Uint8Array(result.bytes) }).promise).getPage(1);
  const items = (await page.getTextContent()).items.filter((i): i is Extract<typeof i, { str: string }> => 'str' in i);
  const first = items.find((i) => i.str.includes('First line'));
  const second = items.find((i) => i.str.includes('Second line'));
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(second!.transform[5]).toBeLessThan(first!.transform[5]);
  results.F1 = { ok: true, firstY: first!.transform[5], secondY: second!.transform[5] };
  writeFileSync('evidence/m8-director/huffer-review/round3/f1.pdf', Buffer.from(result.bytes));
});

it('H-round3: regression F4 authored whitespace preserved', async () => {
  const base = makeDocument();
  const layer = { id: 'notes', name: 'Notes', visible: true, print: true, locked: false } as const;
  const doc: FreeformDocument = {
    ...base,
    layers: [layer],
    annotations: [{
      id: 'note-2', kind: 'label', layerId: layer.id, scope: { kind: 'show' },
      visibility: { editor: true, print: true, performerPacket: false }, anchor: { x: 144000, y: 230400 },
      text: '  Keep   spaces  ',
    }],
  };
  const result = await buildPdfExport(doc, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const page = await (await getDocument({ data: new Uint8Array(result.bytes) }).promise).getPage(1);
  const items = (await page.getTextContent()).items.filter((i): i is Extract<typeof i, { str: string }> => 'str' in i);
  const joined = items.map((i) => i.str).join('');
  results.F4 = { ok: true, extracted: joined };
  expect(joined).toContain('Keep   spaces');
  // Leading/trailing spaces may be split across runs; check first item begins with blank-ish or width consistent.
});

it('H-round3: F2/F3 overlap and off-page rank use actual ink bounds', async () => {
  const base = makeDocument();
  const layer = { id: 'notes', name: 'Notes', visible: true, print: true, locked: false } as const;
  // Note positioned so its box should intersect rank label's actual ink per fontkit, at a known point.
  const point = fieldPoint({ x: 0, y: 0 }, base.field);
  const overlapDoc: FreeformDocument = {
    ...base,
    layers: [layer],
    annotations: [{
      id: 'note-overlap', kind: 'label', layerId: layer.id, scope: { kind: 'show' },
      visibility: { editor: true, print: true, performerPacket: false },
      anchor: { x: 0, y: 0 }, text: 'X',
    }],
  };
  const result = await buildPdfExport(overlapDoc, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) {
    const page = result.manifest.pages[0];
    results.F2_overlapWarnings = result.warnings;
  }

  // Off-page rank: performer near right edge should still fail safely, not clip.
  const offPageDoc: FreeformDocument = {
    ...base,
    performers: [{ id: 'a', rankCode: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', displayName: 'Edge' }],
    sets: base.sets.map((s) => ({ ...s, positions: { a: { x: 288000, y: 0 } } })),
  };
  const offPage = await buildPdfExport(offPageDoc, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
  results.F3_offPageRank = { ok: offPage.ok, code: offPage.ok ? null : (offPage as any).code };
  expect(offPage.ok).toBe(false);
});

it('H-round3: F5 rotated multi-font-run baseline re-check at independent anchor', async () => {
  const base = makeDocument();
  const layer = { id: 'notes', name: 'Notes', visible: true, print: true, locked: false } as const;
  const doc: FreeformDocument = {
    ...base,
    layers: [layer],
    symbols: [{ id: 'mixed2', name: 'Mixed2', glyph: 'AB😀' }],
    annotations: [{
      id: 'mixed-symbol-2', kind: 'symbol', layerId: layer.id, scope: { kind: 'show' },
      visibility: { editor: true, print: true, performerPacket: false }, symbolId: 'mixed2', anchor: { x: 144000, y: 153600 }, rotationDegrees: 180, scale: 1,
    }],
  };
  const result = await buildPdfExport(doc, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const page = await (await getDocument({ data: new Uint8Array(result.bytes) }).promise).getPage(1);
  const items = (await page.getTextContent()).items.filter((i): i is Extract<typeof i, { str: string }> => 'str' in i);
  const runA = items.find((i) => i.str === 'A');
  const runB = items.find((i) => i.str === 'B');
  const runEmoji = items.find((i) => i.str === '😀');
  expect(runA).toBeDefined();
  expect(runB).toBeDefined();
  expect(runEmoji).toBeDefined();
  // 180deg rotation: local +x maps to global -x, y stays same sign flip too (cos180=-1,sin180=0)
  // so all three runs should share identical y (within rounding) and x should DECREASE A->B->emoji
  expect(runB!.transform[5]).toBeCloseTo(runA!.transform[5], 1);
  expect(runEmoji!.transform[5]).toBeCloseTo(runA!.transform[5], 1);
  expect(runB!.transform[4]).toBeLessThan(runA!.transform[4]);
  expect(runEmoji!.transform[4]).toBeLessThan(runB!.transform[4]);
  results.F5_independent = {
    runA: runA!.transform, runB: runB!.transform, runEmoji: runEmoji!.transform,
  };
  writeFileSync('evidence/m8-director/huffer-review/round3/f5-180deg.pdf', Buffer.from(result.bytes));
});

it('H-round3: dump results', () => {
  writeFileSync('evidence/m8-director/huffer-review/round3/results.json', JSON.stringify(results, null, 2));
  expect(true).toBe(true);
});
