import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = 'evidence/m8-ui/wheeljack-round3/baseline';
const appUrl = process.env.M8_APP_URL ?? 'http://127.0.0.1:4174/';
const chrome = '/Users/jatiller/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const profile = `${process.env.TMPDIR}/m8-baseline-${process.pid}`;
await mkdir(out, { recursive: true });

const performers = Array.from({ length: 500 }, (_, index) => ({ id: `p${String(index + 1).padStart(3, '0')}`, rankCode: `P${String(index + 1).padStart(3, '0')}`, displayName: `Performer ${index + 1}` }));
const sets = Array.from({ length: 250 }, (_, setIndex) => ({
  id: `set-${String(setIndex + 1).padStart(3, '0')}`,
  name: `Set ${setIndex + 1}`,
  startCount: setIndex * 40,
  positions: Object.fromEntries(performers.map((performer, performerIndex) => [performer.id, {
    x: (performerIndex % 100) * 2880,
    y: Math.min(153600, Math.floor(performerIndex / 100) * 28800 + (setIndex % 8) * 180),
  }])),
}));
const document = {
  format: 'freeform', formatVersion: '1.0.0',
  show: { id: 'm8-normative-baseline', title: 'M8 normative export baseline', totalCounts: 10000 },
  field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
  settings: { collisionThresholdUnits: 2880 },
  performers,
  sets,
  transitions: Array.from({ length: 249 }, (_, index) => ({ id: `move-${String(index + 1).padStart(3, '0')}`, fromSetId: sets[index].id, toSetId: sets[index + 1].id, counts: 40, mode: 'float' })),
  layers: [{ id: 'baseline-notes', name: 'Baseline notes', visible: true, print: false, locked: false }],
  annotations: sets.flatMap((set, setIndex) => Array.from({ length: 20 }, (_, annotationIndex) => ({
    id: `annotation-${setIndex + 1}-${annotationIndex + 1}`, kind: 'label', layerId: 'baseline-notes', scope: { kind: 'set', setId: set.id },
    visibility: { editor: true, print: false, performerPacket: false }, text: `Baseline annotation ${annotationIndex + 1}`, anchor: { x: annotationIndex * 2880, y: 0 },
  }))),
};
const fixturePath = resolve(`${out}/normative-500-performers-250-sets.freeform`);
await writeFile(fixturePath, `${JSON.stringify(document)}\n`);

const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', `--user-data-dir=${profile}`, 'about:blank']);
let stderr = '';
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    proc.stderr.on('data', (bytes) => { stderr += bytes; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolveEndpoint(match[1]); });
    proc.once('exit', (code) => reject(new Error(`Chrome exited ${code}`)));
    setTimeout(() => reject(new Error('Chrome endpoint timeout')), 20_000).unref();
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolveOpen) => socket.addEventListener('open', resolveOpen, { once: true }));
  let sequence = 0;
  const waiting = new Map();
  socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (!message.id) return; const pending = waiting.get(message.id); waiting.delete(message.id); message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result); });
  const call = (method, params = {}, sessionId) => new Promise((resolveCall, reject) => { const id = ++sequence; waiting.set(id, { resolve: resolveCall, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const version = await call('Browser.getVersion');
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const c = (method, params = {}) => call(method, params, sessionId);
  const evaluate = async (expression) => { const result = await c('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const waitFor = async (expression, label, attempts = 2400) => { for (let i = 0; i < attempts; i += 1) { if (await evaluate(expression)) return; await new Promise((resolveWait) => setTimeout(resolveWait, 50)); } throw new Error(`Timed out: ${label}; status=${await evaluate(`document.querySelector('#pdf-export-status')?.textContent ?? document.body.innerText.slice(0, 500)`)}`); };
  await c('Page.enable'); await c('Runtime.enable'); await c('Network.enable');
  await c('Emulation.setDeviceMetricsOverride', { width: 1280, height: 2400, deviceScaleFactor: 1, mobile: false });
  await c('Page.navigate', { url: appUrl });
  await waitFor(`Boolean(document.querySelector('.setup-wizard'))`, 'setup');
  await evaluate(`(()=>{for(const [id,value] of [['setup-title','Baseline scratch'],['setup-instrument-1','T'],['setup-prefix-1','T'],['setup-count-1','1']]){const node=document.getElementById(id);node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('.setup-wizard').requestSubmit();})()`);
  await waitFor(`Boolean(document.querySelector('#pdf-export-invoke'))`, 'editor');
  const point = await evaluate(`(()=>{const node=[...document.querySelectorAll('.persistence-controls__buttons button')].find((node) => node.textContent === 'Open…');const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await c('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }); await c('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await waitFor(`Boolean(document.querySelector('input[type=file]'))`, 'file input');
  const dom = await c('DOM.getDocument');
  const { nodeId } = await c('DOM.querySelector', { nodeId: dom.root.nodeId, selector: 'input[type=file]' });
  await c('DOM.setFileInputFiles', { files: [fixturePath], nodeId });
  await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  if (await evaluate(`Boolean([...document.querySelectorAll('button')].find((node) => node.textContent === 'Discard and Open'))`)) await evaluate(`(()=>{[...document.querySelectorAll('button')].find((node) => node.textContent === 'Discard and Open').click();})()`);
  await waitFor(`document.querySelector('#document-title')?.value === 'M8 normative export baseline'`, 'baseline import');
  await evaluate(`document.querySelector('#pdf-export-invoke').click()`);
  await waitFor(`Boolean(document.querySelector('#pdf-export-submit'))`, 'export panel');
  const startedAt = performance.now();
  await evaluate(`document.querySelector('#pdf-export-submit').click()`);
  await waitFor(`Boolean(document.querySelector('#pdf-export-download'))`, 'baseline export ready');
  const durationMs = Math.round(performance.now() - startedAt);
  const result = { version, appUrl, fixture: { performers: 500, sets: 250, transitions: 249, totalCounts: 10000, annotationsPerSet: 20, annotations: 5000 }, durationMs, filename: await evaluate(`document.querySelector('#pdf-export-download').textContent`), status: await evaluate(`document.querySelector('#pdf-export-status').textContent`) };
  await writeFile(`${out}/runtime.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  socket.close();
} finally {
  proc.kill();
  await writeFile(`${out}/chrome-stderr.log`, stderr);
}
