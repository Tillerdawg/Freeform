import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
 const { buildPdfExport } = await server.ssrLoadModule('/src/pdf/pdf-export.ts');
 const { downloadPdf } = await server.ssrLoadModule('/src/pdf/download.ts');
 const base = {format:'freeform',formatVersion:'1.0.0',show:{id:'show-1',title:'Café 😀',totalCounts:16},field:{preset:'NFHS_11_PLAYER',unitsPerYard:2880,lengthUnits:288000,widthUnits:153600,frontHashY:51200,backHashY:102400},settings:{collisionThresholdUnits:2880},performers:[{id:'a',rankCode:'A',displayName:'Русский é'}],sets:[{id:'set-1',name:'Set 1',startCount:0,positions:{a:{x:0,y:0}}},{id:'set-2',name:'Set 2',startCount:16,positions:{a:{x:28800,y:14400}}}],transitions:[{id:'move-1',fromSetId:'set-1',toSetId:'set-2',counts:16,mode:'float'}],annotations:[]};
 const request={kind:'director',scope:{kind:'full-show'},transitionFrames:[{transitionId:'move-1',counts:[16,0,8]}]};
 const assets={fonts:['noto-sans-latin-400.woff','noto-sans-cyrillic-400.woff','noto-emoji-400.ttf'].map((name,i)=>{const bytes=new Uint8Array(readFileSync('src/pdf/assets/'+name));return {id:name,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),sourceUrl:'https://fontsource.org/',license:'OFL-1.1',subset:i!==2};})};
 const results=[];
 const run=async(name,doc,req=request)=>{try{const r=await buildPdfExport(doc,req,assets);results.push({name,ok:r.ok,code:r.code,messageKey:r.messageKey,pages:r.manifest?.pages.length});return r;}catch(e){results.push({name,rejected:e.name});}};
 for(let i=0;i<2;i++){const r=await run('valid-'+i,base);if(r.ok){writeFileSync(`evidence/m8-pdf-foundation/recovery-r2/huffer-review/${process.argv[2]??'runtime'}-${i}.pdf`,r.bytes);}}
 const clone=()=>structuredClone(base);
 let d=clone();d.performers.push({...d.performers[0]});await run('duplicate performer ID',d);
 d=clone();d.performers[0].id='BAD ID';d.sets.forEach(s=>{s.positions['BAD ID']=s.positions.a;delete s.positions.a;});await run('malformed performer ID',d);
 d=clone();d.show.id='BAD ID';await run('malformed show ID',d);
 d=clone();d.field.frontHashY=0;await run('invalid field record',d);
 d=clone();d.sets=[];d.transitions=[];await run('empty sets',d);
 await run('unknown request kind',base,{kind:'nonsense',performerIds:['a'],scope:{kind:'full-show'}});
 await run('missing frames',base,{kind:'director',scope:{kind:'full-show'}});
 await run('unknown scope kind',base,{kind:'director',scope:{kind:'nonsense',firstSetId:'set-1',lastSetId:'set-2'},transitionFrames:[]});
 const environment={Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{throw Error('cleanup failure');}},document:{body:{append(){}},createElement:()=>({style:{},click(){},remove(){}})}};
 try{results.push({name:'revoke throws',result:downloadPdf(new Uint8Array([1]),'test.pdf',environment)});}catch(e){results.push({name:'revoke throws',threw:e.name});}
 console.log(JSON.stringify(results,null,2));
 writeFileSync(`evidence/m8-pdf-foundation/recovery-r2/huffer-review/${process.argv[2]??'runtime'}-probe.json`,JSON.stringify(results,null,2));
} finally {await server.close();}
