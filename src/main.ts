import './styles.css';
import { createCommandStore } from './document/command-store';
import type { FreeformDocument } from './document/types';
import { detectFeatures } from './platform/features';

const initialDocument: FreeformDocument = {
  format: 'freeform',
  formatVersion: '1.0.0',
  show: { id: 'untitled-show', title: 'Untitled Show', totalCounts: 0 },
  field: {
    preset: 'NFHS_11_PLAYER',
    unitsPerYard: 2880,
    lengthUnits: 288000,
    widthUnits: 153600,
    frontHashY: 51200,
    backHashY: 102400,
  },
  settings: { collisionThresholdUnits: 2880 },
  performers: [{ id: 'performer-1', rankCode: 'P1', displayName: 'Performer 1' }],
  sets: [{
    id: 'set-1',
    name: 'Set 1',
    startCount: 0,
    positions: { 'performer-1': { x: 144000, y: 76800 } },
  }],
  transitions: [],
  annotations: [],
};

const store = createCommandStore(initialDocument);
const report = detectFeatures();
const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('Freeform app root is missing.');
}

app.dataset.support = String(report.supported);
app.innerHTML = `
  <section class="app-shell" aria-labelledby="app-title">
    <header>
      <p class="eyebrow">Freeform · M1 foundation</p>
      <h1 id="app-title">Freeform</h1>
      <p class="subtitle">Static, local-first drill-authoring foundation.</p>
    </header>
    <section class="capability ${report.supported ? 'capability--ready' : 'capability--blocked'}" aria-labelledby="capability-title" role="status">
      <h2 id="capability-title">Browser compatibility</h2>
      ${report.messages.map((message) => `<p>${message}</p>`).join('')}
    </section>
    <section aria-labelledby="document-title">
      <h2 id="document-title">Document command store</h2>
      <p id="document-state">${store.getState().document.show.title} · revision ${store.getState().revision}</p>
      <p class="muted">M1 establishes immutable state and undo/redo. Field editing begins in M2.</p>
    </section>
  </section>
`;
