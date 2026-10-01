import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCommandStore } from '../document/command-store';
import type { FreeformDocument } from '../document/types';
import { decodeDocument, encodeDocument, FreeformFileError, importIntoStore, validateCurrentDocument } from './freeform-file';
import { type SaveFileHandle, saveExplicitSnapshot } from './save-adapter';

function documentWithM6Data(): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'show-1', title: 'A Show', totalCounts: 16 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A1', displayName: 'A' }, { id: 'b', rankCode: 'B1', displayName: 'B' }],
    sets: [
      { id: 'set-1', name: 'One', startCount: 0, positions: { a: { x: 100, y: 100 }, b: { x: 200, y: 100 } } },
      { id: 'set-2', name: 'Two', startCount: 16, positions: { a: { x: 1100, y: 100 }, b: { x: 1200, y: 100 } } },
    ],
    transitions: [{ id: 'move-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float', collisionOverrides: [{ performerIds: ['a', 'b'], warningSignature: `v1-sha256-${'a'.repeat(64)}`, reason: 'Spacing checked', overriddenAt: '2026-10-01T12:00:00Z', authorLabel: 'Director' }] }],
    layers: [{ id: 'notes', name: 'Notes', visible: true, print: true, locked: false }],
    symbols: [{ id: 'star', name: 'Star', glyph: 'M0 0' }],
    annotations: [{ id: 'symbol-1', kind: 'symbol', layerId: 'notes', scope: { kind: 'transition', transitionId: 'move-1' }, visibility: { editor: true, print: true, performerPacket: false }, symbolId: 'star', anchor: { x: 100, y: 100 }, rotationDegrees: 45, scale: 1.5 }],
    extensions: { 'org.example.freeform': { retained: ['exactly', 'as-is'] } },
  };
}

function bytes(value: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(value)); }

/** Runs the published Draft 2020-12 schema through its real, docs-scoped Ajv
 * validator. This is test-only: browser code remains dependency-free. */
