import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
const mod=await server.ssrLoadModule('/src/pdf/pdf-export.ts');
// Monkeypatch isn't straightforward since internals aren't exported; instead force
// an uncaught path by calling buildPdfExport and inspecting for console output.
process.on('unhandledRejection', (e)=>{console.log('UNHANDLED',e);});
const assets={fonts:[['noto-latin','noto-sans-latin-400.woff',true],['noto-cyrillic','noto-sans-cyrillic-400.woff',true],['noto-emoji','noto-emoji-400.ttf',false]].map(([id,file,subset])=>{const bytes=new Uint8Array(readFileSync('src/pdf/assets/'+file));return {id,bytes,sha256:'x',subset,sourceUrl:'u',license:'OFL-1.1'};})};
const base={format:'freeform',formatVersion:'1.0.0',show:{id:'s',title:'T',totalCounts:64},field:{preset:'NFHS_11_PLAYER',unitsPerYard:2880,lengthUnits:288000,widthUnits:153600,frontHashY:51200,backHashY:102400},settings:{collisionThresholdUnits:2880},performers:[{id:'a',rankCode:'A',displayName:'Alpha',notes:Array.from({length:44},(_,i)=>'Identity line '+i).join('\n')}],sets:[{id:'s0',name:'S0',startCount:0,positions:{a:{x:0,y:0}}}],transitions:[],annotations:[]};
// Reach into module internals via a direct require of compiled source isn't exposed;
// instead, reproduce the exact layoutPacket arithmetic in isolation to confirm the defect
// independent of pdf-lib's own throw site.
const PACKET={top:756,bottom:42,leading:12,entryHeight:190};
const capacity=PACKET.top-PACKET.bottom;
const lines=44; // matches fixture
const identityHeight=(2+lines)*PACKET.leading+18;
console.log('capacity',capacity,'identityHeight',identityHeight,'identity-alone-fits',identityHeight<=capacity,'identity+firstEntry',identityHeight+PACKET.entryHeight,'overflow-combined',identityHeight+PACKET.entryHeight>capacity);
const result=await mod.buildPdfExport(base,{kind:'performer-packet',performerIds:['a'],scope:{kind:'full-show'}},assets);
console.log('export result',JSON.stringify(result.ok?{ok:true}:result));
}finally{await server.close();}
