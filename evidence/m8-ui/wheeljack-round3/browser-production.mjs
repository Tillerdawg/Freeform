import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = 'evidence/m8-ui/wheeljack-round3';
const appUrl = process.env.M8_APP_URL ?? 'http://127.0.0.1:4174/';
const chrome = '/Users/jatiller/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const profile = `${process.env.TMPDIR}/m8-wheeljack-round3-${process.pid}`;
const fixtureDir = `${out}/fixtures`;
const downloads = `${out}/downloads`;

await mkdir(fixtureDir, { recursive: true });
await mkdir(downloads, { recursive: true });
const ftl = JSON.parse(await readFile('docs/fixtures/freeform-1.0-example.freeform', 'utf8'));
const overlap = {
  format: 'freeform', formatVersion: '1.0.0',
  show: { id: 'm8-overlap', title: 'M8 overlap control', totalCounts: 16 },
  field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
  settings: { collisionThresholdUnits: 2880 },
  performers: [{ id: 'a', rankCode: 'A', displayName: 'Alpha' }],
  sets: [
    { id: 'set-1', name: 'Set 1', startCount: 0, positions: { a: { x: 0, y: 0 } } },
    { id: 'set-2', name: 'Set 2', startCount: 16, positions: { a: { x: 28800, y: 14400 } } },
  ],
  transitions: [{ id: 'move-1', fromSetId: 'set-1', toSetId: 'set-2', counts: 16, mode: 'float' }],
  layers: [{ id: 'notes', name: 'Notes', visible: true, print: true, locked: false }],
  annotations: [{
    id: 'known-overlap', kind: 'label', layerId: 'notes', scope: { kind: 'show' },
    visibility: { editor: true, print: true, performerPacket: false }, text: 'Known overlap control', anchor: { x: 0, y: 0 },
  }],
};
const zeroOverlap = structuredClone(overlap);
zeroOverlap.show = { ...zeroOverlap.show, id: 'm8-zero-overlap', title: 'M8 zero-overlap control' };
zeroOverlap.annotations = [];
await writeFile(`${fixtureDir}/ftl-member-outsider.freeform`, `${JSON.stringify(ftl)}\n`);
await writeFile(`${fixtureDir}/known-overlap.freeform`, `${JSON.stringify(overlap)}\n`);
await writeFile(`${fixtureDir}/zero-overlap.freeform`, `${JSON.stringify(zeroOverlap)}\n`);

