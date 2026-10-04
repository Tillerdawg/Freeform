import { readdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const dir='evidence/m8-ui/huffer-review/round2/downloads';const results=[];
for(const name of await readdir(dir)){if(!name.endsWith('.pdf'))continue;const bytes=await readFile(dir+'/'+name);const pdf=await getDocument({data:new Uint8Array(bytes),disableFontFace:true}).promise;const pages=[];for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);pages.push({view:p.view,text:(await p.getTextContent()).items.map(x=>x.str).join(' ')});}results.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),pages});await pdf.destroy();}
await writeFile('evidence/m8-ui/huffer-review/round2/pdf-inspection.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
if(results.length<2)throw new Error('Expected director and packet downloads');
