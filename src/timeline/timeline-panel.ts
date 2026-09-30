import type { CommandStore, Identifier, Transition } from '../document/types';
import { calculatePairDistance, calculateTransitionStepStatuses } from './float';
import { createPlaybackController, type PlaybackController } from './playback';

export interface TimelinePanel {
  render(): HTMLElement;
  handleKeyDown(event: KeyboardEvent): void;
}

export function createTimelinePanel(
  store: CommandStore,
  refresh: () => void,
  setStatus: (message: string) => void,
): TimelinePanel {
  let activeTransitionId: Identifier | undefined;
  let playback: PlaybackController | undefined;
  let playbackRevision = -1;
  let timer: number | undefined;

  const clearTimer = (): void => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
  const getTransition = (): Transition | undefined => {
    const transitions = store.getState().document.transitions;
    if (!activeTransitionId || !transitions.some(({ id }) => id === activeTransitionId)) {
      activeTransitionId = transitions[0]?.id;
      playback = undefined;
    }
    return transitions.find(({ id }) => id === activeTransitionId);
  };
  const getPlayback = (): PlaybackController | undefined => {
    const document = store.getState().document;
    const transition = getTransition();
    if (!transition) return undefined;
    if (!playback || playbackRevision !== store.getState().revision) {
      const oldState = playback?.getState();
      playback = createPlaybackController(document, transition);
      playbackRevision = store.getState().revision;
      if (oldState) playback.seek(Math.min(oldState.count, transition.counts));
    }
    return playback;
  };
  const play = (): void => {
    const controller = getPlayback();
    if (!controller) return;
    controller.play();
    clearTimer();
    timer = window.setInterval(() => {
      const current = controller.next();
      if (!current.isPlaying) clearTimer();
      refresh();
    }, 500);
  };

  return {
    handleKeyDown(event) {
      const controller = getPlayback();
      if (controller?.handleKeyDown(event)) {
        if (!controller.getState().isPlaying) clearTimer();
        refresh();
      }
    },
    render() {
      const currentDocument = store.getState().document;
      const panel = element('section');
      panel.setAttribute('aria-labelledby', 'timeline-title');
      const title = text('h2', 'Float timeline');
      title.id = 'timeline-title';
      panel.append(title, text('p', 'M3 sequential float playback: Space play/pause; Left/Right previous/next count.'));

      const authoring = element('div', 'editor-controls');
      authoring.append(createSetForm(), createTransitionForm());
      panel.append(authoring);

      const transition = getTransition();
      if (!transition) {
        panel.append(text('p', 'Create a second fully covered set, then create its float transition to enable playback.'));
        return panel;
      }
      const controller = getPlayback()!;
      const state = controller.getState();
      const playbackControls = element('div', 'timeline-controls');
      const previous = button('Previous count', () => { controller.previous(); refresh(); });
      const playPause = button(state.isPlaying ? 'Pause' : 'Play', () => {
        if (state.isPlaying) { controller.pause(); clearTimer(); } else play();
        refresh();
      });
      const next = button('Next count', () => { controller.next(); refresh(); });
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = String(transition.counts); slider.step = '1'; slider.value = String(state.count);
      slider.setAttribute('aria-label', 'Playback count scrubber');
      slider.addEventListener('input', () => { controller.seek(Number(slider.value)); refresh(); });
      const direct = document.createElement('input');
      direct.type = 'number'; direct.min = '0'; direct.max = String(transition.counts); direct.step = '1'; direct.value = String(state.count);
      direct.setAttribute('aria-label', 'Direct playback count');
      direct.addEventListener('change', () => {
        try { controller.seek(Number(direct.value)); refresh(); }
        catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid playback count.'); refresh(); }
      });
      playbackControls.append(previous, playPause, next, slider, direct, text('output', `Count ${state.count} of ${transition.counts}`));
      panel.append(playbackControls);

      const sampleTable = element('table', 'inspection-table');
      sampleTable.append(tableHead(['Rank', 'Sample position (FU)', 'Step-size status']));
      const sampleBody = document.createElement('tbody');
      const statuses = new Map(calculateTransitionStepStatuses(currentDocument, transition).map((status) => [status.performerId, status]));
      currentDocument.performers.forEach((performer) => {
        const position = state.sample.positions[performer.id]!;
        const status = statuses.get(performer.id)!;
        const row = document.createElement('tr');
        row.append(text('th', performer.rankCode), text('td', `(${position.x}, ${position.y})`));
        const statusCell = text('td', status.stepSize === undefined ? 'No movement — green' : `${status.label} — ${status.band}`);
        statusCell.className = `step-status step-status--${status.band}`;
        row.append(statusCell); sampleBody.append(row);
      });
      sampleTable.append(sampleBody);
      panel.append(sampleTable, createPairDistanceForm(state.sample.positions));
      return panel;
    },
  };

  function createSetForm(): HTMLFormElement {
    const currentDocument = store.getState().document;
    const form = element('form', 'editor-form');
    form.append(text('h3', 'Duplicate active set'));
    const name = input('new-set-name', 'Set name', 'text'); name.required = true; name.value = `Set ${currentDocument.sets.length + 1}`;
    const start = input('new-set-start-count', 'Start count', 'number'); start.required = true; start.min = '0'; start.step = '1';
    const last = currentDocument.sets.at(-1); start.value = String((last?.startCount ?? 0) + 16);
    form.append(label(name, 'Set name'), name, label(start, 'Start count'), start, submit('Create fully covered set'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const startCount = Number(start.value);
      const id = `set-${startCount}`;
      const source = currentDocument.sets.at(-1);
      if (!source) return;
      try {
        store.apply({ type: 'set.create', set: { id, name: name.value.trim(), startCount, positions: structuredClone(source.positions) } });
        setStatus(`Created ${name.value.trim()} with complete performer coverage.`);
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not create set.'); }
      refresh();
    });
    return form;
  }

  function createTransitionForm(): HTMLFormElement {
    const currentDocument = store.getState().document;
    const form = element('form', 'editor-form');
    form.append(text('h3', 'Create float transition'));
    const pairs = currentDocument.sets.slice(0, -1).map((from, index) => ({ from, to: currentDocument.sets[index + 1]! }));
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Adjacent sets');
    pairs.forEach(({ from, to }) => {
      const option = document.createElement('option'); option.value = `${from.id}:${to.id}`; option.textContent = `${from.name} → ${to.name}`; select.append(option);
    });
    form.append(label(select, 'Adjacent sets'), select, submit('Create float transition'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const [fromSetId, toSetId] = select.value.split(':');
      const from = currentDocument.sets.find(({ id }) => id === fromSetId);
      const to = currentDocument.sets.find(({ id }) => id === toSetId);
      if (!from || !to) return;
      const transition = { id: `float-${fromSetId}-${toSetId}`, fromSetId, toSetId, counts: to.startCount - from.startCount, mode: 'float' as const };
      try { store.apply({ type: 'transition.create', transition }); activeTransitionId = transition.id; setStatus(`Created ${transition.counts}-count float transition.`); }
      catch (error) { setStatus(error instanceof Error ? error.message : 'Could not create transition.'); }
      refresh();
    });
    return form;
  }

  function createPairDistanceForm(positions: Readonly<Record<Identifier, { readonly x: number; readonly y: number }>>): HTMLFormElement {
    const currentDocument = store.getState().document;
    const form = element('form', 'editor-form');
    form.append(text('h3', 'Pair distance (read-only)'));
    const ids = currentDocument.performers.map(({ id }) => id);
    const first = performerSelect('pair-first', ids);
    const second = performerSelect('pair-second', ids); if (ids[1]) second.value = ids[1];
    const result = text('output', 'Select two dots and calculate; positions are never changed.');
    form.append(label(first, 'First performer'), first, label(second, 'Second performer'), second, submit('Calculate distance'), result);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (first.value === second.value) { result.textContent = 'Choose two different performers.'; return; }
      const distance = calculatePairDistance(positions[first.value]!, positions[second.value]!);
      result.textContent = `${distance.distanceFU.toFixed(3)} FU; ${distance.display.steps}; ${distance.display.yards}; ${distance.display.quarterSteps}.`;
    });
    return form;
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag); if (className) item.className = className; return item;
}
function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string): HTMLElementTagNameMap[K] { const item = element(tag); item.textContent = value; return item; }
function input(id: string, ariaLabel: string, type: string): HTMLInputElement { const item = document.createElement('input'); item.id = id; item.type = type; item.setAttribute('aria-label', ariaLabel); return item; }
function label(control: HTMLInputElement | HTMLSelectElement, value: string): HTMLLabelElement { const item = document.createElement('label'); item.htmlFor = control.id; item.textContent = value; return item; }
function submit(value: string): HTMLButtonElement { const item = document.createElement('button'); item.type = 'submit'; item.textContent = value; return item; }
function button(value: string, action: () => void): HTMLButtonElement { const item = document.createElement('button'); item.type = 'button'; item.textContent = value; item.addEventListener('click', action); return item; }
function performerSelect(id: string, performerIds: readonly string[]): HTMLSelectElement { const item = document.createElement('select'); item.id = id; performerIds.forEach((performerId) => { const option = document.createElement('option'); option.value = performerId; option.textContent = performerId; item.append(option); }); return item; }
function tableHead(values: readonly string[]): HTMLTableSectionElement { const head = document.createElement('thead'); const row = document.createElement('tr'); values.forEach((value) => row.append(text('th', value))); head.append(row); return head; }