const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', `--user-data-dir=${profile}`, 'about:blank']);
let stderr = '';
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    proc.stderr.on('data', (bytes) => {
      stderr += bytes;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolveEndpoint(match[1]);
    });
    proc.once('exit', (code) => reject(new Error(`Chrome exited ${code}`)));
    setTimeout(() => reject(new Error('Chrome endpoint timeout')), 20_000).unref();
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolveOpen) => socket.addEventListener('open', resolveOpen, { once: true }));
  let sequence = 0;
  const waiting = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    } else events.push(message);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolveCall, reject) => {
    const id = ++sequence;
    waiting.set(id, { resolve: resolveCall, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const version = await call('Browser.getVersion');
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const c = (method, params = {}) => call(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await c('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression, label, attempts = 600) => {
    for (let i = 0; i < attempts; i += 1) {
      if (await evaluate(expression)) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error(`Timed out: ${label}; body=${await evaluate('document.body.innerText')}`);
  };
  const click = async (selector) => {
    const point = await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('missing ${selector}');const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await c('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await c('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const select = async (selector, value) => evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const upload = async (path, expectedTitle) => {
    await click('.persistence-controls__buttons button:nth-child(3)');
    await waitFor(`Boolean(document.querySelector('input[type=file]'))`, 'file chooser');
    const dom = await c('DOM.getDocument');
    const { nodeId } = await c('DOM.querySelector', { nodeId: dom.root.nodeId, selector: 'input[type=file]' });
    await c('DOM.setFileInputFiles', { files: [resolve(path)], nodeId });
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    if (await evaluate(`Boolean([...document.querySelectorAll('button')].find((node) => node.textContent === 'Discard and Open'))`)) {
      await evaluate(`(()=>{[...document.querySelectorAll('button')].find((node) => node.textContent === 'Discard and Open').click();})()`);
    }
    await waitFor(`document.querySelector('#document-title')?.value === ${JSON.stringify(expectedTitle)}`, 'imported document');
  };
  const waitReady = () => waitFor(`Boolean(document.querySelector('#pdf-export-download'))`, 'PDF ready');
  const findings = [];
  await c('Page.enable');
  await c('Runtime.enable');
  await c('Network.enable');
  await c('Emulation.setDeviceMetricsOverride', { width: 1280, height: 2400, deviceScaleFactor: 1, mobile: false });
  await c('Page.navigate', { url: appUrl });
  await waitFor(`Boolean(document.querySelector('.setup-wizard'))`, 'setup wizard');
  await evaluate(`(()=>{for(const [id,value] of [['setup-title','Scratch import'],['setup-instrument-1','Trumpet'],['setup-prefix-1','T'],['setup-count-1','1']]){const node=document.getElementById(id);node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('.setup-wizard').requestSubmit();})()`);
  await waitFor(`Boolean(document.querySelector('#pdf-export-invoke'))`, 'application editor');
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(downloads), eventsEnabled: true });

  // The source document is a valid persisted FTL fixture. Both exports use the
  // application’s Open and export controls; no app debug API or store hook exists.
  await upload(`${fixtureDir}/ftl-member-outsider.freeform`, 'Five Person FTL Fixture');
  await click('#pdf-export-invoke');
  await waitFor(`Boolean(document.querySelector('#pdf-export-packet'))`, 'FTL export panel');
  await click('#pdf-export-packet');
  await evaluate(`document.querySelector('#pdf-export-performers-select-all').focus()`);
  await click('#pdf-export-performers-select-all');
  findings.push({ case: 'production-select-all-focus-restored', focus: await evaluate(`({ id: document.activeElement.id, tag: document.activeElement.tagName })`) });
  await evaluate(`document.querySelector('#pdf-export-performers-clear-all').focus()`);
  await click('#pdf-export-performers-clear-all');
  findings.push({ case: 'production-clear-all-focus-restored', focus: await evaluate(`({ id: document.activeElement.id, tag: document.activeElement.tagName })`) });
  await click('#pdf-export-performer-a');
  await click('#pdf-export-submit');
  await waitReady();
  const memberFilename = await evaluate(`document.querySelector('#pdf-export-download').textContent`);
  await click('#pdf-export-download');
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  findings.push({ case: 'actual-app-ftl-member-packet', filename: memberFilename, selectedId: 'a', selectedRank: 'T1' });
  await click('#pdf-export-close');
  await click('#pdf-export-invoke');
  await waitFor(`Boolean(document.querySelector('#pdf-export-packet'))`, 'FTL reopen panel');
  await click('#pdf-export-packet');
  await click('#pdf-export-performers-clear-all');
  await click('#pdf-export-performer-e');
  await click('#pdf-export-submit');
  await waitReady();
  const leaderFilename = await evaluate(`document.querySelector('#pdf-export-download').textContent`);
  await click('#pdf-export-download');
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  findings.push({ case: 'actual-app-ftl-leader-packet', filename: leaderFilename, selectedId: 'e', selectedRank: 'T5' });

  // The just-generated real FTL packet becomes the current retained byte result
  // for browser-local download-seam faults. Pending snapshot close/reopen remains
  // covered by the focused controller test.
  findings.push({ case: 'actual-app-ftl-ready-for-download-faults', filename: await evaluate(`document.querySelector('#pdf-export-download').textContent`) });

  // These browser-local seam faults are simulated. The successful bytes remain
  // ready for a later retry; no native-picker cancellation is claimed.
  const revisionBeforeFaults = await evaluate(`document.querySelector('#document-title').value`);
  for (const [name, setup] of [
    ['blob', `globalThis.__m8Blob=globalThis.Blob;globalThis.Blob=class{constructor(){throw new Error('simulated Blob failure')}}`],
    ['url', `globalThis.__m8Url=URL.createObjectURL;URL.createObjectURL=()=>{throw new Error('simulated URL failure')}`],
    ['anchor', `globalThis.__m8Click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){throw new Error('simulated anchor failure')}`],
  ]) {
    await evaluate(setup);
    await click('#pdf-export-download');
    findings.push({ case: `simulated-${name}-fault-retains-ready-bytes`, ready: await evaluate(`Boolean(document.querySelector('#pdf-export-download'))`), status: await evaluate(`document.querySelector('#pdf-export-status').textContent`), title: await evaluate(`document.querySelector('#document-title').value`) });
    if (name === 'blob') await evaluate(`globalThis.Blob=globalThis.__m8Blob`);
    if (name === 'url') await evaluate(`URL.createObjectURL=globalThis.__m8Url`);
    if (name === 'anchor') await evaluate(`HTMLAnchorElement.prototype.click=globalThis.__m8Click`);
    await click('#pdf-export-download');
  }
  findings.push({ case: 'fault-recovery-no-document-change', titleBeforeFaults: revisionBeforeFaults, titleAfterFaults: await evaluate(`document.querySelector('#document-title').value`) });

  // This second persisted fixture has a deliberately known label/dot overlap,
  // followed by the original non-overlap fixture as the zero-warning control.
  await click('#pdf-export-close');
  await upload(`${fixtureDir}/known-overlap.freeform`, 'M8 overlap control');
  await click('#pdf-export-invoke');
  await waitFor(`Boolean(document.querySelector('#pdf-export-director'))`, 'overlap panel');
  await click('#pdf-export-director');
  await click('#pdf-export-submit');
  await waitFor(`document.querySelector('#pdf-export-status')?.textContent.includes('Generating')`, 'overlap generation start');
  await waitReady();
  findings.push({ case: 'actual-app-known-overlap', warningSummary: await evaluate(`document.querySelector('#pdf-export-warning-details')?.textContent ?? ''`) });
  await click('#pdf-export-close');
  await upload(`${fixtureDir}/zero-overlap.freeform`, 'M8 zero-overlap control');
  await click('#pdf-export-invoke');
  await waitFor(`Boolean(document.querySelector('#pdf-export-director'))`, 'zero-overlap panel');
  await click('#pdf-export-director');
  await click('#pdf-export-submit');
  await waitFor(`document.querySelector('#pdf-export-status')?.textContent.includes('Generating')`, 'zero-overlap generation start');
  await waitReady();
  findings.push({ case: 'actual-app-zero-overlap-control', warningSummaryPresent: await evaluate(`Boolean(document.querySelector('#pdf-export-warning-details'))`) });

  const network = events.filter((event) => event.method?.startsWith('Network.')).map((event) => ({ method: event.method, url: event.params?.request?.url ?? event.params?.response?.url }));
  const consoleEvents = events.filter((event) => event.method === 'Runtime.consoleAPICalled');
  await writeFile(`${out}/runtime.json`, `${JSON.stringify({ version, appUrl, findings, network, consoleCount: consoleEvents.length }, null, 2)}\n`);
  await writeFile(`${out}/browser-events.json`, `${JSON.stringify(events, null, 2)}\n`);
  console.log(JSON.stringify({ version, appUrl, findings, downloads }, null, 2));
  socket.close();
} finally {
  proc.kill();
  await writeFile(`${out}/chrome-stderr.log`, stderr);
}
