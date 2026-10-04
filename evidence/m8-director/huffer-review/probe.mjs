import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const out='evidence/m8-director/huffer-review';mkdirSync(out,{recursive:true});
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
const {buildPdfExport}=await server.ssrLoadModule('/src/pdf/pdf-export.ts');
const assets={fonts:['noto-sans-latin-400.woff','noto-sans-cyrillic-400.woff','noto-emoji-400.ttf'].map((n,i)=>{const bytes=new Uint8Array(readFileSync('src/pdf/assets/'+n));return {id:n,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),subset:i!==2};})};
const base={format:'freeform',formatVersion:'1.0.0',show:{id:'show-1',title:'Café Русский é 😀',totalCounts:16},field:{preset:'NFHS_11_PLAYER',unitsPerYard:2880,lengthUnits:288000,widthUnits:153600,frontHashY:51200,backHashY:102400},settings:{collisionThresholdUnits:2880},performers:[{id:'a',rankCode:'A',displayName:'A'}],sets:[{id:'set-1',name:'Set 1',startCount:0,positions:{a:{x:100000,y:80000}}},{id:'set-2',name:'Set 2',startCount:16,positions:{a:{x:120000,y:90000}}}],transitions:[{id:'move-1',fromSetId:'set-1',toSetId:'set-2',counts:16,mode:'float'}],layers:[{id:'notes',name:'Notes',visible:true,print:true,locked:false}],annotations:[]};
const req={kind:'director',scope:{kind:'full-show'},transitionFrames:[]};const results=[];
const note=(text,x=120000,y=80000)=>({id:'note',kind:'label',layerId:'notes',scope:{kind:'show'},visibility:{editor:true,print:true,performerPacket:false},text,anchor:{x,y}});
async function run(name,d,r=req){const before=JSON.stringify(d);const result=await buildPdfExport(d,r,assets);const row={name,ok:result.ok,code:result.code,messageKey:result.messageKey,unchanged:before===JSON.stringify(d)};if(result.ok){writeFileSync(`${out}/${name}.pdf`,result.bytes);writeFileSync(`${out}/${name}.manifest.json`,JSON.stringify(result.manifest,null,2));row.sha256=createHash('sha256').update(result.bytes).digest('hex');row.warnings=result.warnings;const pdf=await getDocument({data:new Uint8Array(result.bytes)}).promise;row.pages=[];for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);const t=await p.getTextContent();row.pages.push({view:p.view,items:t.items.filter(x=>'str'in x).map(x=>({str:x.str,transform:x.transform,width:x.width,height:x.height})),operatorCount:(await p.getOperatorList()).fnArray.length});}await pdf.destroy();}results.push(row);return row;}
await run('static',base);await run('static-repeat',base);
await run('float',base,{...req,transitionFrames:[{transitionId:'move-1',counts:[16,0,8]}]});
await run('multiline-note',{...base,annotations:[note('First line\nSecond line')]});
await run('multiline-title',{...base,show:{...base.show,title:'First line\nSecond line'}});
await run('long-note',{...base,annotations:[note('word '.repeat(300))]});
await run('rank-actual-overlap',{...base,annotations:[note('Hit rank',102400,80400)]});
await run('rank-false-overlap',{...base,annotations:[note('Below rank',102400,68400)]});
await run('edge-touch',{...base,annotations:[note('Edge',101600,80000)]});
await run('whitespace',{...base,annotations:[note('  Keep   spaces  ')]});
const edge=structuredClone(base);edge.performers[0].rankCode='A'.repeat(32);edge.sets.forEach(s=>s.positions.a={x:288000,y:153600});await run('offpage-rank',edge);
for(let i=0;i<16;i++){const d=structuredClone(base);d.layers[0].visible=!!(i&1);d.layers[0].print=!!(i&2);d.annotations=[note('FLAG'+i)];d.annotations[0].visibility.editor=!!(i&4);d.annotations[0].visibility.print=!!(i&8);await run('flags-'+i,d);}
const ftl=JSON.parse(readFileSync('docs/fixtures/positive/ftl-path-non-horizontal.freeform'));await run('ftl',ftl,{...req,transitionFrames:[{transitionId:ftl.transitions[0].id,counts:[0,Math.floor(ftl.transitions[0].counts/2),ftl.transitions[0].counts]}]});
writeFileSync(`${out}/results-${process.argv[2]??'a'}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({pages,...r})=>r),null,2));
}finally{await server.close();}
