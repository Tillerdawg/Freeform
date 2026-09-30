// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createCommandStore } from '../document/command-store';
import { isValidDot } from '../geometry/nfhs';
import {
  applySetup,
  createEmptyDocument,
  duplicatePrefixes,
  layoutSections,
  renderSetupWizard,
  suggestPrefix,
} from './setup-wizard';

function inputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function typeIncrementally(input: HTMLInputElement, value: string): void {
  for (const character of value) {
    input.value += character;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
  }
}

describe('setup wizard layout', () => {
  it('centers odd and even small sections on the 50-yard line with two-step spacing', () => {
    const [even, odd] = layoutSections([
      { instrument: 'Piccolo', count: '4', prefix: 'P' },
      { instrument: 'Clarinet', count: '3', prefix: 'C' },
    ]);

    expect(even).toEqual([
      { x: 138600, y: 0 },
      { x: 142200, y: 0 },
      { x: 145800, y: 0 },
      { x: 149400, y: 0 },
    ]);
    expect(odd).toEqual([
      { x: 140400, y: 7200 },
      { x: 144000, y: 7200 },
      { x: 147600, y: 7200 },
    ]);
  });

  it('stacks entered sections front-to-back with four-step row-center gaps', () => {
    const [trumpets, flags, tubas] = layoutSections([
      { instrument: 'Trumpet', count: '2', prefix: 'T' },
      { instrument: 'Flag', count: '1', prefix: 'G' },
      { instrument: 'Tuba', count: '2', prefix: 'TU' },
    ]);

    expect(trumpets).toEqual([{ x: 142200, y: 0 }, { x: 145800, y: 0 }]);
    expect(flags).toEqual([{ x: 144000, y: 7200 }]);
    expect(tubas).toEqual([{ x: 142200, y: 14400 }, { x: 145800, y: 14400 }]);
  });

  it('wraps a section after 80 performers and keeps each wrapped row centered and valid', () => {
    const [piccolos] = layoutSections([{ instrument: 'Piccolo', count: '81', prefix: 'P' }]);

    expect(piccolos).toHaveLength(81);
    expect(piccolos[0]).toEqual({ x: 1800, y: 0 });
    expect(piccolos[79]).toEqual({ x: 286200, y: 0 });
    expect(piccolos[80]).toEqual({ x: 144000, y: 7200 });
    expect(piccolos.every(isValidDot)).toBe(true);
  });
});

describe('setup wizard generation', () => {
  it('creates Set 1 and exactly one command-store performer per requested rank code', () => {
    const store = createCommandStore(createEmptyDocument());
    applySetup(store, 'Opening Night', [
      { instrument: 'Piccolo', count: '2', prefix: 'P' },
      { instrument: 'Clarinet', count: '3', prefix: 'C' },
    ]);

    const document = store.getState().document;
    expect(document.show.title).toBe('Opening Night');
    expect(document.sets).toEqual([{ id: 'set-1', name: 'Set 1', startCount: 0, positions: {
      p1: { x: 142200, y: 0 },
      p2: { x: 145800, y: 0 },
      c1: { x: 140400, y: 7200 },
      c2: { x: 144000, y: 7200 },
      c3: { x: 147600, y: 7200 },
    } }]);
    expect(document.performers).toEqual([
      { id: 'p1', rankCode: 'P1', displayName: 'P1', section: 'Piccolo' },
      { id: 'p2', rankCode: 'P2', displayName: 'P2', section: 'Piccolo' },
      { id: 'c1', rankCode: 'C1', displayName: 'C1', section: 'Clarinet' },
      { id: 'c2', rankCode: 'C2', displayName: 'C2', section: 'Clarinet' },
      { id: 'c3', rankCode: 'C3', displayName: 'C3', section: 'Clarinet' },
    ]);
    expect(store.getUndoCommands().map((command) => command.type)).toEqual([
      'show.title.set', 'set.create', 'performer.create', 'performer.create', 'performer.create', 'performer.create', 'performer.create',
    ]);
  });

  it('suggests conventional common-section prefixes and detects collisions case-insensitively', () => {
    expect(suggestPrefix('Piccolo')).toBe('P');
    expect(suggestPrefix('Alto Saxophone')).toBe('AS');
    expect(suggestPrefix('Flag')).toBe('G');
    expect(duplicatePrefixes([
      { instrument: 'Piccolo', count: '4', prefix: 'P' },
      { instrument: 'Trumpet', count: '8', prefix: 'p' },
      { instrument: 'Clarinet', count: '12', prefix: 'C' },
    ])).toEqual(['p']);
  });

  it('shows a live inline prefix-collision error and blocks wizard submission', () => {
    const root = document.createElement('div');
    const store = createCommandStore(createEmptyDocument());
    renderSetupWizard(root, { store, onComplete: () => {} });

    inputValue(root.querySelector<HTMLInputElement>('#setup-title')!, 'Opening Night');
    inputValue(root.querySelector<HTMLInputElement>('[id^="setup-instrument-"]')!, 'Piccolo');
    Array.from(root.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
      .find((button) => button.textContent === 'Add section')!.click();
    inputValue(root.querySelectorAll<HTMLInputElement>('[id^="setup-instrument-"]')[1]!, 'Trumpet');
    const prefixes = root.querySelectorAll<HTMLInputElement>('.setup-prefix');
    inputValue(prefixes[0]!, 'P');
    inputValue(prefixes[1]!, 'p');

    expect(root.querySelector('#setup-total')?.textContent).toBe('Total performers: 2');
    expect(root.querySelector('#setup-prefix-error')?.textContent).toContain('duplicate: P');
    expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('keeps instrument input connected and focused during incremental typing while applying its prefix suggestion', () => {
    const root = document.createElement('div');
    const store = createCommandStore(createEmptyDocument());
    document.body.append(root);
    try {
      renderSetupWizard(root, { store, onComplete: () => {} });

      const instrument = root.querySelector<HTMLInputElement>('[id^="setup-instrument-"]')!;
      instrument.focus();
      typeIncrementally(instrument, 'Piccolo');

      expect(instrument.value).toBe('Piccolo');
      const prefix = root.querySelector<HTMLInputElement>('.setup-prefix')!;
      expect(prefix.value).toBe('P');

      inputValue(prefix, 'PX');
      inputValue(instrument, 'Trumpet');
      expect(prefix.value).toBe('PX');
    } finally {
      root.remove();
    }
  });
});
