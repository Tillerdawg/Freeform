import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const directory = 'evidence/m8-ui/wheeljack-round3/downloads';
const results = [];
for (const name of await readdir(directory)) {
  if (!name.endsWith('.pdf')) continue;
  const bytes = await readFile(`${directory}/${name}`);
  const pdf = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    pages.push({
      view: page.view,
      text: (await page.getTextContent()).items.map((item) => item.str).join(' '),
    });
  }
  results.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'), pages });
  await pdf.destroy();
}
await writeFile('evidence/m8-ui/wheeljack-round3/pdf-inspection.json', `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
if (results.length === 0) throw new Error('No actual application PDF download was found.');
