import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import assert from 'node:assert/strict';
const out='evidence/m8-director/huffer-review/round2';mkdirSync(out,{recursive:true});
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
const {buildPdfExport}=await server.ssrLoadModule('/src/pdf/pdf-export.ts');
const {selectAnnotations}=await server.ssrLoadModule('/src/document/annotations.ts');
const assets={fonts:['noto-sans-latin-400.woff','noto-sans-cyrillic-400.woff','noto-emoji-400.ttf'].map((n,i)=>{const bytes=new Uint8Array(readFileSync('src/pdf/assets/'+n));return {id:n,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),subset:i!==2};})};
const base={format:'freeform',formatVersion:'1.0.0',show:{id:'show-1',title:'Café Русский é 😀',totalCounts:16},field:{preset:'NFHS_11_PLAYER',unitsPerYard:2880,lengthUnits:288000,widthUnits:153600,frontHashY:51200,backHashY:102400},settings:{collisionThresholdUnits:2880},performers:[{id:'a',rankCode:'A',displayName:'A'}],sets:[{id:'set-1',name:'Set 1',startCount:0,positions:{a:{x:100000,y:80000}}},{id:'set-2',name:'Set 2',startCount:16,positions:{a:{x:120000,y:90000}}}],transitions:[{id:'move-1',fromSetId:'set-1',toSetId:'set-2',counts:16,mode:'float'}],layers:[{id:'notes',name:'Notes',visible:true,print:true,locked:false}],annotations:[]};
const req={kind:'director',scope:{kind:'full-show'},transitionFrames:[]};const results=[];
const note=(text,x=120000,y=80000,id='note')=>({id,kind:'label',layerId:'notes',scope:{kind:'show'},visibility:{editor:true,print:true,performerPacket:false},text,anchor:{x,y}});
async function run(name,d,r=req){const before=JSON.stringify(d);const result=await buildPdfExport(d,r,assets);assert.equal(before,JSON.stringify(d));const row={name,ok:result.ok,code:result.code,messageKey:result.messageKey,unchanged:true};if(result.ok){writeFileSync(`${out}/${name}.pdf`,result.bytes);writeFileSync(`${out}/${name}.manifest.json`,JSON.stringify(result.manifest,null,2));row.sha256=createHash('sha256').update(result.bytes).digest('hex');row.warnings=result.warnings;row.contexts=result.manifest.pages.map(p=>p.context);const pdf=await getDocument({data:new Uint8Array(result.bytes)}).promise;row.pages=[];for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);const t=await p.getTextContent();assert.deepEqual(p.view,[0,0,792,612]);assert.deepEqual(result.manifest.pages[i-1].annotationIds,selectAnnotations(d,{audience:'director-print',context:result.manifest.pages[i-1].context}).map(a=>a.id));const ops=await p.getOperatorList();row.pages.push({view:p.view,items:t.items.filter(x=>'str'in x).map(x=>({str:x.str,transform:x.transform,width:x.width,height:x.height})),operators:ops.fnArray,operatorArgs:ops.argsArray});}await pdf.destroy();}else assert.equal('bytes'in result,false);results.push(row);return row;}
await run('static',base);await run('static-repeat',base);
await run('float',base,{...req,transitionFrames:[{transitionId:'move-1',counts:[16,0,8]}]});
for(const [name,text] of [['multiline-note','First line\nSecond line'],['crlf-note','First line\r\nSecond line'],['whitespace','  Keep   spaces  '],['long-note','word '.repeat(300)]])await run(name,{...base,annotations:[note(text)]});
await run('multiline-title',{...base,show:{...base.show,title:'First line\nSecond line'}});
await run('long-title',{...base,show:{...base.show,title:'Title\n'.repeat(20)}});
await run('rank-actual-overlap',{...base,annotations:[note('Hit rank',102400,80400)]});
await run('rank-false-overlap',{...base,annotations:[note('Below rank',102400,68400)]});
await run('rank-edge-touch',{...base,annotations:[note('Edge',102400,72000)]});
const edge=structuredClone(base);edge.performers[0].rankCode='A'.repeat(32);edge.sets.forEach(s=>s.positions.a={x:288000,y:153600});await run('offpage-rank',edge);
for(let i=0;i<16;i++){const d=structuredClone(base);d.layers[0].visible=!!(i&1);d.layers[0].print=!!(i&2);d.annotations=[note('FLAG'+i)];d.annotations[0].visibility.editor=!!(i&4);d.annotations[0].visibility.print=!!(i&8);const row=await run('flags-'+i,d);assert.equal(row.ok,true);assert.equal(row.pages[0].items.map(x=>x.str).join('').includes('FLAG'+i),!!(i&2)&&!!(i&8));}
const ftl=JSON.parse(readFileSync('docs/fixtures/positive/ftl-path-non-horizontal.freeform'));await run('ftl',ftl,{...req,transitionFrames:[{transitionId:ftl.transitions[0].id,counts:[0,Math.floor(ftl.transitions[0].counts/2),ftl.transitions[0].counts]}]});
const three=structuredClone(base);three.show.totalCounts=32;three.sets.push({id:'set-3',name:'Set 3',startCount:32,positions:{a:{x:140000,y:100000}}});three.transitions.push({id:'move-2',fromSetId:'set-2',toSetId:'set-3',counts:16,mode:'float'});
await run('range',three,{...req,scope:{kind:'inclusive-set-range',firstSetId:'set-1',lastSetId:'set-2'},transitionFrames:[{transitionId:'move-1',counts:[16,0,8]}]});
await run('range-reversed',three,{...req,scope:{kind:'inclusive-set-range',firstSetId:'set-2',lastSetId:'set-1'}});
await run('range-outside',three,{...req,scope:{kind:'inclusive-set-range',firstSetId:'set-1',lastSetId:'set-2'},transitionFrames:[{transitionId:'move-2',counts:[0]}]});
await run('transitionless-multi',{...three,transitions:[]});await run('transitionless-single',{...base,sets:base.sets.slice(0,1),transitions:[]});
const marks=structuredClone(base);marks.layers.push({id:'top',name:'Top',visible:false,print:true,locked:false});marks.symbols=[{id:'mixed',name:'Mixed',glyph:'A😀'}];
marks.annotations=[note('TOP LAYER',160000,100000,'top-note'),note('SHOW MARK',160000,80000,'show-note'),{...note('SET ONLY',160000,60000,'set-note'),scope:{kind:'set',setId:'set-1'}},{...note('TRANSITION ONLY',160000,40000,'transition-note'),scope:{kind:'transition',transitionId:'move-1'}},{...note('PERFORMER NOTE',80000,40000,'performer-note'),kind:'performerNote',performerId:'a'},{id:'line',kind:'freehand',layerId:'notes',scope:{kind:'show'},visibility:{editor:true,print:true,performerPacket:false},strokes:[[{x:10000,y:10000},{x:20000,y:30000}]]},{id:'arrow',kind:'arrow',layerId:'notes',scope:{kind:'show'},visibility:{editor:true,print:true,performerPacket:false},points:[{x:30000,y:10000},{x:40000,y:30000}]},{id:'symbol',kind:'symbol',layerId:'notes',scope:{kind:'show'},visibility:{editor:true,print:true,performerPacket:false},symbolId:'mixed',anchor:{x:80000,y:110000},rotationDegrees:90,scale:1.5}];marks.annotations[0].layerId='top';await run('all-marks',marks,{...req,transitionFrames:[{transitionId:'move-1',counts:[0,16]}]});
const mixedEdge=structuredClone(marks);mixedEdge.annotations=mixedEdge.annotations.filter(a=>a.kind==='symbol');mixedEdge.annotations[0].anchor={x:288000,y:80000};mixedEdge.annotations[0].scale=5;await run('mixed-edge-symbol',mixedEdge);
for(const rank of ['é','AV','ffi']){const d=structuredClone(base);d.performers[0].rankCode=rank;d.annotations=[note('Rank',102400,80400)];await run('shaped-rank-'+(rank==='é'?'combining':rank),d);}
const beforeD={...base,annotations:[note('First',100000,80000,'z-note'),note('Second',100000,80000,'a-note')]};await run('overlap-before',beforeD);const moved=structuredClone(beforeD);moved.annotations[0].anchor={x:200000,y:100000};await run('overlap-after',moved);
await run('excluded-glyph',{...base,annotations:[{...note('\u{10ffff}'),visibility:{editor:true,print:false,performerPacket:false}}]});
await run('included-glyph',{...base,annotations:[note('\u{10ffff}')]});
const {createCommandStore}=await server.ssrLoadModule('/src/document/command-store.ts');
const {observeCommandStore}=await server.ssrLoadModule('/src/persistence/command-store-bridge.ts');
const store=createCommandStore(beforeD);const writes=[];const observed=observeCommandStore(store,e=>writes.push(e));const state=observed.getState();
await buildPdfExport(state.document,req,assets);assert.equal(observed.getState(),state);assert.equal(observed.canUndo(),false);assert.equal(observed.canRedo(),false);assert.deepEqual(writes,[]);
writeFileSync(`${out}/store-state.json`,JSON.stringify({sameReference:true,revision:state.revision,undo:false,redo:false,persistenceEvents:writes}));
writeFileSync(`${out}/results-${process.argv[2]??'a'}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({pages,...r})=>r),null,2));
}finally{await server.close();}
