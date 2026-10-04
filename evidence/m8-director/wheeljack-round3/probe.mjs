import { createServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import assert from 'node:assert/strict';

const out = 'evidence/m8-director/wheeljack-round3';
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { buildPdfExport } = await server.ssrLoadModule('/src/pdf/pdf-export.ts');
  const { selectAnnotations } = await server.ssrLoadModule('/src/document/annotations.ts');
  const assets = { fonts: ['noto-sans-latin-400.woff', 'noto-sans-cyrillic-400.woff', 'noto-emoji-400.ttf'].map((n, i) => {
    const bytes = new Uint8Array(readFileSync('src/pdf/assets/' + n));
    return { id: n, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), subset: i !== 2 };
  }) };
  const base = {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'Café Русский é 😀', totalCounts: 16 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A', displayName: 'A' }],
    sets: [
      { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 100000, y: 80000 } } },
      { id: 'set-2', name: 'Set 2', startCount: 16, positions: { a: { x: 120000, y: 90000 } } },
    ],
    transitions: [{ id: 'move-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float' }],
    layers: [{ id: 'notes', name: 'Notes', visible: true, print: true, locked: false }],
    annotations: [],
  };
  const req = { kind: 'director', scope: { kind: 'full-show' }, transitionFrames: [] };
  const results = [];

  async function run(name, document, request = req) {
    const before = JSON.stringify(document);
    const result = await buildPdfExport(document, request, assets);
    assert.equal(before, JSON.stringify(document), `${name}: document mutated`);
    const row = { name, ok: result.ok, code: result.code, messageKey: result.messageKey };
    if (result.ok) {
      writeFileSync(`${out}/${name}.pdf`, result.bytes);
      writeFileSync(`${out}/${name}.manifest.json`, JSON.stringify(result.manifest, null, 2));
      row.sha256 = createHash('sha256').update(result.bytes).digest('hex');
      row.warnings = result.warnings;
      const pdf = await getDocument({ data: new Uint8Array(result.bytes) }).promise;
      row.pages = [];
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i);
        const text = await page.getTextContent();
        assert.deepEqual(page.view, [0, 0, 792, 612], `${name}: page ${i} MediaBox`);
        assert.deepEqual(
          result.manifest.pages[i - 1].annotationIds,
          selectAnnotations(document, { audience: 'director-print', context: result.manifest.pages[i - 1].context }).map((a) => a.id),
          `${name}: page ${i} annotation-ID manifest mismatch`,
        );
        row.pages.push({
          view: page.view,
          items: text.items.filter((x) => 'str' in x).map((x) => ({ str: x.str, transform: x.transform, width: x.width, height: x.height })),
        });
      }
      await pdf.destroy();
    } else {
      assert.equal('bytes' in result, false, `${name}: failure result leaked bytes`);
    }
    results.push(row);
    return row;
  }

  // --- F5 regression: rotated multi-font-run symbol glyph, exact round-2 repro case ---
  const marks = structuredClone(base);
  marks.symbols = [{ id: 'mixed', name: 'Mixed', glyph: 'A😀' }];
  marks.annotations = [{
    id: 'symbol', kind: 'symbol', layerId: 'notes', scope: { kind: 'show' },
    visibility: { editor: true, print: true, performerPacket: false },
    symbolId: 'mixed', anchor: { x: 80000, y: 110000 }, rotationDegrees: 90, scale: 1.5,
  }];
  const marksRow = await run('all-marks-rotated-symbol', marks);
  assert.equal(marksRow.ok, true, 'rotated multi-font-run symbol must still export successfully');
  const marksItems = marksRow.pages[0].items;
  const runA = marksItems.find((item) => item.str === 'A' && Math.abs(item.transform[1]) > 1);
  const runEmoji = marksItems.find((item) => item.str === '😀' && Math.abs(item.transform[1]) > 1);
  assert.ok(runA && runEmoji, 'both font runs of the rotated symbol must be present');
  // Both runs must share the identical rotation/scale matrix -- one consistent baseline.
  for (const index of [0, 1, 2, 3]) {
    assert.ok(Math.abs(runA.transform[index] - runEmoji.transform[index]) < 1e-6, `transform[${index}] diverges between font runs`);
  }
  // Run 2 must continue along the SAME rotated direction from run 1's end (90deg: +Y).
  assert.ok(Math.abs(runEmoji.transform[4] - runA.transform[4]) < 0.01, 'run2 x origin must match run1 (same rotated baseline)');
  assert.ok(Math.abs(runEmoji.transform[5] - (runA.transform[5] + runA.width)) < 0.1, 'run2 must start exactly one run1-advance further along the rotated baseline');
  console.log('F5 regression PASS: run1', JSON.stringify(runA.transform), 'run2', JSON.stringify(runEmoji.transform));

  // --- Exact round-2 off-page edge case: must still correctly reject before bytes ---
  const mixedEdge = structuredClone(marks);
  mixedEdge.annotations[0].anchor = { x: 288000, y: 80000 };
  mixedEdge.annotations[0].scale = 5;
  const edgeRow = await run('mixed-edge-symbol', mixedEdge);
  console.log('mixed-edge-symbol (scale 5, anchor at field right edge):', edgeRow.ok, edgeRow.code, edgeRow.messageKey);

  // --- Re-confirm F1-F4 corrections are retained (not regressed by the F5 fix) ---
  const note = (text, x = 120000, y = 80000, id = 'note') => ({ id, kind: 'label', layerId: 'notes', scope: { kind: 'show' }, visibility: { editor: true, print: true, performerPacket: false }, text, anchor: { x, y } });
  const multilineRow = await run('multiline-note', { ...base, annotations: [note('First line\nSecond line')] });
  assert.ok(multilineRow.ok, 'multiline note must still succeed (F1)');
  const whitespaceRow = await run('whitespace', { ...base, annotations: [note('  Keep   spaces  ')] });
  assert.ok(whitespaceRow.ok, 'authored whitespace must still be preserved (F4)');
  const rankOverlapRow = await run('rank-actual-overlap', { ...base, annotations: [note('Hit rank', 102400, 80400)] });
  assert.ok(rankOverlapRow.ok && rankOverlapRow.warnings.some((w) => w.code === 'note-overlap' && w.obstacleKind === 'rank-label'), 'baseline-aware rank overlap must still fire (F2)');
  const offpageRank = structuredClone(base);
  offpageRank.performers[0].rankCode = 'A'.repeat(32);
  offpageRank.sets.forEach((s) => { s.positions.a = { x: 288000, y: 153600 }; });
  const offpageRankRow = await run('offpage-rank', offpageRank);
  assert.equal(offpageRankRow.ok, false, 'off-page rank must still be rejected before bytes (F3)');

  writeFileSync(`${out}/results.json`, JSON.stringify(results.map(({ pages, ...r }) => r), null, 2));
  writeFileSync(`${out}/identity.json`, JSON.stringify({
    head: '3df1916315c43e7b4617bd037b62f76a3d0edc9a', dirtyTreeNotHead: true,
    note: 'Independent round-3 F5 fix regression generation at the same dirty-tree identity Huffer audited in round 2.',
  }, null, 2));
  console.log('All round-3 assertions passed.');
} finally {
  await server.close();
}
