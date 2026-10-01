import type {
  Annotation,
  AnnotationScope,
  AnnotationVisibility,
  CommandStore,
  Dot,
  Identifier,
} from '../document/types';
import { createFieldTransform } from './field-geometry';
import { renderAnnotationOverlay } from './annotation-renderer';

const SVG_NS = 'http://www.w3.org/2000/svg';
type Tool = Annotation['kind'];
type PreviewKind = 'static-set' | 'active-transition' | 'show' | 'set-range';

export interface AnnotationEditorOptions {
  readonly store: CommandStore;
  readonly onCommitted: () => void;
  readonly setStatus: (message: string) => void;
}

/**
 * M6 annotation authoring is deliberately a normal form plus a field pointer
 * surface. Both paths construct the identical canonical-FU command; no screen
 * coordinate or active-page implicit scope is ever sent to the store.
 */
export function renderAnnotationEditor(options: AnnotationEditorOptions): HTMLElement {
  const { store, onCommitted, setStatus } = options;
  let selectedId: Identifier | undefined;
  let draw: { readonly pointerId: number; readonly start?: Dot; readonly points: Dot[] } | undefined;
  let nextNumber = 1;

  const root = document.createElement('section');
  root.className = 'annotation-editor';
  root.setAttribute('aria-labelledby', 'annotation-editor-title');
  const title = text('h2', 'Annotations, layers, and notes');
  title.id = 'annotation-editor-title';
  root.append(title, text('p', 'Use the form for keyboard entry, or choose a tool and draw on the field. Every mark has an explicit scope.'));

  const controls = document.createElement('div');
  controls.className = 'editor-controls';
  const annotationForm = document.createElement('form');
  annotationForm.className = 'editor-form';
  annotationForm.append(text('h3', 'Create or edit annotation'));

  const id = input('annotation-id', 'Annotation ID', 'text');
  id.value = nextAnnotationId();
  id.pattern = '[a-z][a-z0-9_-]{0,63}';
  id.required = true;
  const tool = select('annotation-tool', 'Annotation type', [
    ['freehand', 'Freehand stroke'], ['label', 'Structured label'], ['arrow', 'Arrow'], ['symbol', 'Reusable symbol'], ['performerNote', 'Performer note'],
  ]);
  const layer = select('annotation-layer', 'Layer', []);
  const scopeKind = select('annotation-scope-kind', 'Scope', [['set', 'This set only'], ['transition', 'This transition only'], ['show', 'Entire show']]);
  const scopeTarget = select('annotation-scope-target', 'Scope target', []);
  const performer = select('annotation-performer', 'Performer association', [['', 'No performer association']]);
  const visibilityEditor = checkbox('annotation-visible-editor', 'Show in editor', true);
  const visibilityPrint = checkbox('annotation-visible-print', 'Mark for future director output', true);
  const visibilityPacket = checkbox('annotation-visible-packet', 'Mark for future performer packet output', false);
  const textValue = document.createElement('textarea'); textValue.id = 'annotation-text'; textValue.rows = 2; textValue.maxLength = 10000;
  const symbol = select('annotation-symbol', 'Symbol definition', []);
  const x = input('annotation-x', 'Anchor X (FU)', 'number'); x.min = '0'; x.max = '288000'; x.step = '1';
  const y = input('annotation-y', 'Anchor Y (FU)', 'number'); y.min = '0'; y.max = '153600'; y.step = '1';
  const geometry = document.createElement('textarea'); geometry.id = 'annotation-geometry'; geometry.rows = 2;
  geometry.setAttribute('aria-label', 'Freehand or arrow points in FU');
  const rotation = input('annotation-rotation', 'Symbol rotation in degrees', 'number'); rotation.min = '0'; rotation.max = '360'; rotation.step = '1';
  const scale = input('annotation-scale', 'Symbol scale', 'number'); scale.min = '0.01'; scale.step = '0.01';
  const annotationSave = submit('Save annotation');
  const annotationLockHint = text('p', '', 'annotation-editor__hint');
  const hint = text('p', 'Choose where this mark lives. Set-scoped marks are not shown while a transition into or out of that set plays. Enter freehand or arrow points as integer x,y pairs separated by semicolons, or draw them on the preview. For a label, symbol, or note, enter or click one field position.', 'annotation-editor__hint');
  annotationForm.append(
    label(id, 'Annotation ID'), id, label(tool, 'Annotation type'), tool,
    label(layer, 'Layer'), layer, label(scopeKind, 'Scope'), scopeKind, label(scopeTarget, 'Scope target'), scopeTarget,
    label(performer, 'Performer association'), performer,
    visibilityEditor.label, visibilityEditor.input, visibilityPrint.label, visibilityPrint.input, visibilityPacket.label, visibilityPacket.input,
    label(textValue, 'Text for labels and notes'), textValue,
    label(symbol, 'Symbol definition'), symbol,
    label(x, 'Anchor X (FU)'), x, label(y, 'Anchor Y (FU)'), y,
    label(geometry, 'Freehand or arrow points (FU: x,y; x,y; …)'), geometry,
    label(rotation, 'Symbol rotation (degrees)'), rotation, label(scale, 'Symbol scale'), scale,
    hint, annotationLockHint, annotationSave,
  );
  controls.append(annotationForm);

  const previewPanel = document.createElement('section');
  previewPanel.className = 'annotation-preview';
  previewPanel.append(text('h3', 'Editor preview'));
  const previewKind = select('annotation-preview-kind', 'Preview context', [
    ['static-set', 'Static set'], ['active-transition', 'Active transition'], ['show', 'Show only'], ['set-range', 'Inclusive set range'],
  ]);
  const previewFirst = select('annotation-preview-first', 'Preview set or range start', []);
  const previewLast = select('annotation-preview-last', 'Preview range end', []);
  const previewTransition = select('annotation-preview-transition', 'Preview transition', []);
  const canvas = document.createElementNS(SVG_NS, 'svg');
  canvas.classList.add('annotation-preview__svg');
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Annotation drawing field. The form provides equivalent keyboard entry.');
  previewPanel.append(label(previewKind, 'Preview context'), previewKind, label(previewFirst, 'Set or range start'), previewFirst, label(previewLast, 'Range end'), previewLast, label(previewTransition, 'Transition'), previewTransition, text('p', 'Transition preview shows whole-show and transition marks only. It never shows marks scoped to either endpoint set.', 'annotation-editor__hint'), canvas);
  controls.append(previewPanel);
  root.append(controls);

  const layerPanel = document.createElement('section');
  layerPanel.className = 'annotation-manager';
  layerPanel.append(text('h3', 'Layer manager'));
  const newLayerId = input('new-layer-id', 'New layer ID', 'text'); newLayerId.value = 'layer-1'; newLayerId.required = true;
  const newLayerName = input('new-layer-name', 'New layer name', 'text'); newLayerName.required = true; newLayerName.value = 'Annotations';
  const layerCreate = document.createElement('form'); layerCreate.className = 'editor-form';
  layerCreate.append(label(newLayerId, 'Layer ID'), newLayerId, label(newLayerName, 'Layer name'), newLayerName, submit('Create layer'));
  const layerRows = document.createElement('div'); layerRows.className = 'annotation-manager__rows';
  layerPanel.append(layerCreate, layerRows);

  const symbolPanel = document.createElement('section');
  symbolPanel.className = 'annotation-manager';
  symbolPanel.append(text('h3', 'Reusable symbols'));
  const symbolId = input('new-symbol-id', 'Symbol ID', 'text'); symbolId.value = 'symbol-1'; symbolId.required = true;
  const symbolName = input('new-symbol-name', 'Symbol name', 'text'); symbolName.value = 'Marker'; symbolName.required = true;
  const glyph = input('new-symbol-glyph', 'Symbol glyph', 'text'); glyph.value = '★'; glyph.required = true; glyph.maxLength = 8000;
  const symbolCreate = document.createElement('form'); symbolCreate.className = 'editor-form';
  symbolCreate.append(label(symbolId, 'Symbol ID'), symbolId, label(symbolName, 'Symbol name'), symbolName, label(glyph, 'Glyph'), glyph, submit('Create symbol'));
  const symbolRows = document.createElement('div'); symbolRows.className = 'annotation-manager__rows';
  symbolPanel.append(symbolCreate, symbolRows);
  root.append(layerPanel, symbolPanel);

  const selectedPanel = document.createElement('section');
  selectedPanel.className = 'annotation-manager'; selectedPanel.append(text('h3', 'Annotation list'));
  const annotationRows = document.createElement('div'); annotationRows.className = 'annotation-manager__rows'; selectedPanel.append(annotationRows);
  root.append(selectedPanel);

  function nextAnnotationId(): string {
    while (store.getState().document.annotations.some((annotation) => annotation.id === `annotation-${nextNumber}`)) nextNumber += 1;
    return `annotation-${nextNumber}`;
  }

  function fillSelect(control: HTMLSelectElement, values: readonly (readonly [string, string])[], preserve = true): void {
    const value = control.value;
    control.replaceChildren();
    values.forEach(([entry, name]) => { const option = document.createElement('option'); option.value = entry; option.textContent = name; control.append(option); });
    if (preserve && values.some(([entry]) => entry === value)) control.value = value;
  }

  function refreshOptions(): void {
    const documentState = store.getState().document;
    fillSelect(layer, (documentState.layers ?? []).map((entry) => [entry.id, entry.name]));
    fillSelect(performer, [['', 'No performer association'], ...documentState.performers.map((entry) => [entry.id, `${entry.rankCode} — ${entry.displayName}`] as const)]);
    fillSelect(symbol, (documentState.symbols ?? []).map((entry) => [entry.id, `${entry.name} (${entry.glyph})`]));
    const sets = documentState.sets.map((entry) => [entry.id, entry.name] as const);
    const transitions = documentState.transitions.map((entry) => [entry.id, `${entry.fromSetId} → ${entry.toSetId}`] as const);
    fillSelect(scopeTarget, scopeKind.value === 'set' ? sets : scopeKind.value === 'transition' ? transitions : [['', 'No target']]);
    scopeTarget.disabled = scopeKind.value === 'show';
    fillSelect(previewFirst, sets);
    fillSelect(previewLast, sets);
    fillSelect(previewTransition, transitions);
    previewFirst.disabled = !['static-set', 'set-range'].includes(previewKind.value);
    previewLast.disabled = previewKind.value !== 'set-range';
    previewTransition.disabled = previewKind.value !== 'active-transition';
  }

  function configuredScope(): AnnotationScope {
    if (scopeKind.value === 'show') return { kind: 'show' };
    if (scopeKind.value === 'set') return { kind: 'set', setId: scopeTarget.value };
    return { kind: 'transition', transitionId: scopeTarget.value };
  }

  function configuredVisibility(): AnnotationVisibility {
    return { editor: visibilityEditor.input.checked, print: visibilityPrint.input.checked, performerPacket: visibilityPacket.input.checked };
  }

  function anchorFromFields(): Dot {
    const anchor = { x: Number(x.value), y: Number(y.value) };
    if (!Number.isInteger(anchor.x) || !Number.isInteger(anchor.y)) throw new Error('Enter integer anchor X and Y field units.');
    return anchor;
  }

  function pointsFromFields(): readonly Dot[] {
    const value = geometry.value.trim();
    if (!value) throw new Error('Enter at least two integer x,y points in field units.');
    const points = value.split(';').map((entry) => {
      const [rawX, rawY, ...extra] = entry.trim().split(',').map((coordinate) => coordinate.trim());
      if (extra.length || rawX === undefined || rawY === undefined || rawX === '' || rawY === '') {
        throw new Error('Write points as integer x,y pairs separated by semicolons.');
      }
      const point = { x: Number(rawX), y: Number(rawY) };
      if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) throw new Error('Geometry points must use integer field units.');
      return point;
    });
    if (points.length < 2) throw new Error('Enter at least two points for this annotation.');
    return points;
  }

  function optionalNumber(control: HTMLInputElement): number | undefined {
    if (control.value.trim() === '') return undefined;
    const value = Number(control.value);
    if (!Number.isFinite(value)) throw new Error(`${control.getAttribute('aria-label')} must be a number.`);
    return value;
  }

  function draftAnnotation(geometry?: readonly Dot[]): Annotation {
    const visibility = configuredVisibility();
    const common = { id: id.value.trim(), layerId: layer.value, scope: configuredScope(), visibility };
    const performerId = performer.value || undefined;
    if (visibility.performerPacket && !performerId) {
      throw new Error('Choose a performer before marking this for future performer packet output.');
    }
    switch (tool.value as Tool) {
      case 'freehand': {
        const points = geometry ?? pointsFromFields();
        if (points.length < 2) throw new Error('Enter or draw at least two points for a freehand stroke.');
        return { ...common, kind: 'freehand', strokes: [points], ...(performerId ? { performerId } : {}) };
      }
      case 'arrow': {
        const points = geometry ?? pointsFromFields();
        if (points.length < 2) throw new Error('Enter or draw an arrow tail and head.');
        return { ...common, kind: 'arrow', points, ...(performerId ? { performerId } : {}) };
      }
      case 'label': return { ...common, kind: 'label', text: textValue.value, anchor: anchorFromFields(), ...(performerId ? { performerId } : {}) };
      case 'symbol': {
        const rotationDegrees = optionalNumber(rotation);
        const symbolScale = optionalNumber(scale);
        return {
          ...common, kind: 'symbol', symbolId: symbol.value, anchor: anchorFromFields(),
          ...(rotationDegrees === undefined ? {} : { rotationDegrees }),
          ...(symbolScale === undefined ? {} : { scale: symbolScale }),
          ...(performerId ? { performerId } : {}),
        };
      }
      case 'performerNote':
        if (!performerId) throw new Error('Choose a performer for a performer note.');
        return { ...common, kind: 'performerNote', performerId, text: textValue.value, anchor: anchorFromFields() };
    }
  }

  function commit(annotation: Annotation): void {
    try {
      const existing = store.getState().document.annotations.some((entry) => entry.id === annotation.id);
      store.apply(existing ? { type: 'annotation.update', annotation } : { type: 'annotation.create', annotation });
      selectedId = annotation.id;
      nextNumber += 1;
      setStatus(`${existing ? 'Updated' : 'Created'} ${annotation.kind} annotation ${annotation.id}.`);
      id.value = nextAnnotationId();
      onCommitted();
      refresh();
    } catch (error) { setStatus(userFacingError(error, 'Could not save annotation.')); refresh(); }
  }

  annotationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    try { commit(draftAnnotation()); }
    catch (error) { setStatus(userFacingError(error, 'Could not save annotation.')); }
  });
  scopeKind.addEventListener('change', () => { refreshOptions(); syncAnnotationEditability(); redraw(); });
  layer.addEventListener('change', syncAnnotationEditability);
  previewKind.addEventListener('change', () => { refreshOptions(); redraw(); });
  [previewFirst, previewLast, previewTransition].forEach((control) => control.addEventListener('change', redraw));

  function addFieldSkeleton(): void {
    const documentState = store.getState().document;
    const transform = createFieldTransform(documentState.field);
    canvas.replaceChildren();
    canvas.setAttribute('viewBox', transform.viewBox);
    const lower = transform.toPixel({ x: 0, y: 0 });
    const upper = transform.toPixel({ x: documentState.field.lengthUnits, y: documentState.field.widthUnits });
    const boundary = document.createElementNS(SVG_NS, 'rect'); boundary.setAttribute('class', 'annotation-preview__boundary');
    boundary.setAttribute('x', String(Math.min(lower.x, upper.x))); boundary.setAttribute('y', String(Math.min(lower.y, upper.y)));
    boundary.setAttribute('width', String(Math.abs(upper.x - lower.x))); boundary.setAttribute('height', String(Math.abs(upper.y - lower.y))); canvas.append(boundary);
  }

  function previewSelection() {
    const kind = previewKind.value as PreviewKind;
    if (kind === 'show') return { audience: 'editor' as const, context: { kind: 'show' as const } };
    if (kind === 'active-transition') return { audience: 'editor' as const, context: { kind: 'active-transition' as const, transitionId: previewTransition.value } };
    if (kind === 'set-range') return { audience: 'editor' as const, context: { kind: 'set-range' as const, firstSetId: previewFirst.value, lastSetId: previewLast.value } };
    return { audience: 'editor' as const, context: { kind: 'static-set' as const, setId: previewFirst.value } };
  }

  function redraw(): void {
    addFieldSkeleton();
    try { renderAnnotationOverlay(canvas, store.getState().document, previewSelection()); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not render annotation preview.'); }
    canvas.querySelectorAll<SVGGElement>('[data-annotation-id]').forEach((entry) => entry.addEventListener('pointerdown', (event) => {
      event.stopPropagation(); selectedId = entry.dataset.annotationId; refreshRows();
    }));
  }

  function clientToDot(event: PointerEvent): Dot {
    const transform = createFieldTransform(store.getState().document.field);
    const rect = canvas.getBoundingClientRect();
    return transform.toFieldUnits({ x: (event.clientX - rect.left) * (transform.widthPx / (rect.width || transform.widthPx)), y: (event.clientY - rect.top) * (transform.heightPx / (rect.height || transform.heightPx)) });
  }

  canvas.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('[data-annotation-id]')) return;
    const point = clientToDot(event); const selectedTool = tool.value as Tool;
    if (selectedTool === 'label' || selectedTool === 'symbol' || selectedTool === 'performerNote') {
      x.value = String(point.x); y.value = String(point.y);
      try { commit(draftAnnotation()); } catch (error) { setStatus(userFacingError(error, 'Could not save annotation.')); }
      return;
    }
    draw = { pointerId: event.pointerId, ...(selectedTool === 'arrow' ? { start: point } : {}), points: [point] };
    canvas.setPointerCapture?.(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => { if (draw?.pointerId === event.pointerId) draw.points.push(clientToDot(event)); });
  canvas.addEventListener('pointerup', (event) => {
    if (!draw || draw.pointerId !== event.pointerId) return;
    const current = draw; draw = undefined; canvas.releasePointerCapture?.(event.pointerId);
    const end = clientToDot(event); const points = (tool.value as Tool) === 'arrow' ? [current.start!, end] : [...current.points, end];
    try { commit(draftAnnotation(points)); } catch (error) { setStatus(userFacingError(error, 'Could not save annotation.')); }
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (!draw || draw.pointerId !== event.pointerId) return;
    draw = undefined; canvas.releasePointerCapture?.(event.pointerId); redraw();
  });

  layerCreate.addEventListener('submit', (event) => {
    event.preventDefault();
    try { store.apply({ type: 'layer.create', layer: { id: newLayerId.value.trim(), name: newLayerName.value.trim(), visible: true, print: true, locked: false } }); setStatus(`Created layer ${newLayerName.value.trim()}.`); onCommitted(); refresh(); }
    catch (error) { setStatus(userFacingError(error, 'Could not create layer.')); }
  });
  symbolCreate.addEventListener('submit', (event) => {
    event.preventDefault();
    try { store.apply({ type: 'symbol.create', symbol: { id: symbolId.value.trim(), name: symbolName.value.trim(), glyph: glyph.value } }); setStatus(`Created symbol ${symbolName.value.trim()}.`); onCommitted(); refresh(); }
    catch (error) { setStatus(userFacingError(error, 'Could not create symbol.')); }
  });

  function run(action: () => void): void { try { action(); onCommitted(); refresh(); } catch (error) { setStatus(userFacingError(error, 'Could not apply command.')); } }
  function refreshRows(): void {
    const documentState = store.getState().document;
    layerRows.replaceChildren();
    (documentState.layers ?? []).forEach((entry, index) => {
      const row = document.createElement('form'); row.className = 'annotation-manager__row';
      const name = input(`layer-name-${entry.id}`, `Layer ${entry.id} name`, 'text'); name.value = entry.name;
      const visible = checkbox(`layer-visible-${entry.id}`, 'Visible in editor', entry.visible);
      const printable = checkbox(`layer-print-${entry.id}`, 'Mark layer for future director output', entry.print);
      const locked = checkbox(`layer-locked-${entry.id}`, 'Locked', entry.locked);
      const save = submit('Save layer');
      const earlier = button('Move earlier', () => run(() => store.apply({ type: 'layer.reorder', layerId: entry.id, index: Math.max(0, index - 1) })));
      const later = button('Move later', () => run(() => store.apply({ type: 'layer.reorder', layerId: entry.id, index: index + 1 })));
      const remove = button('Delete layer', () => run(() => store.apply({ type: 'layer.remove', layerId: entry.id })));
      earlier.disabled = index === 0;
      later.disabled = index === (documentState.layers?.length ?? 0) - 1;
      if (entry.locked) {
        name.disabled = true; visible.input.disabled = true; printable.input.disabled = true; save.disabled = true; earlier.disabled = true; later.disabled = true; remove.disabled = true;
        row.append(text('span', 'Unlock this layer to edit its name, visibility, output flag, order, or marks.', 'annotation-editor__hint'));
      }
      row.append(text('strong', entry.id), name, visible.label, visible.input, printable.label, printable.input, locked.label, locked.input, save);
      row.addEventListener('submit', (event) => { event.preventDefault(); run(() => store.apply({ type: 'layer.update', layer: { id: entry.id, name: name.value, visible: visible.input.checked, print: printable.input.checked, locked: locked.input.checked } })); });
      locked.input.addEventListener('change', () => run(() => store.apply({ type: 'layer.update', layer: { id: entry.id, name: entry.name, visible: entry.visible, print: entry.print, locked: locked.input.checked } })));
      row.append(earlier, later, remove);
      layerRows.append(row);
    });
    symbolRows.replaceChildren();
    (documentState.symbols ?? []).forEach((entry) => {
      const row = document.createElement('form'); row.className = 'annotation-manager__row';
      const name = input(`symbol-name-${entry.id}`, `Symbol ${entry.id} name`, 'text'); name.value = entry.name;
      const value = input(`symbol-glyph-${entry.id}`, `Symbol ${entry.id} glyph`, 'text'); value.value = entry.glyph;
      row.append(text('strong', entry.id), name, value, submit('Save symbol'));
      row.addEventListener('submit', (event) => { event.preventDefault(); run(() => store.apply({ type: 'symbol.update', symbol: { id: entry.id, name: name.value, glyph: value.value } })); });
      row.append(button('Delete symbol', () => run(() => store.apply({ type: 'symbol.remove', symbolId: entry.id })))); symbolRows.append(row);
    });
    annotationRows.replaceChildren();
    documentState.annotations.forEach((entry) => {
      const row = document.createElement('div'); row.className = 'annotation-manager__row'; if (entry.id === selectedId) row.classList.add('is-selected');
      const selectAnnotation = button('Select', () => { selectedId = entry.id; loadAnnotation(entry); refreshRows(); redraw(); });
      const deleteAnnotation = button('Delete annotation', () => run(() => store.apply({ type: 'annotation.remove', annotationId: entry.id })));
      const annotationLayer = documentState.layers?.find((candidate) => candidate.id === entry.layerId);
      if (annotationLayer?.locked) {
        deleteAnnotation.disabled = true;
        row.append(text('span', `Unlock ${annotationLayer.name} to edit or delete its marks.`, 'annotation-editor__hint'));
      }
      row.append(text('strong', `${entry.kind}: ${entry.id}`), text('span', `${entry.scope.kind} · ${entry.layerId}`), selectAnnotation, deleteAnnotation); annotationRows.append(row);
    });
    syncAnnotationEditability();
  }

  function loadAnnotation(annotation: Annotation): void {
    id.value = annotation.id; tool.value = annotation.kind; layer.value = annotation.layerId; scopeKind.value = annotation.scope.kind; refreshOptions();
    if (annotation.scope.kind !== 'show') scopeTarget.value = annotation.scope.kind === 'set' ? annotation.scope.setId : annotation.scope.transitionId;
    performer.value = annotation.performerId ?? ''; visibilityEditor.input.checked = annotation.visibility.editor; visibilityPrint.input.checked = annotation.visibility.print; visibilityPacket.input.checked = annotation.visibility.performerPacket;
    if ('text' in annotation) textValue.value = annotation.text; if ('symbolId' in annotation) symbol.value = annotation.symbolId;
    const anchor = 'anchor' in annotation ? annotation.anchor : annotation.kind === 'arrow' ? annotation.points[0] : annotation.strokes[0]?.[0];
    if (anchor) { x.value = String(anchor.x); y.value = String(anchor.y); }
    if (annotation.kind === 'freehand') geometry.value = annotation.strokes[0]?.map((point) => `${point.x},${point.y}`).join('; ') ?? '';
    if (annotation.kind === 'arrow') geometry.value = annotation.points.map((point) => `${point.x},${point.y}`).join('; ');
    if (annotation.kind === 'symbol') { rotation.value = annotation.rotationDegrees === undefined ? '' : String(annotation.rotationDegrees); scale.value = annotation.scale === undefined ? '' : String(annotation.scale); }
    syncAnnotationEditability();
  }

  function syncAnnotationEditability(): void {
    const documentState = store.getState().document;
    const selected = selectedId ? documentState.annotations.find((annotation) => annotation.id === selectedId) : undefined;
    const selectedLayer = selected ? documentState.layers?.find((entry) => entry.id === selected.layerId) : undefined;
    const targetLayer = documentState.layers?.find((entry) => entry.id === layer.value);
    const selectedLocked = Boolean(selectedLayer?.locked);
    const targetLocked = Boolean(targetLayer?.locked);
    [id, tool, layer, scopeKind, scopeTarget, performer, visibilityEditor.input, visibilityPrint.input, visibilityPacket.input, textValue, symbol, x, y, geometry, rotation, scale]
      .forEach((control) => { control.disabled = selectedLocked; });
    annotationSave.disabled = selectedLocked || targetLocked;
    if (selectedLocked) annotationLockHint.textContent = `Unlock ${selectedLayer!.name} in the layer manager before editing this annotation.`;
    else if (targetLocked) annotationLockHint.textContent = `Unlock ${targetLayer!.name} in the layer manager before adding an annotation to it.`;
    else annotationLockHint.textContent = '';
  }

  function refresh(): void { refreshOptions(); refreshRows(); redraw(); }
  refresh();
  return root;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; }
