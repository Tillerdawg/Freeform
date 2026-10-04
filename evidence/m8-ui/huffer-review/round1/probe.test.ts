import { expect, it, vi, afterEach } from 'vitest';
import { createPdfExportUi } from '../../../../src/pdf/export-ui';
import { createCommandStore } from '../../../../src/document/command-store';
import type { FreeformDocument } from '../../../../src/document/types';
const writer = vi.hoisted(() => ({ build: vi.fn() }));
it('reproduces warning context relabelled from current document rather than export snapshot',async()=>{
 const {store}=setup();let resolve:any;writer.build.mockImplementation(()=>new Promise(r=>resolve=r));submit();await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
 const original=store.getState().document;const replacement={...original,sets:original.sets.map((s,i)=>i===0?{...s,name:'Renamed AFTER export'}:s)};store.apply({type:'document.replace',document:replacement});
 resolve({...ready(),manifest:{pages:[{kind:'director'}]},warnings:[{code:'note-overlap',pageIndex:0,performerId:'p',annotationId:'note-id',obstacleKind:'dot',context:{kind:'static-set',setId:'s1'},noteBounds:{x:1,y:1,width:2,height:2},obstacleBounds:{x:2,y:2,width:2,height:2}}]});
 await vi.waitFor(()=>expect(q('pdf-export-download')).not.toBeNull());const text=document.querySelector('.pdf-export-warnings')!.textContent;console.log('warning-snapshot-drift',text);expect(text).toContain('Renamed AFTER export');expect(writer.build.mock.calls[0][0].sets[0].name).toBe('Set 1');
});
vi.mock('../../../../src/pdf/pdf-export', () => ({ buildPdfExport: writer.build }));
vi.mock('../../../../src/pdf/assets', () => ({ loadBundledPdfAssets: () => ({}) }));
function doc(): FreeformDocument { return {
 format:'freeform', formatVersion:'1.0.0',show:{id:'review-show',title:'Review original',totalCounts:32},
 field:{preset:'NFHS_11_PLAYER',unitsPerYard:2880,lengthUnits:288000,widthUnits:153600,frontHashY:51200,backHashY:102400},settings:{collisionThresholdUnits:2880},
 performers:[{id:'p',rankCode:'P',displayName:'Reviewer'}],
 sets:[0,16,32].map((n,i)=>({id:`s${i+1}`,name:`Set ${i+1}`,startCount:n,positions:{p:{x:28800+i*2880,y:28800}}})),
 transitions:[{id:'t1',fromSetId:'s1',toSetId:'s2',counts:16,mode:'float'},{id:'t2',fromSetId:'s2',toSetId:'s3',counts:16,mode:'float'}],annotations:[]
}; }
const q = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
function change(id:string,value?:string) { const c=q<HTMLInputElement>(id); if(value!==undefined)c.value=value; c.dispatchEvent(new Event('change',{bubbles:true})); }
function input(id:string,value:string) { const c=q<HTMLInputElement>(id);c.value=value;c.dispatchEvent(new Event('input',{bubbles:true})); }
function submit() { document.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); }
function setup() {const store=createCommandStore(doc()); const ui=createPdfExportUi(store);document.body.append(ui.render());q<HTMLButtonElement>('pdf-export-invoke').click();return {store,ui};}
function ready() {return {ok:true,bytes:new Uint8Array([1,2,3]),filename:'Review.pdf',manifest:{pages:[]},warnings:[]};}
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();writer.build.mockReset();});
it('reproduces literal count placeholders for decimal, negative, out-of-domain and duplicate',async()=>{
 setup(); change('pdf-export-transition-t1');
 for(const value of ['1.5','-1','17','08,8']) {input('pdf-export-counts-t1',value);submit();await Promise.resolve();const message=q('pdf-export-field-error').textContent;console.log(JSON.stringify({case:'count',value,message,focus:document.activeElement?.id}));expect(message).toContain('<count>');}
});
it('reproduces focus loss after a radio redraw and shell render',()=>{
 const {ui}=setup();q('pdf-export-packet').focus();change('pdf-export-packet');console.log('radio-redraw-focus',document.activeElement?.tagName,document.activeElement?.id);expect(document.activeElement).toBe(document.body);
 q('pdf-export-performer-p').focus();const old=document.querySelector('.pdf-export-controls')!;old.replaceWith(ui.render());console.log('shell-redraw-focus',document.activeElement?.tagName);expect(document.activeElement).toBe(document.body);
});
it('reproduces stale range transition UI and silent dropping of a checked out-of-range frame',async()=>{
 setup();change('pdf-export-transition-t2');input('pdf-export-counts-t2','0,8,16');change('pdf-export-range');
 change('pdf-export-first-set','s1');change('pdf-export-last-set','s2');
 console.log('range-row-before-submit',!!q('pdf-export-transition-t1'),!!q('pdf-export-transition-t2'));
 expect(q('pdf-export-transition-t1')).toBeNull();writer.build.mockResolvedValue(ready());submit();await vi.waitFor(()=>expect(writer.build).toHaveBeenCalled());
 console.log('range-request',JSON.stringify(writer.build.mock.calls[0][1]));expect(writer.build.mock.calls[0][1].transitionFrames).toEqual([]);expect(q('pdf-export-field-error')).toBeNull();
});
it('reproduces loss of download bytes/retry after URL fault',async()=>{
 setup();writer.build.mockResolvedValue(ready());submit();await vi.waitFor(()=>expect(q('pdf-export-download')).not.toBeNull());
 vi.stubGlobal('URL',{createObjectURL:()=>{throw new Error('injected');},revokeObjectURL:vi.fn()});q<HTMLButtonElement>('pdf-export-download').click();
 console.log('download-fault',{status:q('pdf-export-status').textContent,retry:!!q('pdf-export-download'),writerCalls:writer.build.mock.calls.length});expect(q('pdf-export-download')).toBeNull();
});
it('reproduces inside-focused pending submission losing focus, preventing ready focus',async()=>{
 setup();let resolve:any;writer.build.mockImplementation(()=>new Promise(r=>resolve=r));document.querySelector<HTMLButtonElement>('button[type=submit]')!.focus();submit();await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
 expect(document.activeElement).toBe(document.body);resolve(ready());await vi.waitFor(()=>expect(q('pdf-export-download')).not.toBeNull());console.log('ready-focus',document.activeElement?.tagName);expect(document.activeElement).toBe(document.body);
});
it('positive control: snapshot before edit and close pending retains ready with no auto-dispatch',async()=>{
 const {store}=setup();let resolve:any;writer.build.mockImplementation(()=>new Promise(r=>resolve=r));const before=store.getState();submit();store.apply({type:'show.title.set',title:'After edit'});
 const close=[...document.querySelectorAll<HTMLButtonElement>('button')].find(n=>n.textContent==='Close')!;close.click();await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));expect(writer.build.mock.calls[0][0].show.title).toBe('Review original');
 resolve(ready());await vi.waitFor(()=>expect(writer.build).toHaveBeenCalledOnce());await new Promise(r=>setTimeout(r,20));expect(q('pdf-export-download')).toBeNull();q<HTMLButtonElement>('pdf-export-invoke').click();expect(q('pdf-export-download')).not.toBeNull();expect(store.getState().revision).toBe(before.revision+1);console.log('snapshot-close-positive',store.getState().document.show.title);
});
