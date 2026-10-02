import './styles.css';
import { createCommandStore } from './document/command-store';
import { createEmptyDocument } from './editor/setup-wizard';
import { detectFeatures } from './platform/features';
import { createPersistenceUi } from './persistence/persistence-ui';

const store = createCommandStore(createEmptyDocument());
const report = detectFeatures();
const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('Freeform app root is missing.');
}

createPersistenceUi(app, store, report).start();
