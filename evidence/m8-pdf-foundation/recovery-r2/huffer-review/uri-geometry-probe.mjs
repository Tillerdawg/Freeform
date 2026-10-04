import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'vite';
import {PDFDocument} from 'pdf-lib';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {isAjvUri}=await server.ssrLoadModule('/src/document/uri.ts');
 const {validateCurrentDocument,validateDocumentForCommandStore}=await server.ssrLoadModule('/src/persistence/freeform-file.ts');
 const {buildPdfExport}=await server.ssrLoadModule('/src/pdf/pdf-export.ts');
 const {loadBundledPdfAssets}=await server.ssrLoadModule('/src/pdf/assets.ts');
 const fixture=JSON.parse(readFileSync('docs/fixtures/freeform-1.0-example.freeform'));
 const assets=loadBundledPdfAssets();
 const request={kind:'director',scope:{kind:'full-show'},transitionFrames:[]};
 const cases=[['https: bad uri',false],['https://example.com/%ZZ',false],['https://[broken',false],['relative/path',false],['https://example.com/%20?q=a#x',true],['urn:freeform:example',true],['mailto:user@example.com',true],['https://[2001:db8::1]/x',true]];
 const results=[];
 for(const [uri,valid] of cases){
  assert.equal(isAjvUri(uri),valid);
  const doc={...fixture,$schema:uri};
  for(const validate of [validateCurrentDocument,validateDocumentForCommandStore]){
   if(valid)validate(doc);else assert.throws(()=>validate(doc),e=>e.code==='SCHEMA');
  }
  const r=await buildPdfExport(doc,request,assets);
  assert.equal(r.ok,valid);
  if(!valid)assert.deepEqual(r,{ok:false,code:'document-invalid',messageKey:'pdfExport.error.documentInvalid.schema',detail:[]});
  results.push({uri,valid,result:r.ok?'exported':r.messageKey});
 }
 const transitionless={...fixture,transitions:[],annotations:fixture.annotations.filter(a=>a.scope.kind!=='transition')};
 const packet=await buildPdfExport(transitionless,{kind:'performer-packet',scope:{kind:'full-show'},performerIds:fixture.performers.map(p=>p.id).reverse()},assets);
 assert(packet.ok);
 assert.deepEqual(packet.manifest.pages.map(p=>p.performerId),fixture.performers.map(p=>p.id));
 assert(packet.manifest.pages.every(p=>JSON.stringify(p.setIds)===JSON.stringify(fixture.sets.map(s=>s.id))));
 const parsed=await PDFDocument.load(packet.bytes,{updateMetadata:false});
 assert(parsed.getPages().every(p=>p.getWidth()===612&&p.getHeight()===792));
 const single=await buildPdfExport(transitionless,{kind:'director',scope:{kind:'inclusive-set-range',firstSetId:fixture.sets[0].id,lastSetId:fixture.sets[0].id},transitionFrames:[]},assets);
 assert(single.ok);assert.equal(single.manifest.pages.length,1);
 writeFileSync('evidence/m8-pdf-foundation/recovery-r2/huffer-review/uri-geometry-results.json',JSON.stringify({uriCases:results,portraitMediaBoxes:parsed.getPages().map(p=>p.getSize()),transitionlessPacketSetRetention:true,performerDocumentOrder:true,singleSetRangePageCount:1,bundledAssetLoaderExercised:true},null,2));
 console.log('PASS: 8 URI cases at pure/codec/store/export boundaries; bundled assets; portrait MediaBoxes; zero-transition packet set retention and performer order; single-set range.');
} finally {await server.close();}
