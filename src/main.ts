import './styles.css';
import { createCommandStore } from './document/command-store';
import { renderDotEditor } from './editor/dot-editor';
import { createEmptyDocument, renderSetupWizard } from './editor/setup-wizard';
import { detectFeatures } from './platform/features';

const store = createCommandStore(createEmptyDocument());
const report = detectFeatures();
const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('Freeform app root is missing.');
}

renderSetupWizard(app, {
  store,
  onComplete: () => renderDotEditor(app, { store, report }),
});
