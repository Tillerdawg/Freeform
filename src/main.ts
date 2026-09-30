import './styles.css';
import { createCommandStore } from './document/command-store';
import type { FreeformDocument } from './document/types';
import { renderDotEditor } from './editor/dot-editor';
import { NFHS_11_PLAYER_FIELD } from './geometry/nfhs';
import { detectFeatures } from './platform/features';

const initialDocument: FreeformDocument = {
  format: 'freeform',
  formatVersion: '1.0.0',
  show: { id: 'untitled-show', title: 'Untitled Show', totalCounts: 0 },
  field: NFHS_11_PLAYER_FIELD,
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

renderDotEditor(app, { store, report });
