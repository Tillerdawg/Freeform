import {createServer} from 'vite';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const out='evidence/m8-packet/huffer-review/round1';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
const results=[];
try {
const {buildPdfExport}=await server.ssrLoadModule('/src/pdf/pdf-export.ts');
const {validateCurrentDocument}=await server.ssrLoadModule('/src/persistence/freeform-file.ts');
const assets={fonts:[['noto-latin','noto-sans-latin-400.woff',true],['noto-cyrillic','noto-sans-cyrillic-400.woff',true],['noto-emoji','noto-emoji-400.ttf',false]].map(([id,file,subset])=>{const bytes=new Uint8Array(readFileSync('src/pdf/assets/'+file));return {id,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),subset,sourceUrl:'https://fontsource.org/',license:'OFL-1.1'};})};
const base={format:'freeform',formatVersion:'1.0.0',show:{id:'review-show',title:'Fresh packet review',totalCounts:64},field:{preset:'NFHS_11_PLAYER',unitsPerYard:2880,lengthUnits:288000,widthUnits:153600,frontHashY:51200,backHashY:102400},settings:{collisionThresholdUnits:2880},performers:[{id:'a',rankCode:'A',displayName:'Alpha',notes:'ONCE ONLY'},{id:'b',rankCode:'B',displayName:'Beta'}],sets:Array.from({length:5},(_,i)=>({id:'s'+i,name:'Fresh '+i,startCount:i*16,positions:{a:{x:i*14400,y:0},b:{x:144000,y:76800}}})),transitions:[{id:'float-0',fromSetId:'s0',toSetId:'s1',counts:16,mode:'float',notes:'TRANSITION SENTINEL'}],annotations:[]};
const req={kind:'performer-packet',performerIds:['b','a'],scope:{kind:'full-show'}};
async function run(name,d,r=req){const before=JSON.stringify(d);let valid=true;try{validateCurrentDocument(d);}catch(e){valid=String(e);}const result=await buildPdfExport(d,r,assets);const report={name,valid,immutable:before===JSON.stringify(d),ok:result.ok};if(!result.ok)Object.assign(report,result);else{writeFileSync(out+'/'+name+'.pdf',result.bytes);writeFileSync(out+'/'+name+'.manifest.json',JSON.stringify({manifest:result.manifest,warnings:result.warnings},null,2));const pdf=await getDocument({data:result.bytes.slice()}).promise;report.pages=[];for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const items=(await page.getTextContent()).items.filter(x=>'str' in x);report.pages.push({size:page.view,text:items.map(x=>x.str).join(' '),minTextY:Math.min(...items.map(x=>x.transform[5]))});}report.warnings=result.warnings;report.sha256=createHash('sha256').update(result.bytes).digest('hex');}results.push(report);return report;}
await run('multipage',base);
const overlap=structuredClone(base);overlap.layers=[{id:'layer',name:'Hidden',visible:false,print:false,locked:false}];overlap.annotations=[{id:'a-show',kind:'performerNote',layerId:'layer',performerId:'a',scope:{kind:'show'},visibility:{editor:false,print:false,performerPacket:true},text:'A PRIVATE',anchor:{x:0,y:0}},{id:'b-only',kind:'performerNote',layerId:'layer',performerId:'b',scope:{kind:'set',setId:'s0'},visibility:{editor:false,print:false,performerPacket:true},text:'B PRIVATE',anchor:{x:200000,y:90000}}];await run('scope-overlap',overlap);overlap.annotations[0].anchor={x:200000,y:90000};await run('scope-no-overlap',overlap);
const long=structuredClone(base);long.performers[0].notes=Array.from({length:44},(_,i)=>'Identity line '+i).join('\n');await run('long-identity',long,{...req,performerIds:['a'],scope:{kind:'inclusive-set-range',firstSetId:'s0',lastSetId:'s0'}});
const ftl=JSON.parse(readFileSync('docs/fixtures/positive/ftl-path-non-horizontal.freeform','utf8'));ftl.transitions[0].notes='FTL NOTE SENTINEL';await run('ftl-member',ftl,{...req,performerIds:['e']});ftl.performers.push({id:'outsider',rankCode:'Z',displayName:'Not in formation'});for(const set of ftl.sets)set.positions.outsider={x:0,y:0};await run('ftl-outsider',ftl,{...req,performerIds:['outsider']});
const chrome=structuredClone(base);chrome.sets[0].name='W'.repeat(120);await run('chrome-overflow',chrome);
const note=structuredClone(base);note.performers[0].notes='W'.repeat(1000);await run('note-overflow',note);
writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await server.close();}