function schemaAccepts(value: unknown): boolean {
  const directory = mkdtempSync(join(tmpdir(), 'freeform-schema-parity-'));
  const documentPath = join(directory, 'candidate.freeform');
  try {
    writeFileSync(documentPath, JSON.stringify(value), 'utf8');
    const result = spawnSync(process.execPath, [
      join(process.cwd(), 'docs', 'ajv_validate.mjs'),
      join(process.cwd(), 'docs', 'freeform-1.0.schema.json'),
      documentPath,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    return (JSON.parse(result.stdout) as { valid: boolean }).valid;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writableHandle(permission: PermissionState = 'granted'): { handle: SaveFileHandle; written: Uint8Array[]; closed: boolean } {
  const written: Uint8Array[] = [];
  let closed = false;
  return {
    handle: {
      queryPermission: async () => permission,
      requestPermission: async () => permission,
      createWritable: async () => ({ write: async (data) => { written.push(data); }, close: async () => { closed = true; } }),
    },
    written,
    get closed() { return closed; },
  };
}

describe('Freeform file codec and validation', () => {
  it('round-trips all current M5/M6 fields and extensions as UTF-8 JSON', () => {
    const source = documentWithM6Data();
    const encoded = encodeDocument(source);
    const decoded = decodeDocument(encoded);
    expect(decoded.kind).toBe('editable');
    if (decoded.kind === 'editable') {
      expect(decoded.document).toEqual(source);
      expect(decoded.originalBytes).toEqual(encoded);
    }
  });

  it('preserves optional symbol transforms when either or both are absent', () => {
    const source = documentWithM6Data();
    const annotation = source.annotations[0]! as Extract<FreeformDocument['annotations'][number], { kind: 'symbol' }>;
    const { rotationDegrees, scale, ...withoutTransforms } = annotation;
    const { rotationDegrees: ignoredRotation, ...withoutRotation } = annotation;
    const { scale: ignoredScale, ...withoutScale } = annotation;
    const variants = [
      withoutTransforms,
      withoutScale,
      withoutRotation,
      annotation,
    ];

    for (const variant of variants) {
      const document = { ...source, annotations: [variant] } as FreeformDocument;
      expect(schemaAccepts(document)).toBe(true);
      const decoded = decodeDocument(encodeDocument(document));
      expect(decoded).toMatchObject({ kind: 'editable', document });
    }
    for (const invalid of [
      { ...annotation, rotationDegrees: 360 },
      { ...annotation, scale: 0 },
    ]) {
      expect(schemaAccepts({ ...source, annotations: [invalid] })).toBe(false);
      expect(() => encodeDocument({ ...source, annotations: [invalid] } as FreeformDocument)).toThrow(FreeformFileError);
      expect(() => decodeDocument(bytes({ ...source, annotations: [invalid] }))).toThrow(FreeformFileError);
    }
  });

  it('measures schema strings in Unicode code points and validates calendar-aware RFC3339 dates', () => {
    const source = documentWithM6Data();
    const symbolAnnotation = source.annotations[0]! as Extract<FreeformDocument['annotations'][number], { kind: 'symbol' }>;
    const { symbolId, rotationDegrees, scale, ...labelBase } = symbolAnnotation;
    const boundary = '\ud83d\ude00'.repeat(200);
    const stringCases: Array<{ readonly document: FreeformDocument; readonly valid: boolean }> = [
      { document: { ...source, show: { ...source.show, title: boundary } }, valid: true },
      { document: { ...source, show: { ...source.show, title: `${boundary}\ud83d\ude00` } }, valid: false },
      { document: { ...source, performers: [{ ...source.performers[0]!, displayName: '\ud83d\ude00'.repeat(120) }, source.performers[1]! ] }, valid: true },
      { document: { ...source, performers: [{ ...source.performers[0]!, section: '\ud83d\ude00'.repeat(80), notes: '\ud83d\ude00'.repeat(10000) }, source.performers[1]! ] }, valid: true },
      { document: { ...source, sets: [{ ...source.sets[0]!, name: '\ud83d\ude00'.repeat(120) }, source.sets[1]! ] }, valid: true },
      { document: { ...source, symbols: [{ ...source.symbols![0]!, name: '\ud83d\ude00'.repeat(120) }] }, valid: true },
      { document: { ...source, symbols: [{ ...source.symbols![0]!, glyph: '\ud83d\ude00'.repeat(8000) }] }, valid: true },
      { document: { ...source, annotations: [{ ...labelBase, kind: 'label', text: '\ud83d\ude00'.repeat(10000), anchor: { x: 100, y: 100 } }] } as FreeformDocument, valid: true },
    ];
    for (const { document, valid } of stringCases) {
      expect(schemaAccepts(document)).toBe(valid);
      if (valid) expect(() => encodeDocument(document)).not.toThrow();
      else expect(() => encodeDocument(document)).toThrow(FreeformFileError);
    }

    for (const createdAt of ['2024-02-29T23:59:59Z', '2024-02-29t23:59:59.123456+05:30', '2024-02-29 23:59:60Z']) {
      const document = { ...source, show: { ...source.show, createdAt } };
      expect(schemaAccepts(document)).toBe(true);
      expect(() => encodeDocument(document)).not.toThrow();
    }
    for (const createdAt of ['2026-02-30T12:00:00Z', '2023-02-29T12:00:00Z', '2024-04-31T12:00:00Z', '2024-02-29T24:00:00Z', '2024-02-29T12:58:60Z']) {
      const document = { ...source, show: { ...source.show, createdAt } };
      expect(schemaAccepts(document)).toBe(false);
      expect(() => encodeDocument(document)).toThrow(FreeformFileError);
    }
  });

  it('rejects structural and semantic corruption without repairing it', () => {
    const unknownRoot = { ...documentWithM6Data(), surprise: true };
    expect(() => validateCurrentDocument(unknownRoot)).toThrow(FreeformFileError);
    const duplicateRank = {
      ...documentWithM6Data(),
      performers: [{ ...documentWithM6Data().performers[0]!, rankCode: 'A1' }, { ...documentWithM6Data().performers[1]!, rankCode: 'a1' }],
    };
    expect(() => encodeDocument(duplicateRank)).toThrow(/rank codes/i);
    const unknownSymbol = {
      ...documentWithM6Data(),
      annotations: [{ ...documentWithM6Data().annotations[0]!, symbolId: 'missing' }],
    };
    expect(() => encodeDocument(unknownSymbol)).toThrow(/unknown symbol/i);
    expect(() => decodeDocument(new Uint8Array([0xff, 0xfe]))).toThrow(/UTF-8 JSON/i);
  });

  it('does not persist a stale FTL draft after a roster removal', () => {
    const source = documentWithM6Data();
    const stale = {
      ...source,
      performers: [source.performers[0]!],
      sets: source.sets.map((set) => ({ ...set, positions: { a: set.positions.a! } })),
      transitions: [{
        ...source.transitions[0]!, mode: 'ftl' as const, collisionOverrides: undefined,
        ftl: { leaderId: 'a', followerIds: ['b'], offsetUnits: { a: 0, b: 100 }, distanceUnits: 1000, path: [{ x: 100, y: 100 }, { x: 1200, y: 100 }] },
      }],
    };
    expect(() => encodeDocument(stale)).toThrow(/FTL|formation member/i);
  });

  it('makes invalid imports atomic for document state and history', () => {
    const store = createCommandStore(documentWithM6Data());
    store.apply({ type: 'show.title.set', title: 'Saved working state' });
    const before = store.undo()!;
    const history = store.getUndoCommands();
    const malformed = [
      { ...documentWithM6Data(), formatVersion: 'not-a-version' },
      { ...documentWithM6Data(), extra: true },
    ];
    for (const document of malformed) expect(() => importIntoStore(store, bytes(document))).toThrow(FreeformFileError);
    expect(store.getState()).toBe(before);
    expect(store.getState().revision).toBe(before.revision);
    expect(store.getUndoCommands()).toEqual(history);
    expect(store.canRedo()).toBe(true);
    expect(store.redo()?.document.show.title).toBe('Saved working state');
  });

  it('opens future-major bytes read-only without attempting schema validation or migration', () => {
    const future = { format: 'freeform', formatVersion: '2.0.0' };
    const original = bytes(future);
    expect(decodeDocument(original)).toMatchObject({ kind: 'read-only-future-major', originalBytes: original, formatVersion: '2.0.0' });
    expect(() => decodeDocument(bytes({ ...documentWithM6Data(), formatVersion: '1.1.0' }))).toThrow(/no defined defaultable migration/i);
  });
});

describe('explicit save adapters', () => {
  it('writes only to a permission-granted active handle and reports success after close', async () => {
    const target = writableHandle();
    const result = await saveExplicitSnapshot(documentWithM6Data(), { operation: 'save', title: 'A Show', activeHandle: target.handle }, {});
    expect(result).toMatchObject({ ok: true, method: 'file-system-access', filename: 'A Show.freeform' });
    expect(target.written).toHaveLength(1);
    expect(new TextDecoder().decode(target.written[0])).toContain('symbol-1');
    expect(target.closed).toBe(true);
  });

  it('does not write or claim success when permission is denied, picker is cancelled, or write fails', async () => {
    const denied = writableHandle('denied');
    await expect(saveExplicitSnapshot(documentWithM6Data(), { operation: 'save', title: 'A Show', activeHandle: denied.handle }, {})).resolves.toMatchObject({ ok: false, reason: 'permission-denied' });
    expect(denied.written).toHaveLength(0);
    await expect(saveExplicitSnapshot(documentWithM6Data(), { operation: 'save-as', title: 'A Show' }, { showSaveFilePicker: async () => { throw new DOMException('cancel', 'AbortError'); } })).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
    const failed: SaveFileHandle = { queryPermission: async () => 'granted', createWritable: async () => { throw new Error('disk full'); } };
    await expect(saveExplicitSnapshot(documentWithM6Data(), { operation: 'save', title: 'A Show', activeHandle: failed }, {})).resolves.toMatchObject({ ok: false, reason: 'write-failed' });
  });

  it('uses a newly named UTF-8 download when File System Access is unavailable', async () => {
    let exported: Uint8Array | undefined;
    const result = await saveExplicitSnapshot(documentWithM6Data(), { operation: 'save-as', title: '  Fall: Show  ' }, { download: (data, filename) => { exported = data; expect(filename).toBe('Fall- Show.freeform'); } });
    expect(result).toMatchObject({ ok: true, method: 'download' });
    expect(new TextDecoder().decode(exported)).toContain('org.example.freeform');
  });
});