function input(id: string, labelText: string, type: string): HTMLInputElement { const node = document.createElement('input'); node.id = id; node.type = type; node.setAttribute('aria-label', labelText); return node; }
function select(id: string, labelText: string, values: readonly (readonly [string, string])[]): HTMLSelectElement { const node = document.createElement('select'); node.id = id; node.setAttribute('aria-label', labelText); values.forEach(([value, name]) => { const option = document.createElement('option'); option.value = value; option.textContent = name; node.append(option); }); return node; }
function label(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): HTMLLabelElement { const node = document.createElement('label'); node.htmlFor = control.id; node.textContent = value; return node; }
function checkbox(id: string, value: string, checked: boolean): { readonly input: HTMLInputElement; readonly label: HTMLLabelElement } { const node = input(id, value, 'checkbox'); node.checked = checked; return { input: node, label: label(node, value) }; }
function submit(value: string): HTMLButtonElement { const node = document.createElement('button'); node.type = 'submit'; node.textContent = value; return node; }
function button(value: string, action: () => void): HTMLButtonElement { const node = document.createElement('button'); node.type = 'button'; node.textContent = value; node.addEventListener('click', action); return node; }

/** Known command errors receive friendly action guidance; unknown errors remain intact. */
function userFacingError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const locked = /^Layer ([a-z0-9_-]+) is locked\.$/.exec(error.message);
  if (locked) return `${locked[1]} is locked. Unlock it before changing annotations on this layer.`;
  if (error.message === 'Performer packet visibility requires a performer ID.') {
    return 'Choose a performer before marking this for future performer packet output.';
  }
  return error.message;
}
