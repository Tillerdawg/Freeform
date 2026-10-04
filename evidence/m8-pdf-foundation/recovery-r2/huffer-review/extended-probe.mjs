import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const out='evidence/m8-pdf-foundation/recovery-r2/huffer-review';
try {
 const {buildPdfExport}=await server.ssrLoadModule('/src/pdf/pdf-export.ts');
 const {validateCurrentDocument}=await server.ssrLoadModule('/src/persistence/freeform-file.ts');
 const {downloadPdf}=await server.ssrLoadModule('/src/pdf/download.ts');
 const assets={fonts:['noto-sans-latin-400.woff','noto-sans-cyrillic-400.woff','noto-emoji-400.ttf'].map((name,i)=>{const bytes=new Uint8Array(readFileSync('src/pdf/assets/'+name));return {id:name,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),sourceUrl:'https://fontsource.org/',license:'OFL-1.1',subset:i!==2};})};
 const request={kind:'director',scope:{kind:'full-show'},transitionFrames:[]};
 const base=JSON.parse(readFileSync('docs/fixtures/freeform-1.0-example.freeform'));
 const results=[];
 async function probe(name,doc,req=request){let canonical;try{validateCurrentDocument(doc);canonical='accepted';}catch(e){canonical={name:e.name,code:e.code};}try{const r=await buildPdfExport(doc,req,assets);results.push({name,canonical,result:r.ok?{ok:true,pages:r.manifest.pages.length}:{...r}});}catch(e){results.push({name,canonical,rejected:e.name});}}
 await probe('valid complete example',base);
 for(const uri of ['https: bad uri','https://example.com/%ZZ','https://[broken']){const d=structuredClone(base);d.$schema=uri;await probe('invalid $schema '+uri,d);}
 for(const name of ['ftl-end-mismatch','ftl-offset-order','insufficient-ftl-path'])await probe(name,JSON.parse(readFileSync('docs/fixtures/negative/'+name+'.freeform')));
 for(const uri of ['urn:freeform:example','https://[2001:db8::1]/x']){const d=structuredClone(base);d.$schema=uri;await probe('valid URI '+uri,d);}
 const stale=JSON.parse(readFileSync('docs/fixtures/positive/ftl-path-non-horizontal.freeform'));stale.performers=stale.performers.filter(p=>p.id!=='a');stale.sets.forEach(s=>delete s.positions.a);await probe('stale missing member',stale);
 await probe('structural missing ftl',JSON.parse(readFileSync('docs/fixtures/negative/missing-ftl-data.freeform')));
 for(const name of ['ftl-path-non-horizontal','ftl-path-multi-point'])await probe('valid '+name,JSON.parse(readFileSync('docs/fixtures/positive/'+name+'.freeform')));
 for(const stage of ['append','click','remove','revoke']){
   const calls=[];
   const env={
     Blob,
     URL:{createObjectURL(){calls.push('create');return 'blob:test';},revokeObjectURL(){calls.push('revoke');if(stage==='revoke')throw Error();}},
     document:{
       body:{append(){calls.push('append');if(stage==='append')throw Error();}},
       createElement(){return {style:{},click(){calls.push('click');if(stage==='click')throw Error();},remove(){calls.push('remove');if(stage==='remove')throw Error();}};}
     }
   };
   try{results.push({name:'download '+stage,result:downloadPdf(new Uint8Array([1]),'x.pdf',env),calls});}
   catch(e){results.push({name:'download '+stage,rejected:e.name,calls});}
 }
 console.log(JSON.stringify(results,null,2));writeFileSync(out+'/extended-results.json',JSON.stringify(results,null,2));
}finally{await server.close();}
