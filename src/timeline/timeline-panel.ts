import type { CommandStore, Dot, Identifier, Transition } from '../document/types';
import { calculatePairDistance, calculateTransitionStepStatuses } from './float';
import { calculateFtlStepSizeStatus, deriveFtlOffsets, samplePolyline, validateFtlTransition } from './ftl';
import { analyzeTransitionCollisions, type CollisionWarning } from './collision';
import { createPlaybackController, type PlaybackController } from './playback';
import { renderAnnotationContextView } from '../editor/annotation-renderer';

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
  let overridePairKey: string | undefined;

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
      // The app-level refresh replaces the timeline DOM. Do not destroy focus
      // from an in-progress threshold/override edit just to paint a playback tick.
      if (!isDraftEditorFocused()) refresh();
    }, 500);
  };

  return {
    handleKeyDown(event) {
      const controller = getPlayback();
      if (controller?.handleKeyDown(event)) {
        if (event.key === ' ' || event.key === 'Spacebar') {
          if (controller.getState().isPlaying) play(); else clearTimer();
        } else if (!controller.getState().isPlaying) {
          clearTimer();
        }
        refresh();
      }
    },
    render() {
      const currentDocument = store.getState().document;
      const panel = element('section');
      panel.setAttribute('aria-labelledby', 'timeline-title');
      const title = text('h2', 'Transition timeline');
      title.id = 'timeline-title';
      panel.append(title, text('p', 'Float and FTL playback: Space play/pause; Left/Right previous/next count.'));

      const authoring = element('div', 'editor-controls');
      authoring.append(createSetForm(), createTransitionForm(), createFtlTransitionForm());
      panel.append(authoring);

      const transition = getTransition();
      if (!transition) {
        panel.append(text('p', 'Create a second fully covered set, then create its float or FTL transition to enable playback.'));
        return panel;
      }
      if (transition.mode === 'ftl') {
        try {
          validateFtlTransition(currentDocument, transition);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid FTL transition.';
          panel.append(text('p', `FTL playback blocked: ${message}`));
          panel.append(createCollisionDisclosure(currentDocument, transition));
          return panel;
        }
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
      panel.append(renderAnnotationContextView(
        currentDocument,
        { audience: 'editor', context: { kind: 'active-transition', transitionId: transition.id } },
        'Showing whole-show and this transition’s marks. Marks scoped to either endpoint set are not shown while this transition plays.',
      ));

      const sampleTable = element('table', 'inspection-table');
      sampleTable.append(tableHead(['Rank', 'Sample position (FU)', 'Step-size status']));
      const sampleBody = document.createElement('tbody');
      const statuses = transition.mode === 'float'
        ? new Map(calculateTransitionStepStatuses(currentDocument, transition).map((status) => [status.performerId, status]))
        : new Map(currentDocument.performers.map(({ id }) => {
          const ftlStatus = calculateFtlStepSizeStatus(transition);
          const band = ftlStatus.commonStepSize >= 6.1 ? 'green' : ftlStatus.commonStepSize <= 4.0 ? 'red' : 'yellow';
          return [id, { performerId: id, stepSize: ftlStatus.commonStepSize, label: ftlStatus.label, band }];
        }));
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
      panel.append(sampleTable);
      if (transition.mode === 'ftl') panel.append(createFtlInspection(transition));
      panel.append(createCollisionDisclosure(currentDocument, transition));
      panel.append(createPairDistanceForm(state.sample.positions));
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

  function createFtlTransitionForm(): HTMLFormElement {
    const currentDocument = store.getState().document;
    const form = element('form', 'editor-form');
    form.append(text('h3', 'Create FTL path transition'));
    const pairs = currentDocument.sets.slice(0, -1).map((from, index) => ({ from, to: currentDocument.sets[index + 1]! }));
    const pair = document.createElement('select'); pair.id = 'ftl-adjacent-sets'; pair.setAttribute('aria-label', 'FTL adjacent sets');
    pairs.forEach(({ from, to }) => {
      const option = document.createElement('option'); option.value = `${from.id}:${to.id}`; option.textContent = `${from.name} → ${to.name}`; pair.append(option);
    });
    const leader = performerSelect('ftl-leader', currentDocument.performers.map(({ id }) => id));
    if (currentDocument.performers.at(-1)) leader.value = currentDocument.performers.at(-1)!.id;
    const followers = document.createElement('textarea'); followers.id = 'ftl-followers'; followers.rows = 2;
    followers.setAttribute('aria-label', 'FTL follower IDs in formation order');
    const path = document.createElement('textarea'); path.id = 'ftl-path'; path.rows = 3;
    path.setAttribute('aria-label', 'FTL path points in FU');
    const distance = input('ftl-distance', 'Common path distance (FU)', 'number');
    distance.required = true; distance.min = '1'; distance.step = '1'; distance.value = '28800';
    const updateFormationDefaults = (): void => {
      followers.value = currentDocument.performers.map(({ id }) => id).filter((id) => id !== leader.value).join(', ');
      const [fromSetId] = pair.value.split(':');
      const start = currentDocument.sets.find(({ id }) => id === fromSetId)?.positions[leader.value];
      if (start) path.value = `${start.x},${start.y}; ${Math.max(0, start.x - 86400)},${start.y}`;
    };
    leader.addEventListener('change', updateFormationDefaults);
    pair.addEventListener('change', updateFormationDefaults);
    updateFormationDefaults();
    form.append(
      label(pair, 'Adjacent sets'), pair,
      label(leader, 'Leader'), leader,
      label(followers, 'Follower IDs in formation order (comma-separated)'), followers,
      label(path, 'Path points in FU (x,y; x,y; …)'), path,
      label(distance, 'Common distance (FU)'), distance,
      submit('Derive offsets and create FTL transition'),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const [fromSetId, toSetId] = pair.value.split(':');
        const from = currentDocument.sets.find(({ id }) => id === fromSetId);
        const to = currentDocument.sets.find(({ id }) => id === toSetId);
        if (!from || !to) throw new Error('Choose adjacent FTL sets.');
        const followerIds = followers.value.split(',').map((id) => id.trim()).filter(Boolean);
        const pathPoints = parseFtlPath(path.value);
        const members = [leader.value, ...followerIds];
        const offsetUnits = deriveFtlOffsets(pathPoints, members, from.positions);
        const transition: Transition = {
          id: `ftl-${fromSetId}-${toSetId}`,
          fromSetId,
          toSetId,
          counts: to.startCount - from.startCount,
          mode: 'ftl',
          ftl: {
            leaderId: leader.value,
            followerIds,
            offsetUnits,
            distanceUnits: Number(distance.value),
            path: pathPoints,
            expectedEndPositions: structuredClone(to.positions),
          },
        };
        // Creation is strict: target dots either match the derived end now, or
        // the writer must correct them before committing the new transition.
        validateFtlTransition(currentDocument, transition);
        store.apply({ type: 'transition.create', transition });
        activeTransitionId = transition.id;
        setStatus(`Created FTL transition with formation order ${members.join(' → ')} and derived offsets ${members.map((id) => `${id}=${offsetUnits[id]!.toFixed(3)}`).join(', ')} FU.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not create FTL transition.');
      }
      refresh();
    });
    return form;
  }

  function createFtlInspection(transition: Transition): HTMLElement {
    const ftl = transition.ftl!;
    const section = element('section');
    section.append(text('h3', `FTL formation order — ${calculateFtlStepSizeStatus(transition).label}`));
    const table = element('table', 'inspection-table');
    table.append(tableHead(['Formation member', 'Offset (FU)', 'Derived end (FU)']));
    const body = document.createElement('tbody');
    [ftl.leaderId, ...ftl.followerIds].forEach((performerId) => {
      const row = document.createElement('tr');
      const end = samplePolyline(ftl.path, ftl.offsetUnits[performerId]! + ftl.distanceUnits);
      row.append(
        text('th', performerId),
        text('td', ftl.offsetUnits[performerId]!.toFixed(3)),
        text('td', `(${end.x.toFixed(3)}, ${end.y.toFixed(3)})`),
      );
      body.append(row);
    });
    table.append(body); section.append(table);
    return section;
  }

  function createCollisionDisclosure(currentDocument: ReturnType<CommandStore['getState']>['document'], transition: Transition): HTMLElement {
    const details = element('details', 'collision-panel');
    details.open = true;
    const totalPairs = currentDocument.performers.length * (currentDocument.performers.length - 1) / 2;
    try {
      const analysis = analyzeTransitionCollisions(currentDocument, transition);
      details.append(text('summary', `Collision warnings — ${analysis.warnings.length} of ${totalPairs} pairs`));
      details.append(text('p', 'Collision analysis is advisory sampled detection. A warning is not a claim that a collision was prevented.'));
      details.append(createCollisionThresholdForm());
      if (analysis.warnings.length === 0) {
        details.append(text('p', 'No collision warnings were found on the required sampled grid.'));
        return details;
      }
      const table = element('table', 'inspection-table collision-table');
      const caption = text('caption', `Collision warnings for ${transition.id}; threshold ${currentDocument.settings.collisionThresholdUnits} FU.`);
      table.append(caption, tableHead(['Pair', 'Closest sampled approach', 'Status', 'Override']));
      const body = document.createElement('tbody');
      const rankCodes = new Map(currentDocument.performers.map(({ id, rankCode }) => [id, rankCode]));
      analysis.warnings.forEach((warning) => body.append(createCollisionWarningRow(warning, transition, rankCodes)));
      table.append(body); details.append(table);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown collision-analysis failure.';
      details.append(text('summary', `Collision warnings — analysis unavailable for ${transition.id}`));
      details.append(text('p', `Collision analysis unavailable: ${message}`));
    }
    return details;
  }

  function createCollisionThresholdForm(): HTMLFormElement {
    const form = element('form', 'editor-form');
    const threshold = input('collision-threshold', 'Collision warning threshold (FU)', 'number');
    threshold.min = '1'; threshold.max = '28800'; threshold.step = '1';
    threshold.value = String(store.getState().document.settings.collisionThresholdUnits);
    const hint = text('p', 'Default 2880 FU (one yard). This threshold applies to the whole document.');
    hint.id = 'collision-threshold-hint'; threshold.setAttribute('aria-describedby', hint.id);
    form.append(label(threshold, 'Collision warning threshold (FU)'), threshold, hint, submit('Apply threshold'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        store.apply({ type: 'settings.collision-threshold.set', collisionThresholdUnits: Number(threshold.value) });
        setStatus('Updated the document collision warning threshold.');
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not update collision threshold.'); }
      refresh();
    });
    return form;
  }

  function createCollisionWarningRow(
    warning: CollisionWarning,
    transition: Transition,
    rankCodes: ReadonlyMap<string, string>,
  ): HTMLTableRowElement {
    const row = document.createElement('tr');
    const pairKey = warning.performerIds.join(':');
    const pair = text('th', `${rankCodes.get(warning.performerIds[0]) ?? warning.performerIds[0]} × ${rankCodes.get(warning.performerIds[1]) ?? warning.performerIds[1]}`);
    pair.scope = 'row'; pair.title = warning.performerIds.join(', ');
    const approach = text('td', `${warning.closestDistanceFU.toFixed(3)} FU at count ${warning.sampleCount.toFixed(3)} (t=${warning.t.toFixed(4)}).`);
    const status = text('td', warning.overridden ? '⚠ Warning — override recorded' : '⚠ Warning');
    status.className = 'collision-status collision-status--warning';
    const overrideCell = document.createElement('td');
    const staleOverride = transition.collisionOverrides?.find((override) => (
      override.performerIds[0] === warning.performerIds[0]
      && override.performerIds[1] === warning.performerIds[1]
      && override.warningSignature !== warning.warningSignature
    ));
    if (warning.override) {
      overrideCell.append(text('p', `Override recorded by ${warning.override.authorLabel} at ${warning.override.overriddenAt}.`));
      overrideCell.append(text('p', `Reason: ${warning.override.reason}`));
      const revise = button('Override recorded — revise', () => { overridePairKey = pairKey; refresh(); });
      overrideCell.append(revise);
    } else {
      if (staleOverride) overrideCell.append(text('p', 'Override recorded for different warning inputs — review.'));
      overrideCell.append(button(staleOverride ? 'Record replacement override' : 'Record override', () => { overridePairKey = pairKey; refresh(); }));
    }
    if (overridePairKey === pairKey) overrideCell.append(createCollisionOverrideForm(warning, transition));
    row.append(pair, approach, status, overrideCell);
    return row;
  }

  function createCollisionOverrideForm(warning: CollisionWarning, transition: Transition): HTMLFormElement {
    const form = element('form', 'editor-form');
    const key = warning.performerIds.join('-');
    const actor = input(`override-actor-${key}`, 'Your name', 'text'); actor.required = true; actor.maxLength = 120;
    const reason = document.createElement('textarea'); reason.id = `override-reason-${key}`; reason.required = true; reason.rows = 2; reason.maxLength = 1000;
    form.append(
      label(actor, 'Your name (local actor label)'), actor,
      label(reason, 'Reason for override'), reason,
      submit('Record override'),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        store.apply({ type: 'collision.override.record', transitionId: transition.id, override: {
          performerIds: warning.performerIds,
          warningSignature: warning.warningSignature,
          reason: reason.value,
          authorLabel: actor.value,
          overriddenAt: new Date().toISOString(),
        } });
        overridePairKey = undefined;
        setStatus(`Recorded an advisory collision-warning override for ${warning.performerIds.join(' and ')}.`);
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not record collision override.'); }
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
function label(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): HTMLLabelElement { const item = document.createElement('label'); item.htmlFor = control.id; item.textContent = value; return item; }
function submit(value: string): HTMLButtonElement { const item = document.createElement('button'); item.type = 'submit'; item.textContent = value; return item; }
function button(value: string, action: () => void): HTMLButtonElement { const item = document.createElement('button'); item.type = 'button'; item.textContent = value; item.addEventListener('click', action); return item; }
function performerSelect(id: string, performerIds: readonly string[]): HTMLSelectElement { const item = document.createElement('select'); item.id = id; performerIds.forEach((performerId) => { const option = document.createElement('option'); option.value = performerId; option.textContent = performerId; item.append(option); }); return item; }
function tableHead(values: readonly string[]): HTMLTableSectionElement { const head = document.createElement('thead'); const row = document.createElement('tr'); values.forEach((value) => row.append(text('th', value))); head.append(row); return head; }

function parseFtlPath(value: string): readonly Dot[] {
  const points = value.split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const values = entry.split(',').map((coordinate) => Number(coordinate.trim()));
    if (values.length !== 2 || !values.every(Number.isInteger)) throw new Error('Each FTL path point must be written as integer x,y FU values.');
    return { x: values[0]!, y: values[1]! };
  });
  if (points.length < 2) throw new Error('An FTL path needs at least two x,y points.');
  return points;
}

function isDraftEditorFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  return active instanceof HTMLElement && (
    active.id === 'collision-threshold'
    || active.id.startsWith('override-actor-')
    || active.id.startsWith('override-reason-')
    || active.closest('.annotation-editor') !== null
  );
}
