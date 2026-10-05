import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createCommandStore } from '../document/command-store';
import { validateCurrentDocument } from '../persistence/freeform-file';
import { observeCommandStore } from '../persistence/command-store-bridge';
import type { FreeformDocument } from '../document/types';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { downloadPdf } from './download';
import { fieldPoint } from './geometry';
import { buildPdfExport, sha256 } from './pdf-export';
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
    performers: [{ id: 'a', rankCode: 'A', displayName: 'Русский é' }],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 } } },
      { id: 'set-2', name: 'Set 2', startCount: 16, positions: { a: { x: 28800, y: 14400 } } },
    ],
    transitions: [{ id: 'move-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float' }],
    annotations: [],
  };
}

function fixtureDocument(path: string): FreeformDocument {
  return JSON.parse(readFileSync(`docs/fixtures/${path}.freeform`, 'utf8')) as FreeformDocument;
}

const directorRequest: PdfExportRequest = {
  kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [{ transitionId: 'move-1', counts: [16, 0, 8] }],
};

async function successfulExport(): Promise<Extract<Awaited<ReturnType<typeof buildPdfExport>>, { ok: true }>> {
  const result = await buildPdfExport(makeDocument(), directorRequest, assets);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.messageKey);
  return result;
}

describe('M8.1 pure PDF foundation', () => {
  it('plans all static sets plus explicit sorted transition frames and emits exact Letter pages', async () => {
    const result = await successfulExport();
    expect(result.manifest.pages.map((page) => page.context)).toEqual([
      { kind: 'static-set', setId: 'set-1' }, { kind: 'static-set', setId: 'set-2' },
      { kind: 'active-transition', transitionId: 'move-1', count: 0 },
      { kind: 'active-transition', transitionId: 'move-1', count: 8 },
      { kind: 'active-transition', transitionId: 'move-1', count: 16 },
    ]);
    const parsed = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(parsed.getPages().map((page) => page.getSize())).toEqual(Array.from({ length: 5 }, () => ({ width: 792, height: 612 })));
    expect(parsed.getTitle()).toBe('Café 😀');
    expect(new TextDecoder().decode(result.bytes)).toContain('/Lang (en-US)');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const extracted = await (await getDocument({ data: result.bytes }).promise).getPage(1).then(async (page) => (await page.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(''));
    expect(extracted).toContain('Café');
    expect(extracted).toContain('Set 1');
    expect(extracted).toContain('Static set');
    expect(extracted).toContain('Page 1 of 5');
  });

  it('has byte-identical repeated output and a stable SHA-256', async () => {
    const first = await successfulExport();
    const second = await successfulExport();
    expect(await sha256(first.bytes)).toBe(await sha256(second.bytes));
    expect(first.bytes).toEqual(second.bytes);
  });

  it('renders selector-scoped vector annotations and reports measured note overlaps without a foundation warning', async () => {
    const base = makeDocument();
    const document: FreeformDocument = {
      ...base,
      performers: [...base.performers, { id: 'b', rankCode: 'B', displayName: 'Second' }],
      sets: base.sets.map((set) => ({ ...set, positions: { ...set.positions, b: { x: 144000, y: 76800 } } })),
      layers: [{ id: 'print-layer', name: 'Printable', visible: false, print: true, locked: false }, { id: 'hidden-print-layer', name: 'Hidden', visible: true, print: false, locked: false }],
      symbols: [{ id: 'emoji', name: 'Emoji', glyph: '😀' }],
      annotations: [
        { id: 'show-note', kind: 'label', layerId: 'print-layer', scope: { kind: 'show' }, visibility: { editor: false, print: true, performerPacket: false }, text: 'Overlap note', anchor: { x: 0, y: 0 } },
        { id: 'set-line', kind: 'freehand', layerId: 'print-layer', scope: { kind: 'set', setId: 'set-1' }, visibility: { editor: true, print: true, performerPacket: false }, strokes: [[{ x: 1000, y: 1000 }, { x: 8000, y: 8000 }]] },
        { id: 'set-arrow', kind: 'arrow', layerId: 'print-layer', scope: { kind: 'set', setId: 'set-1' }, visibility: { editor: true, print: true, performerPacket: false }, points: [{ x: 10000, y: 10000 }, { x: 16000, y: 16000 }] },
        { id: 'move-symbol', kind: 'symbol', layerId: 'print-layer', scope: { kind: 'transition', transitionId: 'move-1' }, visibility: { editor: true, print: true, performerPacket: false }, symbolId: 'emoji', anchor: { x: 144000, y: 76800 }, rotationDegrees: 45, scale: 1.5 },
        { id: 'excluded-note', kind: 'label', layerId: 'hidden-print-layer', scope: { kind: 'show' }, visibility: { editor: true, print: true, performerPacket: false }, text: 'Excluded text', anchor: { x: 20000, y: 20000 } },
      ],
    };
    const result = await buildPdfExport(document, directorRequest, assets);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.schemaVersion).toBe('m8.2');
    expect(result.manifest.pages[0]?.annotationIds).toEqual(['show-note', 'set-line', 'set-arrow']);
    expect(result.manifest.pages[2]?.annotationIds).toEqual(['show-note', 'move-symbol']);
    expect(result.warnings).not.toContainEqual(expect.objectContaining({ code: 'foundation-layout-not-rendered' }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'note-overlap', pageIndex: 0, annotationId: 'show-note', performerId: 'a', obstacleKind: 'dot' }));
    if (process.env.M8_WRITE_DIRECTOR_EVIDENCE === '1') {
      const directory = process.env.M8_DIRECTOR_EVIDENCE_DIR ?? 'evidence/m8-director';
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/overlap-before.pdf`, result.bytes);
      writeFileSync(`${directory}/overlap-before.manifest.json`, `${JSON.stringify({ manifest: result.manifest, warnings: result.warnings, sha256: await sha256(result.bytes) }, null, 2)}\n`);
      const moved: FreeformDocument = { ...document, annotations: document.annotations.map((annotation) => annotation.id === 'show-note' && annotation.kind === 'label' ? { ...annotation, anchor: { x: 200000, y: 120000 } } : annotation) };
      const after = await buildPdfExport(moved, directorRequest, assets);
      expect(after.ok, JSON.stringify(after)).toBe(true);
      if (after.ok) {
        expect(after.warnings.filter((warning) => warning.code === 'note-overlap' && warning.annotationId === 'show-note')).toEqual([]);
        const originalNote = document.annotations.find((annotation): annotation is Extract<typeof annotation, { kind: 'label' }> => annotation.id === 'show-note' && annotation.kind === 'label');
        expect(originalNote?.anchor).toEqual({ x: 0, y: 0 });
        writeFileSync(`${directory}/overlap-after.pdf`, after.bytes);
        writeFileSync(`${directory}/overlap-after.manifest.json`, `${JSON.stringify({ manifest: after.manifest, warnings: after.warnings, sha256: await sha256(after.bytes) }, null, 2)}\n`);
      }
    }
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const staticText = (await (await getDocument({ data: new Uint8Array(result.bytes) }).promise).getPage(1)).getTextContent();
    const transitionText = (await (await getDocument({ data: new Uint8Array(result.bytes) }).promise).getPage(3)).getTextContent();
    expect((await staticText).items.map((item) => 'str' in item ? item.str : '').join('')).toContain('Overlap note');
    expect((await transitionText).items.map((item) => 'str' in item ? item.str : '').join('')).not.toContain('Excluded text');
  });

  it('lays out hard breaks and authored spaces, and uses actual rank ink bounds without clipping text', async () => {
    const base = makeDocument();
    const printableLayer = { id: 'notes', name: 'Notes', visible: true, print: true, locked: false } as const;
    const multiline: FreeformDocument = {
      ...base,
      show: { ...base.show, title: 'First line\r\nSecond line' },
      layers: [printableLayer],
      annotations: [{
        id: 'multiline-note', kind: 'label', layerId: printableLayer.id, scope: { kind: 'show' },
        visibility: { editor: true, print: true, performerPacket: false }, text: '  Keep   spaces  \nSecond line', anchor: { x: 20000, y: 20000 },
      }],
    };
    const result = await buildPdfExport(multiline, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const page = await (await getDocument({ data: new Uint8Array(result.bytes) }).promise).getPage(1);
    const items = (await page.getTextContent()).items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
    expect(items.map(({ str }) => str)).toEqual(expect.arrayContaining(['First line', 'Second line', 'Keep', 'spaces']));
    const keep = items.find(({ str }) => str === 'Keep');
    const spaces = items.find(({ str }) => str === 'spaces');
    expect(keep?.transform[4]).toBeCloseTo(93.68, 2); // note text origin 89 + two authored space advances
    expect((spaces?.transform[4] ?? 0) - (keep?.transform[4] ?? 0)).toBeCloseTo(28.28, 2); // "Keep" + three authored spaces

    const rankOverlap: FreeformDocument = {
      ...base,
      layers: [printableLayer],
      sets: base.sets.map((set) => ({ ...set, positions: { ...set.positions, a: { x: 100000, y: 80000 } } })),
      annotations: [{
        id: 'rank-hit', kind: 'label', layerId: printableLayer.id, scope: { kind: 'set', setId: 'set-1' },
        visibility: { editor: true, print: true, performerPacket: false }, text: 'Hit rank', anchor: { x: 102400, y: 80400 },
      }],
    };
    const overlapResult = await buildPdfExport(rankOverlap, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
    expect(overlapResult.ok, JSON.stringify(overlapResult)).toBe(true);
    if (!overlapResult.ok) return;
    const rankWarning = overlapResult.warnings.find((warning) => warning.code === 'note-overlap' && warning.obstacleKind === 'rank-label');
    expect(rankWarning).toMatchObject({ annotationId: 'rank-hit', obstacleBounds: { x: 291, y: 299, width: 5.1, height: 5.74 } });
    const overlapPage = await (await getDocument({ data: new Uint8Array(overlapResult.bytes) }).promise).getPage(1);
    const rankItem = (await overlapPage.getTextContent()).items.find((item) => 'str' in item && item.str === 'A');
    expect('str' in (rankItem ?? {})).toBe(true);
    if (rankItem && 'str' in rankItem) expect(rankItem.transform.slice(4, 6)).toEqual([291, 299]);

    const belowResult = await buildPdfExport({
      ...rankOverlap,
      annotations: rankOverlap.annotations.map((annotation) => annotation.kind === 'label' ? { ...annotation, anchor: { x: 102400, y: 68400 } } : annotation),
    }, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
    expect(belowResult.ok).toBe(true);
    if (belowResult.ok) expect(belowResult.warnings.filter((warning) => warning.code === 'note-overlap' && warning.obstacleKind === 'rank-label')).toEqual([]);

    const touchingResult = await buildPdfExport({
      ...rankOverlap,
      annotations: rankOverlap.annotations.map((annotation) => annotation.kind === 'label' ? { ...annotation, anchor: { x: 102400, y: 72000 } } : annotation),
    }, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
    expect(touchingResult.ok).toBe(true);
    if (touchingResult.ok) expect(touchingResult.warnings.filter((warning) => warning.code === 'note-overlap' && warning.obstacleKind === 'rank-label')).toEqual([]);

    const offPageRank = await buildPdfExport({
      ...base,
      performers: [{ ...base.performers[0]!, rankCode: 'A'.repeat(32) }],
      sets: base.sets.map((set) => ({ ...set, positions: { ...set.positions, a: { x: 288000, y: 153600 } } })),
    }, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
    expect(offPageRank).toMatchObject({ ok: false, code: 'writer-failed', messageKey: 'pdfExport.error.writerFailed' });
    expect('bytes' in offPageRank).toBe(false);

    const offPageSymbol = await buildPdfExport({
      ...base,
      layers: [printableLayer], symbols: [{ id: 'a-symbol', name: 'A', glyph: 'A'.repeat(32) }],
      annotations: [{
        id: 'edge-symbol', kind: 'symbol', layerId: printableLayer.id, scope: { kind: 'show' },
        visibility: { editor: true, print: true, performerPacket: false }, symbolId: 'a-symbol', anchor: { x: 288000, y: 153600 }, rotationDegrees: 45, scale: 1,
      }],
    }, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
    expect(offPageSymbol).toMatchObject({ ok: false, code: 'writer-failed', messageKey: 'pdfExport.error.writerFailed' });
    expect('bytes' in offPageSymbol).toBe(false);
  });

  it('draws every font run of a rotated multi-font-run symbol glyph along one consistent rotated baseline', async () => {
    const base = makeDocument();
    const printableLayer = { id: 'notes', name: 'Notes', visible: true, print: true, locked: false } as const;
    // Anchor maps to field point (236, 377); rotationDegrees:90 means the SAME single
    // rotation must carry every font run's advance, so run 2 ('😀', a different embedded
    // font than run 1's 'A') must continue along +Y from run 1's end, not restart at an
    // unrotated-x-advanced position under its own local rotation (Huffer round-2 F5).
    const rotated: FreeformDocument = {
      ...base,
      layers: [printableLayer],
      symbols: [{ id: 'mixed', name: 'Mixed', glyph: 'A😀' }],
      annotations: [{
        id: 'mixed-symbol', kind: 'symbol', layerId: printableLayer.id, scope: { kind: 'show' },
        visibility: { editor: true, print: true, performerPacket: false }, symbolId: 'mixed', anchor: { x: 80000, y: 110000 }, rotationDegrees: 90, scale: 1.5,
      }],
    };
    const result = await buildPdfExport(rotated, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const page = await (await getDocument({ data: new Uint8Array(result.bytes) }).promise).getPage(1);
    const items = (await page.getTextContent()).items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
    // Disambiguate from the unrelated, unrotated rank-label "A": the rotated symbol
    // run carries a non-zero shear (transform[1]) from the 90-degree rotation matrix.
    const runA = items.find(({ str, transform }) => str === 'A' && Math.abs(transform[1]) > 1);
    const runEmoji = items.find(({ str, transform }) => str === '😀' && Math.abs(transform[1]) > 1);
    expect(runA).toBeDefined();
    expect(runEmoji).toBeDefined();
    const anchor = fieldPoint({ x: 80000, y: 110000 }, rotated.field);
    // Run 1 originates exactly at the anchor (the un-advanced start of the baseline).
    expect(runA!.transform[4]).toBeCloseTo(anchor.x, 2);
    expect(runA!.transform[5]).toBeCloseTo(anchor.y, 2);
    // Rotation is 90 degrees, so the local +X advance direction maps to global +Y:
    // run 2 must start exactly one run-1-advance further along +Y, at the SAME x as
    // run 1 (i.e. still on the anchor's vertical line), not at a separate unrotated
    // x-advanced-then-locally-rotated position.
    expect(runEmoji!.transform[4]).toBeCloseTo(runA!.transform[4], 2);
    expect(runEmoji!.transform[5]).toBeCloseTo(runA!.transform[5] + runA!.width, 1);
    // Both runs report the identical rotation/scale matrix (one consistent baseline):
    // near-zero a/d, and equal nonzero b/-c reflecting the shared 90-degree rotation.
    expect(runA!.transform[0]).toBeCloseTo(0, 6);
    expect(runA!.transform[3]).toBeCloseTo(0, 6);
    expect(runA!.transform[1]).toBeGreaterThan(0);
    expect(runA!.transform[2]).toBeLessThan(0);
    for (const index of [0, 1, 2, 3]) expect(runEmoji!.transform[index]).toBeCloseTo(runA!.transform[index], 6);
  });

  it('retains every selected static set when there are no transitions and packets follow document performer order', async () => {
    const document = makeDocument();
    const transitionless = {
      ...document,
      performers: [{ id: 'b', rankCode: 'B', displayName: 'Second' }, ...document.performers],
      sets: document.sets.map((set) => ({ ...set, positions: { ...set.positions, b: { x: 0, y: 0 } } })),
      transitions: [],
    };
    const packet = await buildPdfExport(transitionless, { kind: 'performer-packet', performerIds: ['a', 'b'], scope: { kind: 'full-show' } }, assets);
    expect(packet.ok).toBe(true);
    if (packet.ok) {
      expect(packet.manifest.pages).toMatchObject([
        { kind: 'performer-packet', performerId: 'b', setIds: ['set-1', 'set-2'] },
        { kind: 'performer-packet', performerId: 'a', setIds: ['set-1', 'set-2'] },
      ]);
    }
  });

  it('renders selected performer packets with once-only identity notes, exact static coordinates, scoped annotations, transition movement, and packet page numbers', async () => {
    const base = makeDocument();
    const document: FreeformDocument = {
      ...base,
      performers: [{ ...base.performers[0]!, notes: 'Bring a pencil.' }, { id: 'b', rankCode: 'B', displayName: 'No Notes' }],
      sets: base.sets.map((set, index) => ({ ...set, positions: { ...set.positions, b: { x: 216000 - index * 14400, y: 100000 } } })),
      layers: [{ id: 'packet-layer', name: 'Packet', visible: false, print: false, locked: false }],
      annotations: [
        { id: 'a-set-note', kind: 'performerNote', layerId: 'packet-layer', performerId: 'a', scope: { kind: 'set', setId: 'set-1' }, visibility: { editor: false, print: false, performerPacket: true }, text: 'Set-only instruction', anchor: { x: 200000, y: 90000 } },
        { id: 'a-transition-note', kind: 'performerNote', layerId: 'packet-layer', performerId: 'a', scope: { kind: 'transition', transitionId: 'move-1' }, visibility: { editor: false, print: false, performerPacket: true }, text: 'Transition instruction', anchor: { x: 200000, y: 90000 } },
        // performerPacket:false, despite editor/print both true, must stay excluded from
        // b's packet: the packet gate is performerPacket && matching performerId only,
        // independent of editor/print flags (src/document/annotations.ts:100-101).
        { id: 'b-non-packet-note', kind: 'performerNote', layerId: 'packet-layer', performerId: 'b', scope: { kind: 'set', setId: 'set-1' }, visibility: { editor: true, print: true, performerPacket: false }, text: 'Not flagged for packet', anchor: { x: 200000, y: 90000 } },
      ],
    };
    const before = structuredClone(document);
    const result = await buildPdfExport(document, { kind: 'performer-packet', performerIds: ['b', 'a'], scope: { kind: 'full-show' } }, assets);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(document).toEqual(before);
    expect(result.warnings).toEqual([]);
    expect(result.manifest.pages.map((page) => page.performerId)).toEqual(['a', 'b']);
    expect(result.manifest.pages[0]?.packetEntries).toEqual([
      { context: { kind: 'static-set', setId: 'set-1' }, annotationIds: ['a-set-note'] },
      { context: { kind: 'static-set', setId: 'set-2' }, annotationIds: [] },
      { context: { kind: 'active-transition', transitionId: 'move-1', count: 16 }, annotationIds: ['a-transition-note'] },
    ]);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const parsed = await getDocument({ data: new Uint8Array(result.bytes) }).promise;
    expect(parsed.numPages).toBe(2);
    const aText = (await (await parsed.getPage(1)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join('');
    const bText = (await (await parsed.getPage(2)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join('');
    expect(aText).toContain('Notes:');
    expect(aText).toContain('Bring a pencil.');
    expect(aText).toContain('Coordinate: (0, 0) FU');
    expect(aText).toContain('Set-only instruction');
    expect(aText).toContain('Transition instruction');
    expect(aText).toContain('Movement:');
    expect(aText).toContain('Page 1 of 1');
    expect(aText).not.toContain('Not flagged for packet');
    expect(bText).toContain('No Notes');
    expect(bText).not.toContain('Notes:');
    expect(bText).not.toContain('Bring a pencil.');
    expect(bText).not.toContain('Set-only instruction');
    expect(bText).not.toContain('Not flagged for packet');
    // Page numbering is local to each performer's own packet (design:93,140):
    // b's single-page packet is "Page 1 of 1", independent of a's packet before it.
    expect(bText).toContain('Page 1 of 1');
  });

  it('renders every selected packet mark kind with canonical diagram geometry and symbol transforms', async () => {
    const base = makeDocument();
    const document: FreeformDocument = {
      ...base,
      performers: [...base.performers, { id: 'b', rankCode: 'B', displayName: 'Other Performer' }],
      sets: base.sets.map((set) => ({ ...set, positions: { ...set.positions, b: { x: 144000, y: 76800 } } })),
      // Packet selection deliberately ignores editor/print/layer flags. The
      // selected annotations must render despite every one of those gates here.
      layers: [{ id: 'packet-layer', name: 'Packet', visible: false, print: false, locked: false }],
      symbols: [{ id: 'mixed', name: 'Mixed font glyph', glyph: 'A😀' }],
      annotations: [
        { id: 'a-freehand', kind: 'freehand', layerId: 'packet-layer', performerId: 'a', scope: { kind: 'set', setId: 'set-1' }, visibility: { editor: false, print: false, performerPacket: true }, strokes: [[{ x: 0, y: 0 }, { x: 72000, y: 38400 }, { x: 144000, y: 76800 }]] },
        { id: 'a-arrow', kind: 'arrow', layerId: 'packet-layer', performerId: 'a', scope: { kind: 'transition', transitionId: 'move-1' }, visibility: { editor: false, print: false, performerPacket: true }, points: [{ x: 72000, y: 30000 }, { x: 216000, y: 120000 }] },
        { id: 'a-symbol', kind: 'symbol', layerId: 'packet-layer', performerId: 'a', scope: { kind: 'show' }, visibility: { editor: false, print: false, performerPacket: true }, symbolId: 'mixed', anchor: { x: 288000, y: 153600 }, rotationDegrees: 90, scale: 1.5 },
        { id: 'b-hidden-from-a', kind: 'freehand', layerId: 'packet-layer', performerId: 'b', scope: { kind: 'show' }, visibility: { editor: true, print: true, performerPacket: true }, strokes: [[{ x: 0, y: 153600 }, { x: 288000, y: 0 }]] },
        { id: 'a-not-flagged', kind: 'arrow', layerId: 'packet-layer', performerId: 'a', scope: { kind: 'show' }, visibility: { editor: true, print: true, performerPacket: false }, points: [{ x: 0, y: 0 }, { x: 288000, y: 153600 }] },
      ],
    };
    const request = { kind: 'performer-packet', performerIds: ['a'], scope: { kind: 'full-show' } } as const;
    const sourceBefore = structuredClone(document);
    const withoutMarks = await buildPdfExport({ ...document, annotations: [] }, request, assets);
    const result = await buildPdfExport(document, request, assets);
    expect(withoutMarks.ok, JSON.stringify(withoutMarks)).toBe(true);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!withoutMarks.ok || !result.ok) return;
    expect(result.bytes).not.toEqual(withoutMarks.bytes);
    expect(result.manifest.pages[0]?.packetEntries).toEqual([
      { context: { kind: 'static-set', setId: 'set-1' }, annotationIds: ['a-freehand', 'a-symbol'] },
      { context: { kind: 'static-set', setId: 'set-2' }, annotationIds: ['a-symbol'] },
      { context: { kind: 'active-transition', transitionId: 'move-1', count: 16 }, annotationIds: ['a-arrow', 'a-symbol'] },
    ]);
    expect(result.manifest.pages.flatMap((page) => page.annotationIds)).not.toContain('b-hidden-from-a');
    expect(result.manifest.pages.flatMap((page) => page.annotationIds)).not.toContain('a-not-flagged');

    const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const markedPdf = await getDocument({ data: new Uint8Array(result.bytes) }).promise;
    const controlPdf = await getDocument({ data: new Uint8Array(withoutMarks.bytes) }).promise;
    const markedPage = await markedPdf.getPage(1);
    const controlPage = await controlPdf.getPage(1);
    const markedOperators = await markedPage.getOperatorList();
    const controlOperators = await controlPage.getOperatorList();
    expect(markedOperators.fnArray.filter((operator) => operator === OPS.constructPath).length)
      .toBeGreaterThan(controlOperators.fnArray.filter((operator) => operator === OPS.constructPath).length);
    const text = (await markedPage.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join('');
    expect(text).toContain('😀');

    for (const markId of ['a-freehand', 'a-arrow', 'a-symbol'] as const) {
      const singleMark = await buildPdfExport({
        ...document,
        annotations: document.annotations.filter((annotation) => annotation.id === markId),
      }, request, assets);
      expect(singleMark.ok, markId).toBe(true);
      if (!singleMark.ok) continue;
      expect(singleMark.bytes, markId).not.toEqual(withoutMarks.bytes);
      expect(singleMark.manifest.pages.flatMap((page) => page.annotationIds), markId).toContain(markId);
      const singlePage = await (await getDocument({ data: new Uint8Array(singleMark.bytes) }).promise).getPage(1);
      if (markId !== 'a-symbol') {
        const operators = await singlePage.getOperatorList();
        expect(operators.fnArray.filter((operator) => operator === OPS.constructPath).length, markId)
          .toBeGreaterThan(controlOperators.fnArray.filter((operator) => operator === OPS.constructPath).length);
      } else {
        const items = (await singlePage.getTextContent()).items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
        const symbolA = items.find(({ str, transform }) => str === 'A' && Math.abs(transform[1]) > 1);
        const symbolEmoji = items.find(({ str, transform }) => str === '😀' && Math.abs(transform[1]) > 1);
        expect(symbolA).toBeDefined();
        expect(symbolEmoji).toBeDefined();
        expect(symbolEmoji!.transform[4]).toBeCloseTo(symbolA!.transform[4], 2);
        expect(symbolEmoji!.transform[5]).toBeGreaterThan(symbolA!.transform[5]);
      }
    }
    const unsupportedSymbol = await buildPdfExport({
      ...document,
      symbols: [{ ...document.symbols![0]!, glyph: '\u{10ffff}' }],
      annotations: document.annotations.filter((annotation) => annotation.id === 'a-symbol'),
    }, request, assets);
    expect(unsupportedSymbol).toMatchObject({ ok: false, code: 'unsupported-glyph', messageKey: 'pdfExport.error.unsupportedGlyph' });
    expect(document).toEqual(sourceBefore);
  });

  it('paginates packet entries, reports own-note overlaps, and classifies packet chrome versus note layout failures', async () => {
    const base = makeDocument();
    const document: FreeformDocument = {
      ...base,
      performers: [{ ...base.performers[0]!, displayName: 'Packet Performer', notes: 'Identity note' }],
      sets: Array.from({ length: 5 }, (_, index) => ({ id: `set-${index + 1}`, name: `Set ${index + 1}`, startCount: index * 16, positions: { a: { x: index * 14400, y: index * 7200 } } })),
      transitions: [{ id: 'move-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float' }],
      layers: [{ id: 'packet-layer', name: 'Packet', visible: false, print: false, locked: false }],
      annotations: [{ id: 'overlap', kind: 'performerNote', layerId: 'packet-layer', performerId: 'a', scope: { kind: 'set', setId: 'set-1' }, visibility: { editor: false, print: false, performerPacket: true }, text: 'Overlap me', anchor: { x: 0, y: 0 } }],
    };
    const packetRequest = { kind: 'performer-packet', performerIds: ['a'], scope: { kind: 'full-show' } } as const;
    const result = await buildPdfExport(document, packetRequest, assets);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.pages).toHaveLength(2);
    expect(result.manifest.pages.map((page) => page.packetEntries?.map((entry) => entry.context))).toEqual([
      [{ kind: 'static-set', setId: 'set-1' }, { kind: 'static-set', setId: 'set-2' }, { kind: 'static-set', setId: 'set-3' }],
      [{ kind: 'static-set', setId: 'set-4' }, { kind: 'static-set', setId: 'set-5' }, { kind: 'active-transition', transitionId: 'move-1', count: 16 }],
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'note-overlap', pageIndex: 0, context: { kind: 'static-set', setId: 'set-1' }, annotationId: 'overlap', performerId: 'a', obstacleKind: 'dot' }),
    ]));
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const parsed = await getDocument({ data: new Uint8Array(result.bytes) }).promise;
    const first = (await (await parsed.getPage(1)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join('');
    const second = (await (await parsed.getPage(2)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join('');
    expect(first).toContain('Page 1 of 2');
    expect(second).toContain('Page 2 of 2');
    expect(second).not.toContain('Identity note');
    // An overlong set name (schema max 120 chars) cannot fit the fixed packet
    // entry-line width at any wrap width of 1 (no spaces to break on), so it is
    // packet CHROME overflow (writer-failed), not a note overflow.
    const overlongSetName = {
      ...document,
      sets: document.sets.map((set) => set.id === 'set-1' ? { ...set, name: 'X'.repeat(120) } : set),
    };
    await expect(buildPdfExport(overlongSetName, packetRequest, assets)).resolves.toEqual({ ok: false, code: 'writer-failed', messageKey: 'pdfExport.error.writerFailed', detail: [] });
    await expect(buildPdfExport({ ...document, performers: [{ ...document.performers[0]!, notes: 'X'.repeat(1000) }] }, packetRequest, assets)).resolves.toEqual({ ok: false, code: 'note-layout-overflow', messageKey: 'pdfExport.error.noteLayoutOverflow', detail: [] });
  });

  it('starts the first entry on page two when an identity note fits alone but not with an entry', async () => {
    const base = makeDocument();
    // 44 explicit note lines yield 46 identity lines (rank/name + Notes label),
    // or 570pt. That fits the 714pt packet capacity alone, but not with the
    // 190pt first entry (760pt total).
    const document: FreeformDocument = {
      ...base,
      performers: [{ ...base.performers[0]!, notes: Array.from({ length: 44 }, (_, index) => `line ${index + 1}`).join('\n') }],
    };
    const request = {
      kind: 'performer-packet', performerIds: ['a'],
      scope: { kind: 'inclusive-set-range', firstSetId: 'set-1', lastSetId: 'set-1' },
    } as const;
    const result = await buildPdfExport(document, request, assets);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.pages).toMatchObject([
      { performerId: 'a', packetEntries: [] },
      { performerId: 'a', packetEntries: [{ context: { kind: 'static-set', setId: 'set-1' } }] },
    ]);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const parsed = await getDocument({ data: new Uint8Array(result.bytes) }).promise;
    expect(parsed.numPages).toBe(2);
    const first = (await (await parsed.getPage(1)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join('');
    const second = (await (await parsed.getPage(2)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join('');
    expect(first).toContain('line 44');
    expect(first).not.toContain('Set 1');
    expect(first).toContain('Page 1 of 2');
    expect(second).toContain('Set 1');
    expect(second).not.toContain('line 44');
    expect(second).toContain('Page 2 of 2');
  });

  it('strictly rejects unknown, duplicate, blank, out-of-range, and out-of-scope request selections before PDF bytes', async () => {
    const requestFailures: readonly [PdfExportRequest, string][] = [
      [{ kind: 'performer-packet', performerIds: [], scope: { kind: 'full-show' } }, 'pdfExport.error.validation.noPerformersSelected'],
      [{ kind: 'performer-packet', performerIds: ['a', 'a'], scope: { kind: 'full-show' } }, 'pdfExport.error.validation.duplicatePerformerSelected'],
      [{ kind: 'performer-packet', performerIds: ['missing'], scope: { kind: 'full-show' } }, 'pdfExport.error.validation.unknownPerformer'],
      [{ kind: 'director', scope: { kind: 'inclusive-set-range', firstSetId: 'missing', lastSetId: 'set-2' }, transitionFrames: [] }, 'pdfExport.error.validation.unknownSet'],
      [{ kind: 'director', scope: { kind: 'inclusive-set-range', firstSetId: 'set-2', lastSetId: 'set-1' }, transitionFrames: [] }, 'pdfExport.error.validation.rangeReversed'],
      [{ kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [{ transitionId: 'missing', counts: [0] }] }, 'pdfExport.error.validation.unknownTransition'],
      [{ kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [{ transitionId: 'move-1', counts: [] }] }, 'pdfExport.error.validation.transitionCountBlank'],
      [{ kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [{ transitionId: 'move-1', counts: [1, 1] }] }, 'pdfExport.error.validation.transitionCountDuplicate'],
      [{ kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [{ transitionId: 'move-1', counts: [-1] }] }, 'pdfExport.error.validation.transitionCountNegative'],
      [{ kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [{ transitionId: 'move-1', counts: [1.5] }] }, 'pdfExport.error.validation.transitionCountDecimal'],
      [{ kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [{ transitionId: 'move-1', counts: [17] }] }, 'pdfExport.error.validation.transitionCountOutOfDomain'],
      [{ kind: 'director', scope: { kind: 'inclusive-set-range', firstSetId: 'set-1', lastSetId: 'set-1' }, transitionFrames: [{ transitionId: 'move-1', counts: [0] }] }, 'pdfExport.error.validation.transitionOutsideRange'],
    ];
    for (const [request, messageKey] of requestFailures) {
      await expect(buildPdfExport(makeDocument(), request, assets)).resolves.toMatchObject({ ok: false, code: 'validation-failed', messageKey });
    }
    const unsupported = await buildPdfExport({ ...makeDocument(), show: { ...makeDocument().show, title: 'Bad \u{10ffff}' } }, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
    expect(unsupported).toMatchObject({ ok: false, code: 'unsupported-glyph', messageKey: 'pdfExport.error.unsupportedGlyph' });
  });

  it('rejects malformed document snapshots and malformed runtime request discriminants without throwing', async () => {
    const invalidDocuments: readonly FreeformDocument[] = [
      { ...makeDocument(), performers: [{ ...makeDocument().performers[0]! }, { ...makeDocument().performers[0]! }] },
      {
        ...makeDocument(),
        performers: [...makeDocument().performers, { id: 'b', rankCode: 'a', displayName: 'Second' }],
        sets: makeDocument().sets.map((set) => ({ ...set, positions: { ...set.positions, b: { x: 0, y: 0 } } })),
      },
      { ...makeDocument(), show: { ...makeDocument().show, id: 'BAD ID' } },
      { ...makeDocument(), field: { ...makeDocument().field, frontHashY: 0 } as unknown as FreeformDocument['field'] },
      { ...makeDocument(), sets: [] },
      { ...makeDocument(), performers: [] },
      { ...makeDocument(), settings: {} as unknown as FreeformDocument['settings'] },
      { ...makeDocument(), annotations: undefined as unknown as FreeformDocument['annotations'] },
    ];
    for (const document of invalidDocuments) {
      await expect(buildPdfExport(document, directorRequest, assets)).resolves.toMatchObject({ ok: false, code: 'document-invalid', messageKey: 'pdfExport.error.documentInvalid.schema' });
    }
    const malformedRequests: readonly unknown[] = [
      { kind: 'nonsense', performerIds: ['a'], scope: { kind: 'full-show' } },
      { kind: 'director', scope: { kind: 'nonsense', firstSetId: 'set-1', lastSetId: 'set-2' }, transitionFrames: [] },
      { kind: 'director', scope: { kind: 'full-show' } },
      { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [{ transitionId: 'move-1' }] },
    ];
    for (const request of malformedRequests) {
      await expect(buildPdfExport(makeDocument(), request as PdfExportRequest, assets)).resolves.toMatchObject({ ok: false, code: 'document-invalid', messageKey: 'pdfExport.error.documentInvalid.schema' });
    }
  });

  it('uses the canonical AJV URI authority for export snapshot validation', async () => {
    const fixture = fixtureDocument('freeform-1.0-example');
    for (const uri of ['https: bad uri', 'https://example.com/%ZZ', 'https://[broken']) {
      const document = { ...fixture, $schema: uri } as FreeformDocument;
      expect(() => validateCurrentDocument(document)).toThrow();
      const result = await buildPdfExport(document, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets);
      expect(result).toEqual({ ok: false, code: 'document-invalid', messageKey: 'pdfExport.error.documentInvalid.schema', detail: [] });
      expect('bytes' in result).toBe(false);
    }
    for (const uri of ['urn:freeform:example', 'https://[2001:db8::1]/x']) {
      const document = { ...fixture, $schema: uri, annotations: [] } as FreeformDocument;
      expect(() => validateCurrentDocument(document)).not.toThrow();
      await expect(buildPdfExport(document, { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] }, assets)).resolves.toMatchObject({ ok: true });
    }
  });

  it('routes semantic FTL fixture failures to the approved FTL error key', async () => {
    const request = { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] } as const;
    for (const name of ['ftl-end-mismatch', 'ftl-offset-order', 'insufficient-ftl-path']) {
      const result = await buildPdfExport(fixtureDocument(`negative/${name}`), request, assets);
      expect(result).toEqual({ ok: false, code: 'document-invalid', messageKey: 'pdfExport.error.documentInvalid.ftl', detail: [] });
      expect('bytes' in result).toBe(false);
    }
    const valid = fixtureDocument('positive/ftl-path-non-horizontal');
    const stale = {
      ...valid,
      performers: valid.performers.filter(({ id }) => id !== 'a'),
      sets: valid.sets.map((set) => {
        const { a: _removed, ...positions } = set.positions;
        return { ...set, positions };
      }),
    };
    await expect(buildPdfExport(stale, request, assets)).resolves.toEqual({ ok: false, code: 'document-invalid', messageKey: 'pdfExport.error.documentInvalid.ftl', detail: [] });
    await expect(buildPdfExport(fixtureDocument('negative/missing-ftl-data'), request, assets)).resolves.toEqual({ ok: false, code: 'document-invalid', messageKey: 'pdfExport.error.documentInvalid.schema', detail: [] });
    for (const name of ['ftl-path-non-horizontal', 'ftl-path-multi-point']) {
      await expect(buildPdfExport(fixtureDocument(`positive/${name}`), request, assets)).resolves.toMatchObject({ ok: true });
    }
  });

  it('clones synchronously before asynchronous font work and does not change command-store state', async () => {
    const store = createCommandStore(makeDocument());
    const before = store.getState();
    const exportPromise = buildPdfExport(before.document, directorRequest, assets);
    store.apply({ type: 'show.title.set', title: 'Mutated after export started' });
    const result = await exportPromise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.filename).toContain('Café 😀');
    expect(before.document.show.title).toBe('Café 😀');
    expect(store.getState().revision).toBe(before.revision + 1);
    expect(store.canUndo()).toBe(true);
  });

  it('leaves command-store reference/revision/undo/redo/dirty/persistence-spy state unchanged on every failure and cancel path', async () => {
    const document = makeDocument();
    const store = createCommandStore(document);
    const persistenceWrites: unknown[] = [];
    const spied = observeCommandStore(store, (event) => persistenceWrites.push(event));
    const before = spied.getState();

    const assertUntouched = (): void => {
      expect(spied.getState()).toBe(before);
      expect(spied.getState().revision).toBe(before.revision);
      expect(spied.canUndo()).toBe(false);
      expect(spied.canRedo()).toBe(false);
      expect(persistenceWrites).toEqual([]);
    };

    // document-invalid
    const invalidDocument = { ...before.document, format: 'not-freeform' } as unknown as FreeformDocument;
    expect(await buildPdfExport(invalidDocument, directorRequest, assets)).toMatchObject({ ok: false, code: 'document-invalid' });
    assertUntouched();

    // validation-failed (unknown performer / duplicate count already covered elsewhere; cover empty packet selection here)
    expect(await buildPdfExport(before.document, { kind: 'performer-packet', performerIds: [], scope: { kind: 'full-show' } }, assets)).toMatchObject({ ok: false, code: 'validation-failed' });
    assertUntouched();

    // font-load-failed: empty font list
    expect(await buildPdfExport(before.document, directorRequest, { fonts: [] })).toMatchObject({ ok: false, code: 'font-load-failed' });
    assertUntouched();

    // font-load-failed: hash mismatch
    const corruptAssets: PdfAssets = { fonts: assets.fonts.map((font) => ({ ...font, sha256: '0'.repeat(64) })) };
    expect(await buildPdfExport(before.document, directorRequest, corruptAssets)).toMatchObject({ ok: false, code: 'font-load-failed' });
    assertUntouched();

    // font-load-failed: bytes that are not a loadable font (fontkit.create throws)
    const unloadableAssets: PdfAssets = {
      fonts: [{ ...assets.fonts[0]!, bytes: new Uint8Array([0, 1, 2, 3]), sha256: await sha256(new Uint8Array([0, 1, 2, 3])) }],
    };
    expect(await buildPdfExport(before.document, directorRequest, unloadableAssets)).toMatchObject({ ok: false, code: 'font-load-failed' });
    assertUntouched();

    // unsupported-glyph
    const unsupportedDocument = { ...before.document, show: { ...before.document.show, title: 'Bad \u{10ffff}' } };
    expect(await buildPdfExport(unsupportedDocument, directorRequest, assets)).toMatchObject({ ok: false, code: 'unsupported-glyph' });
    assertUntouched();

    // adapter cancel (download layer never touches the store either)
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', {}, { cancelled: true })).toEqual({ ok: false, code: 'cancelled' });
    assertUntouched();

    // writer-failed: bytes pass fontkit.create() and the sha256/glyph-coverage checks
    // (same codepoints resolve to a glyph ID) but are truncated enough that pdf-lib's
    // embedFont({ subset: true }) throws while reading internal font tables.
    const latinBytes = readFileSync('src/pdf/assets/noto-sans-latin-400.woff');
    const truncatedLatin = latinBytes.subarray(0, latinBytes.length - 2000);
    const writerFailAssets: PdfAssets = {
      fonts: [
        { ...assets.fonts[0]!, bytes: new Uint8Array(truncatedLatin), sha256: await sha256(new Uint8Array(truncatedLatin)) },
        assets.fonts[1]!,
        assets.fonts[2]!,
      ],
    };
    expect(await buildPdfExport(before.document, directorRequest, writerFailAssets)).toMatchObject({ ok: false, code: 'writer-failed' });
    assertUntouched();
  });

  it('maps canonical field corners without CSS geometry', () => {
    const field = makeDocument().field;
    expect(fieldPoint({ x: 0, y: 0 }, field)).toEqual({ x: 36, y: 102 });
    expect(fieldPoint({ x: 288000, y: 153600 }, field)).toEqual({ x: 756, y: 486 });
  });
});

describe('PDF download adapter', () => {
  it('reports unavailable Blob/URL, dispatch failure, cancel, and revokes after successful dispatch', async () => {
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', {})).toEqual({ ok: false, code: 'blob-unavailable' });
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', { Blob })).toEqual({ ok: false, code: 'url-unavailable' });
    const revoke = vi.fn();
    const create = vi.fn(() => 'blob:test');
    const noBodyEnvironment = { Blob, URL: { createObjectURL: create, revokeObjectURL: revoke }, document: { createElement: vi.fn() } as unknown as Document };
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', noBodyEnvironment)).toEqual({ ok: false, code: 'download-dispatch-failed' });
    expect(revoke).toHaveBeenCalledWith('blob:test');
    const throwingClickEnvironment = {
      Blob, URL: { createObjectURL: create, revokeObjectURL: revoke },
      document: { body: { append: vi.fn() }, createElement: vi.fn(() => ({ href: '', download: '', style: { display: '' }, click: () => { throw new Error('blocked'); }, remove: vi.fn() })) } as unknown as Document,
    };
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', throwingClickEnvironment)).toEqual({ ok: false, code: 'download-dispatch-failed' });
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', {}, { cancelled: true })).toEqual({ ok: false, code: 'cancelled' });
    const click = vi.fn();
    const remove = vi.fn();
    const body = { append: vi.fn() } as unknown as HTMLBodyElement;
    const page = { body, createElement: vi.fn(() => ({ href: '', download: '', style: { display: '' }, click, remove })) } as unknown as Document;
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', { Blob, URL: { createObjectURL: create, revokeObjectURL: revoke }, document: page })).toEqual({ ok: true });
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });

  it('contains cleanup exceptions and removes anchors after append or click failures', async () => {
    const click = vi.fn();
    const remove = vi.fn();
    const revoke = vi.fn(() => { throw new Error('cleanup'); });
    const environment = {
      Blob,
      URL: { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: revoke },
      document: { body: { append: vi.fn() }, createElement: vi.fn(() => ({ href: '', download: '', style: { display: '' }, click, remove })) } as unknown as Document,
    };
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', environment)).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revoke).toHaveBeenCalledWith('blob:test');

    const failedRemove = vi.fn();
    const failedClickEnvironment = {
      Blob,
      URL: { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() },
      document: { body: { append: vi.fn() }, createElement: vi.fn(() => ({ href: '', download: '', style: { display: '' }, click: () => { throw new Error('blocked'); }, remove: failedRemove })) } as unknown as Document,
    };
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', failedClickEnvironment)).toEqual({ ok: false, code: 'download-dispatch-failed' });
    expect(failedRemove).toHaveBeenCalledOnce();

    const appendedRemove = vi.fn();
    const appendFailureEnvironment = {
      Blob,
      URL: { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() },
      document: { body: { append: () => { throw new Error('append failed'); } }, createElement: vi.fn(() => ({ href: '', download: '', style: { display: '' }, click: vi.fn(), remove: appendedRemove })) } as unknown as Document,
    };
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', appendFailureEnvironment)).toEqual({ ok: false, code: 'download-dispatch-failed' });
    expect(appendedRemove).toHaveBeenCalledOnce();

    const throwingBlob = class { constructor() { throw new Error('Blob failed'); } } as unknown as typeof Blob;
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', { Blob: throwingBlob })).toEqual({ ok: false, code: 'blob-unavailable' });
    expect(downloadPdf(new Uint8Array([1]), 'x.pdf', { Blob, URL: { createObjectURL: () => { throw new Error('URL failed'); }, revokeObjectURL: vi.fn() } })).toEqual({ ok: false, code: 'url-unavailable' });
  });
});

it('writes retained qualification artifacts only when explicitly requested', async () => {
  if (process.env.M8_WRITE_EVIDENCE !== '1') return;
  const directory = process.env.M8_EVIDENCE_DIR ?? 'evidence/m8-pdf-foundation';
  mkdirSync(directory, { recursive: true });
  const first = await successfulExport();
  const second = await successfulExport();
  writeFileSync(`${directory}/same-runtime-a.pdf`, first.bytes);
  writeFileSync(`${directory}/same-runtime-b.pdf`, second.bytes);
  const { getDocument, version } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const page = await (await getDocument({ data: new Uint8Array(first.bytes) }).promise).getPage(1);
  const extracted = (await page.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join('');
  writeFileSync(`${directory}/extracted-page-1.txt`, extracted);
  execFileSync('gs', ['-q', '-dSAFER', '-sDEVICE=pngalpha', '-r144', `-sOutputFile=${directory}/page-%d.png`, '-dBATCH', '-dNOPAUSE', `${directory}/same-runtime-a.pdf`]);
  const hash = await sha256(first.bytes);
  writeFileSync(`${directory}/qualification.json`, `${JSON.stringify({
    writer: 'pdf-lib@1.17.1 + @pdf-lib/fontkit@1.1.1', extractor: `pdfjs-dist@${version}`,
    renderer: execFileSync('gs', ['--version']).toString().trim(), sha256: hash,
    sameRuntimeByteEquality: first.bytes.every((value, index) => value === second.bytes[index]), pageCount: first.manifest.pages.length,
    pageSizePoints: { width: 792, height: 612 }, language: 'en-US',
    extractedContains: ['Café', 'Русский', '😀'].map((value) => [value, extracted.includes(value)]),
    tagging: 'Unresolved: pdf-lib output has no authored PDF structure tree; no tagged/fully accessible claim.',
  }, null, 2)}\n`);
});

it('writes director-rendering evidence only when explicitly requested', async () => {
  if (process.env.M8_WRITE_DIRECTOR_EVIDENCE !== '1') return;
  const directory = process.env.M8_DIRECTOR_EVIDENCE_DIR ?? 'evidence/m8-director';
  const filename = process.env.M8_DIRECTOR_EVIDENCE_FILE ?? 'same-runtime-a.pdf';
  mkdirSync(directory, { recursive: true });
  const document = { ...makeDocument(), show: { ...makeDocument().show, title: 'Café Русский é 😀' } };
  const result = await buildPdfExport(document, directorRequest, assets);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  writeFileSync(`${directory}/${filename}`, result.bytes);
  writeFileSync(`${directory}/${filename}.manifest.json`, `${JSON.stringify({ manifest: result.manifest, warnings: result.warnings, sha256: await sha256(result.bytes) }, null, 2)}\n`);
  if (process.env.M8_DIRECTOR_EVIDENCE_PAIR === '1') {
    const second = await buildPdfExport(document, directorRequest, assets);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    if (!second.ok) return;
    const pairFilename = filename.replace(/-a\.pdf$/u, '-b.pdf');
    writeFileSync(`${directory}/${pairFilename}`, second.bytes);
    writeFileSync(`${directory}/${pairFilename}.manifest.json`, `${JSON.stringify({ manifest: second.manifest, warnings: second.warnings, sha256: await sha256(second.bytes) }, null, 2)}\n`);
  }
});

it('writes retained performer-packet evidence only when explicitly requested', async () => {
  if (process.env.M8_WRITE_PACKET_EVIDENCE !== '1') return;
  const directory = process.env.M8_PACKET_EVIDENCE_DIR ?? 'evidence/m8-packet';
  mkdirSync(directory, { recursive: true });
  const base = makeDocument();
  const document: FreeformDocument = {
    ...base,
    show: { ...base.show, title: 'Café Русский é 😀' },
    performers: [
      { ...base.performers[0]!, notes: 'Stage left on count 8. Watch the hash.' },
      { id: 'b', rankCode: 'B2', displayName: 'No Notes Performer' },
    ],
    sets: base.sets.map((set) => ({ ...set, positions: { ...set.positions, b: { x: 72000, y: 38400 } } })),
  };
  const withTransition = await buildPdfExport(document, { kind: 'performer-packet', performerIds: ['a', 'b'], scope: { kind: 'full-show' } }, assets);
  expect(withTransition.ok, JSON.stringify(withTransition)).toBe(true);
  if (withTransition.ok) {
    writeFileSync(`${directory}/packets-with-transition.pdf`, withTransition.bytes);
    writeFileSync(`${directory}/packets-with-transition.manifest.json`, `${JSON.stringify({ manifest: withTransition.manifest, warnings: withTransition.warnings, sha256: await sha256(withTransition.bytes) }, null, 2)}\n`);
  }
  const noTransitionDocument: FreeformDocument = { ...document, transitions: [] };
  const withoutTransition = await buildPdfExport(noTransitionDocument, { kind: 'performer-packet', performerIds: ['a', 'b'], scope: { kind: 'full-show' } }, assets);
  expect(withoutTransition.ok, JSON.stringify(withoutTransition)).toBe(true);
  if (withoutTransition.ok) {
    writeFileSync(`${directory}/packets-no-transition.pdf`, withoutTransition.bytes);
    writeFileSync(`${directory}/packets-no-transition.manifest.json`, `${JSON.stringify({ manifest: withoutTransition.manifest, warnings: withoutTransition.warnings, sha256: await sha256(withoutTransition.bytes) }, null, 2)}\n`);
  }
});
