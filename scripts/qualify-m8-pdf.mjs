import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [inputPath = 'evidence/m8-pdf-foundation/same-runtime-a.pdf', outputDirectory = 'evidence/m8-pdf-foundation'] = process.argv.slice(2);
const input = new Uint8Array(readFileSync(inputPath));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
// pdfjs may transfer/detach the supplied ArrayBuffer. Hash before passing it in.
const inputSha256 = sha256(input);
const structureMarkers = {
  hasStructTreeRoot: Buffer.from(input).includes(Buffer.from('/StructTreeRoot')),
  hasMarkInfo: Buffer.from(input).includes(Buffer.from('/MarkInfo')),
};
const document = await getDocument({ data: input }).promise;
const metadata = await document.getMetadata();
const pageSizes = [];
const extractedPages = [];

mkdirSync(outputDirectory, { recursive: true });
for (let index = 1; index <= document.numPages; index += 1) {
  const page = await document.getPage(index);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const canvasPath = join(outputDirectory, `pdfjs-canvas-page-${index}.png`);
  writeFileSync(canvasPath, canvas.toBuffer('image/png'));
  pageSizes.push({ width: viewport.width / 2, height: viewport.height / 2 });
  extractedPages.push((await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(''));
}
writeFileSync(join(outputDirectory, 'extracted-page-1.txt'), extractedPages[0] ?? '');

const ghostscript = spawnSync('gs', [
  '-q', '-dSAFER', '-sDEVICE=pngalpha', '-r144',
  `-sOutputFile=${join(outputDirectory, 'page-%d.png')}`,
  '-dBATCH', '-dNOPAUSE', inputPath,
], { encoding: 'utf8' });
if (ghostscript.status !== 0) {
  throw new Error(`Ghostscript render failed with exit ${ghostscript.status}: ${ghostscript.stderr}`);
}
const gsVersion = spawnSync('gs', ['--version'], { encoding: 'utf8' });
if (gsVersion.status !== 0) {
  throw new Error(`Ghostscript version lookup failed with exit ${gsVersion.status}: ${gsVersion.stderr}`);
}

const fontDirectory = 'src/pdf/assets';
const fontFiles = readdirSync(fontDirectory)
  .filter((name) => /\.(ttf|woff)$/u.test(name))
  .sort()
  .map((name) => {
    const path = join(fontDirectory, name);
    const bytes = readFileSync(path);
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
  });
const bundleFiles = existsSync('dist/assets')
  ? readdirSync('dist/assets').filter((name) => name.endsWith('.js')).sort().map((name) => {
    const path = join('dist/assets', name);
    return { path, bytes: statSync(path).size };
  })
  : [];
const determinismFiles = [
  'same-runtime-a.pdf',
  'same-runtime-b.pdf',
  'fresh-runtime-a.pdf',
  'fresh-runtime-b.pdf',
].map((name) => join(outputDirectory, name));
const determinism = determinismFiles.every(existsSync)
  ? Object.fromEntries(determinismFiles.map((path) => [basename(path), sha256(readFileSync(path))]))
  : null;

const result = {
  input: inputPath,
  writer: 'pdf-lib@1.17.1 + @pdf-lib/fontkit@1.1.1',
  extractorAndCanvasRenderer: `pdfjs-dist@${pdfjsVersion} + @napi-rs/canvas@0.1.100`,
  ghostscriptRenderer: gsVersion.stdout.trim(),
  sha256: inputSha256,
  pageCount: document.numPages,
  pageSizePoints: pageSizes,
  language: metadata.info.Language ?? null,
  fixedMetadata: {
    Creator: metadata.info.Creator ?? null,
    Producer: metadata.info.Producer ?? null,
    CreationDate: metadata.info.CreationDate ?? null,
    ModDate: metadata.info.ModDate ?? null,
  },
  byteDeterminism: determinism === null ? null : {
    hashes: determinism,
    sameRuntimeIdentical: determinism['same-runtime-a.pdf'] === determinism['same-runtime-b.pdf'],
    freshRuntimeIdentical: determinism['fresh-runtime-a.pdf'] === determinism['fresh-runtime-b.pdf'],
    allFourIdentical: new Set(Object.values(determinism)).size === 1,
  },
  extractedPageOne: extractedPages[0] ?? '',
  extractedContains: ['Café', 'é', 'Русский', '😀'].map((text) => [text, (extractedPages[0] ?? '').includes(text)]),
  renderedGlyphEvidence: {
    ghostscript: 'page-1.png through page-N.png',
    pdfjsCanvas: 'pdfjs-canvas-page-1.png through pdfjs-canvas-page-N.png',
    manualReviewRequired: 'Inspect retained renderer outputs for visible glyphs; extraction alone is not sufficient.',
  },
  fontFiles,
  bundleMetrics: {
    builtMainJs: bundleFiles,
    bundledPdfExportChunkPresent: bundleFiles.some(({ path }) => /pdf/u.test(basename(path))),
    qualificationFontAssetBytes: fontFiles.reduce((total, font) => total + font.bytes, 0),
    note: 'M8.1 does not wire UI-triggered dynamic import; production lazy chunk integration is intentionally deferred to M8.4. These are measured current-build and asset metrics, not a claim that export code is reachable in the application.',
  },
  tagging: {
    status: 'unresolved-capability-blocker',
    reason: 'No PDF/UA tagging checker is installed in this workspace, and M8.1 prohibits global/system installs. No tagged or fully accessible claim is made.',
    rawPdfStructureMarkers: structureMarkers,
  },
};
writeFileSync(join(outputDirectory, 'qualification.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
