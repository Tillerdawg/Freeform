import type { CommandStore, FreeformDocument } from '../document/types';
import type { FeatureReport } from '../platform/features';
import { createEmptyDocument, renderSetupWizard } from '../editor/setup-wizard';
import { renderDotEditor } from '../editor/dot-editor';
import { browserDownload, freeformFilename, saveExplicitSnapshot, type SaveFileHandle } from './save-adapter';
import { createAncestryStore, type AncestryStore } from './ancestry-store';
import { createAutosaveScheduler, type AutosaveScheduler } from './autosave-scheduler';
import { createBackupService, type BackupDirectoryHandle, type BackupReminderState, type BackupService } from './backup-service';
import { observeCommandStore } from './command-store-bridge';
import { runWithDestructiveCheckpoint } from './destructive-checkpoint';
import { FreeformFileError, decodeDocument, type DecodeResult } from './freeform-file';
import { openPersistenceAdapter, type PersistenceAdapter } from './idb-adapter';
import { createRecoveryService, type RecoveryCandidate, type RecoveryService } from './recovery-service';
import { createVersionHistoryStore, type CheckpointRecord, type VersionHistoryStore } from './version-history-store';
import { writeWorkingCopy, type WriteOutcome } from './working-copy-store';

export interface PersistenceUi {
  readonly store: CommandStore;
  start(): void;
  dispose(): void;
  renderControls(): HTMLElement;
}

/**
 * Browser lifecycle glue for the reviewed M7.1/M7.2 services. It deliberately
 * keeps the command store as the sole document mutation boundary: persistence
 * observes committed commands and never mutates documents behind the editor.
 */
export function createPersistenceUi(root: HTMLElement, store: CommandStore, report: FeatureReport): PersistenceUi {
  let adapter: PersistenceAdapter | undefined;
  let ancestry: AncestryStore | undefined;
  let history: VersionHistoryStore | undefined;
  let recovery: RecoveryService | undefined;
  let backup: BackupService | undefined;
  let scheduler: AutosaveScheduler | undefined;
  let activeHandle: SaveFileHandle | undefined;
  let backupDestination: BackupDirectoryHandle | undefined;
  let currentDocumentId = store.getState().document.show.id;
  // The blank first-run document is not an unsaved replacement target. Once
  // setup or any edit commits, its revision diverges and becomes dirty.
  let savedRevision: number | undefined = store.getState().revision;
  let localState: 'saved' | 'dirty' | 'saving' | 'failed' = 'dirty';
  let localFailure = '';
  let message = '';
  let readOnly: Readonly<{ bytes: Uint8Array; formatVersion: string }> | undefined;
  let candidates: readonly RecoveryCandidate[] = [];
  let checkpoints: readonly CheckpointRecord[] = [];
  let reminder: BackupReminderState = { documentId: currentDocumentId };
  let disposed = false;


  const observed = observeCommandStore(store, (event) => {
    if (readOnly) return;
    currentDocumentId = event.state.document.show.id;
    savedRevision = savedRevision === undefined ? undefined : savedRevision;
    if (event.state.revision !== savedRevision) localState = 'dirty';
    reminder = reminder.unsavedOriginSince === undefined
      ? { ...reminder, documentId: currentDocumentId, unsavedOriginSince: Date.now() }
      : { ...reminder, documentId: currentDocumentId };
    scheduler?.noteEdit();
    refreshControls();
  });

  function start(): void {
    root.addEventListener('keydown', handleShortcut);
    renderSetup();
    void initialisePersistence();
  }

  function dispose(): void {
    disposed = true;
    root.removeEventListener('keydown', handleShortcut);
    scheduler?.dispose();
    adapter?.close();
  }

  function handleShortcut(event: KeyboardEvent): void {
    if (readOnly || !(event.ctrlKey || event.metaKey) || isTextEditing(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      void save('save');
    } else if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      observed.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      observed.redo();
    }
  }

  async function initialisePersistence(): Promise<void> {
    try {
      adapter = await openPersistenceAdapter();
      if (disposed) {
        adapter.close();
        return;
      }
      ancestry = createAncestryStore(adapter);
      history = createVersionHistoryStore(adapter, { now: Date.now });
      recovery = createRecoveryService(adapter, ancestry);
      backup = createBackupService({ now: Date.now });
      scheduler = createAutosaveScheduler({ onFlush: () => { void flushWorkingCopy(); } });
      await refreshCandidates();
    } catch (error) {
      if (disposed) return;
      localState = 'failed';
      localFailure = 'This browser\'s local storage isn\'t available right now (this can happen in a private/incognito window). Your edits are only safe in this tab until you save your file — save often.';
      refreshControls();
    }
  }

  function renderSetup(): void {
    readOnly = undefined;
    renderSetupWizard(root, { store: observed, onComplete: () => renderEditor() });
    if (candidates.length > 0) root.append(renderRecoveryPanel());
  }

  function renderEditor(): void {
    if (readOnly) {
      renderReadOnly();
      return;
    }
    renderDotEditor(root, { store: observed, report, renderPersistenceControls });
  }

  function renderReadOnly(): void {
    const state = readOnly;
    if (!state) return;
    root.replaceChildren();
    const shell = element('section', 'app-shell');
    const banner = element('section', 'persistence-read-only');
    banner.append(
      text('h1', 'Read-only: newer file format'),
      text('p', `This show was saved with Freeform format ${state.formatVersion}, which is newer than this app understands. Nothing here can be edited or saved. You can export the original file exactly as it is.`),
      button('Export original file', () => {
        browserDownload(state.bytes, 'freeform-original.freeform');
        setMessage('Downloaded freeform-original.freeform.');
      }),
    );
    shell.append(banner);
    root.append(shell);
  }

  function renderPersistenceControls(): HTMLElement {
    const section = element('section', 'persistence-controls');
    section.id = 'persistence-controls';
    section.setAttribute('aria-label', 'File and backup controls');
    const documentState = observed.getState();
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = documentState.document.show.title;
    titleInput.id = 'document-title';
    titleInput.setAttribute('aria-label', 'Document name');
    titleInput.disabled = Boolean(readOnly);
    titleInput.addEventListener('change', () => {
      const title = titleInput.value.trim();
      if (title !== '' && title !== documentState.document.show.title) observed.apply({ type: 'show.title.set', title });
    });

    const controls = element('div', 'persistence-controls__buttons');
    const saveControl = button('Save', () => { void save('save'); });
    saveControl.title = 'Saves your show to its file.';
    const saveAs = button('Save As…', () => { void save('save-as'); });
    const open = button('Open…', () => chooseOpen());
    const newShow = button('New show', () => requestNew());
    const historyButton = button('Version history', () => { void showHistory(); });
    [saveControl, saveAs, open, newShow, historyButton].forEach((control) => { control.disabled = Boolean(readOnly); });
    controls.append(saveControl, saveAs, open, newShow, historyButton);

    const chip = text('p', `persistence-state persistence-state--${localState}`, stateLabel());
    chip.title = stateTooltip();
    chip.setAttribute('aria-live', 'polite');
    section.append(text('h3', 'Document'), label(titleInput, 'Document name'), titleInput, controls, chip);
    if (message) section.append(text('p', 'editor-message persistence-message', message));

    const backupControls = element('div', 'persistence-controls__buttons');
    const chooseFolder = button('Choose backup folder…', () => { void chooseBackupFolder(); });
    const backupNow = button('Back up now', () => { void writeBackup(); });
    backupControls.append(chooseFolder, backupNow);
    section.append(
      text('h3', 'Backup'),
      text('p', 'muted', 'Optional. Without a folder, Back Up Now downloads a file instead.'),
      backupControls,
    );
    if (backupDestination) section.append(text('p', 'muted', 'Freeform keeps your 10 most recent backups for this show in this folder and deletes older ones with the same name automatically. If you rename the show, older backups under the old name are left alone — you\'ll need to clean those up yourself.'));
    const shortcuts = element('details', 'persistence-shortcuts');
    shortcuts.append(text('summary', 'Keyboard shortcuts'));
    shortcuts.append(
      text('p', 'Ctrl+S (Windows/Linux) · Cmd+S (Mac): Saves your show to its file.'),
      text('p', 'Ctrl+Z (Windows/Linux) · Cmd+Z (Mac): Undoes your last show edit. While you\'re typing in a text field, this uses your browser\'s normal text undo for that field instead.'),
      text('p', 'Ctrl+Y or Ctrl+Shift+Z (Windows/Linux) · Cmd+Shift+Z (Mac): Redoes the last thing you undid. Like Undo, this doesn\'t apply while you\'re typing in a text field — your browser handles redo there.'),
    );
    section.append(shortcuts);
    if (backup?.shouldPromptForBackup(reminder)) section.append(renderBackupPrompt());
    if (candidates.length > 0) section.append(renderRecoveryPanel());
    return section;
  }

  function refreshControls(): void {
    const old = root.querySelector<HTMLElement>('#persistence-controls');
    if (old) old.replaceWith(renderPersistenceControls());
    else if (!readOnly && root.querySelector('.setup-wizard') === null) renderEditor();
  }

  function stateLabel(): string {
    if (readOnly) return 'Read-only — newer file format';
    if (localState === 'saving') return 'Saving local backup…';
    if (localState === 'failed') return 'Local backup failed';
    if (savedRevision === observed.getState().revision) return 'Saved';
    return 'Unsaved changes';
  }

  function stateTooltip(): string {
    if (readOnly) return 'This show was saved by a newer version of Freeform. You can look around and export the original file, but you can\'t edit or save changes.';
    if (localState === 'saving') return 'Freeform is copying your latest edits to this browser\'s local storage. This isn\'t the same as saving your file.';
    if (localState === 'failed') return localFailure;
    if (savedRevision === observed.getState().revision) return 'Your document matches the last file you saved.';
    return 'Press Ctrl+S (Cmd+S on Mac) to save your file. Freeform also keeps a local backup automatically.';
  }

  async function flushWorkingCopy(): Promise<void> {
    if (!adapter || readOnly) return;
    localState = 'saving';
    refreshControls();
    const state = observed.getState();
    const outcome = await writeWorkingCopy(adapter, state.document.show.id, state.revision, state.document, Date.now());
    applyWorkingOutcome(outcome);
    await refreshCandidates();
  }

  function applyWorkingOutcome(outcome: WriteOutcome): void {
    if (outcome.ok || outcome.reason === 'stale-revision') {
      localState = savedRevision === observed.getState().revision ? 'saved' : 'dirty';
      localFailure = '';
    } else {
      localState = 'failed';
      localFailure = outcome.reason === 'quota-exceeded'
        ? 'This browser\'s local storage is full, so your latest edits aren\'t being backed up locally. Save your file now to keep them safe, then free up storage or clear old local backups.'
        : outcome.reason === 'unavailable'
          ? 'This browser\'s local storage isn\'t available right now (this can happen in a private/incognito window). Your edits are only safe in this tab until you save your file — save often.'
          : `Freeform couldn\'t write a local backup because of a storage error (${outcome.message}). Save your file now to be safe.`;
      message = localFailure;
    }
    refreshControls();
  }

  async function save(operation: 'save' | 'save-as'): Promise<boolean> {
    if (readOnly) return false;
    const document = observed.getState().document;
    const result = await saveExplicitSnapshot(document, { operation, title: document.show.title, activeHandle }, undefined);
    if (!result.ok) {
      message = result.reason === 'permission-denied'
        ? `Freeform couldn\'t get permission to save to ${freeformFilename(document.show.title)}. Use Save As to pick a file you can grant access to. Your document is unchanged and still open.`
        : result.reason === 'cancelled'
          ? 'Save cancelled.'
          : result.reason === 'write-failed'
            ? `Freeform couldn\'t finish saving ${freeformFilename(document.show.title)} (${result.message}). Your document is unchanged and still open — try again, or use Save As to save a new copy.`
            : `Freeform couldn\'t download a copy of your show (${result.message}). Your document is unchanged and still open — check your browser\'s download settings and try again.`;
      refreshControls();
      return false;
    }
    activeHandle = result.method === 'file-system-access' ? result.handle : undefined;
    savedRevision = observed.getState().revision;
    localState = 'saved';
    message = result.method === 'file-system-access'
      ? 'Saved.'
      : operation === 'save'
        ? `Downloaded ${result.filename}. Your browser doesn't have permission to overwrite files directly, so each save creates a new download.`
        : `Downloaded ${result.filename} to your browser's downloads folder.`;
    try {
      await history?.recordCheckpoint(currentDocumentId, document, 'explicit-save');
      await ancestry?.setBaseline({ documentId: currentDocumentId, title: document.show.title, source: result.method === 'download' ? 'download' : 'file-system-access', timestamp: Date.now(), schemaVersion: document.formatVersion });
    } catch (error) {
      message = `Saved, but Freeform couldn't update local version history (${errorMessage(error)}).`;
    }
    await flushWorkingCopy();
    return true;
  }

  function chooseOpen(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.freeform,application/json';
    input.hidden = true;
    document.body.append(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (file) requestOpen(file);
    }, { once: true });
    input.click();
  }

  function requestOpen(file: File): void {
    if (isDirty()) {
      showSwitchDialog('open', async () => openFile(file));
      return;
    }
    void openFile(file);
  }

  async function openFile(file: File): Promise<void> {
    let decoded: DecodeResult;
    try {
      decoded = decodeDocument(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      message = fileErrorCopy(error);
      refreshControls();
      return;
    }
    if (decoded.kind === 'read-only-future-major') {
      readOnly = { bytes: decoded.originalBytes, formatVersion: decoded.formatVersion };
      renderReadOnly();
      return;
    }
    await replaceDocument(decoded.document, 'import', decoded.originalBytes);
  }

  function requestNew(): void {
    if (isDirty()) {
      showSwitchDialog('new', async () => {
        await replaceDocument(createEmptyDocument(), 'import');
        savedRevision = undefined;
        renderSetup();
      });
      return;
    }
    void replaceDocument(createEmptyDocument(), 'import').then(() => renderSetup());
  }

  async function replaceDocument(documentToOpen: FreeformDocument, source: 'import' | 'recovery', originalBytes?: Uint8Array): Promise<void> {
    if (history && isDirty()) {
      const checkpoint = await runWithDestructiveCheckpoint(observed, currentDocumentId, history, () => observed.apply({ type: 'document.replace', document: documentToOpen }));
      if (!checkpoint.ok) {
        message = `Freeform couldn't make a safety backup before replacing the document (${checkpoint.message}). Your document is unchanged and still open.`;
        refreshControls();
        return;
      }
    } else {
      observed.apply({ type: 'document.replace', document: documentToOpen });
    }
    currentDocumentId = documentToOpen.show.id;
    activeHandle = undefined;
    savedRevision = source === 'import' ? observed.getState().revision : undefined;
    localState = source === 'import' ? 'saved' : 'dirty';
    reminder = { documentId: currentDocumentId };
    if (source === 'import') {
      try {
        await history?.recordCheckpoint(currentDocumentId, documentToOpen, 'import');
        await ancestry?.setBaseline({ documentId: currentDocumentId, title: documentToOpen.show.title, source: 'import', timestamp: Date.now(), schemaVersion: documentToOpen.formatVersion });
      } catch (error) {
        message = `Opened the file, but Freeform couldn't update local version history (${errorMessage(error)}).`;
      }
    }
    if (originalBytes) void originalBytes;
    await flushWorkingCopy();
    message = source === 'import' ? `Opened ${documentToOpen.show.title}.` : `Opened ${documentToOpen.show.title} as a copy.`;
    renderEditor();
  }

  function isDirty(): boolean {
    return savedRevision !== observed.getState().revision;
  }

  function showSwitchDialog(kind: 'open' | 'new', proceed: () => Promise<void>): void {
    const title = observed.getState().document.show.title;
    const noun = kind === 'open' ? 'Opening a different file' : 'Starting a new show';
    const destructive = kind === 'open' ? 'Discard and Open' : 'Discard and Start New';
    const saveThen = kind === 'open' ? 'Save and Open' : 'Save and Start New';
    const dialog = dialogElement('Save your changes first?', `“${title}” has unsaved changes. ${noun} without saving will lose them.`);
    dialog.append(button('Cancel', () => dialog.remove()));
    dialog.append(button(destructive, () => { dialog.remove(); void proceed(); }));
    dialog.append(button(saveThen, () => { void save('save').then((ok) => { if (ok) { dialog.remove(); void proceed(); } }); }));
    showDialog(dialog);
  }

  async function refreshCandidates(): Promise<void> {
    if (!recovery) return;
    const ids = knownDocumentIds(currentDocumentId);
    candidates = await recovery.listCandidates(ids);
    refreshControls();
    if (root.querySelector('.setup-wizard') && candidates.length > 0 && !root.querySelector('.recovery-panel')) root.append(renderRecoveryPanel());
  }

  function renderRecoveryPanel(): HTMLElement {
    const panel = element('section', 'recovery-panel');
    panel.append(text('h3', 'Recover unsaved work?'));
    candidates.forEach((candidate) => {
      const row = element('div', 'recovery-panel__row');
      row.append(
        text('p', undefined, `Freeform found local edits to “${candidate.title}” that are newer than the last file you saved. Choose what to do with them.`),
        text('p', undefined, `${candidate.title} — local backup from ${formatTime(candidate.timestamp)} (format ${candidate.schemaVersion})`),
      );
      row.append(
        button('Open as a copy', () => { void openRecoveryCopy(candidate); }),
        button('Replace current with this', () => showRecoveryReplace(candidate)),
        button('Export backup', () => { void exportRecovery(candidate); }),
        button('Discard', () => { void discardRecovery(candidate); }),
      );
      panel.append(row);
    });
    return panel;
  }

  async function openRecoveryCopy(candidate: RecoveryCandidate): Promise<void> {
    const result = await recovery?.loadCandidate(candidate.documentId);
    if (!result || !result.ok) return recoveryFailure(result);
    await replaceDocument(result.document, 'recovery');
  }

  function showRecoveryReplace(candidate: RecoveryCandidate): void {
    const dialog = dialogElement('Replace your current document?', `This replaces everything currently open with the local backup of "${candidate.title}" from ${formatTime(candidate.timestamp)}. Anything you have open right now that isn't already saved will be lost. This can't be undone.`);
    dialog.append(button('Cancel', () => dialog.remove()), button('Replace', () => {
      dialog.remove();
      void (async () => {
        const result = await recovery?.confirmReplace(candidate.documentId);
        if (!result || !result.ok) return recoveryFailure(result);
        await replaceDocument(result.document, 'recovery');
      })();
    }));
    showDialog(dialog);
  }

  async function exportRecovery(candidate: RecoveryCandidate): Promise<void> {
    const bytes = await recovery?.exportBackupBytes(candidate.documentId);
    if (!bytes) {
      message = 'This local backup is no longer available — it may already have been opened or discarded.';
    } else {
      browserDownload(bytes, freeformFilename(candidate.title));
      message = `Downloaded ${freeformFilename(candidate.title)}.`;
    }
    refreshControls();
  }

  async function discardRecovery(candidate: RecoveryCandidate): Promise<void> {
    await recovery?.discardCandidate(candidate.documentId);
    message = 'Deleted this local backup. Your explicit file, if any, is not affected.';
    await refreshCandidates();
  }

  function recoveryFailure(result: Awaited<ReturnType<RecoveryService['loadCandidate']>> | undefined): void {
    if (!result || result.ok || result.reason === 'not-found') {
      message = 'This local backup is no longer available — it may already have been opened or discarded.';
    } else {
      message = `Freeform couldn't open this local backup — it may be damaged, or saved in a format this version can't read (${result.message}). Your currently open document hasn't changed. You can still discard it.`;
    }
    refreshControls();
  }

  async function showHistory(): Promise<void> {
    if (!history) return;
    checkpoints = await history.listCheckpoints(currentDocumentId);
    const dialog = dialogElement('Version history', '');
    checkpoints.forEach((checkpoint) => {
      const row = element('div', 'version-history__row');
      row.append(text('p', undefined, `${checkpointLabel(checkpoint.source)} — ${formatTime(checkpoint.createdAt)}, ${formatBytes(checkpoint.sizeBytes)}`));
      row.append(button('Restore this version', () => showRestoreCheckpoint(checkpoint, dialog)));
      dialog.append(row);
    });
    if (checkpoints.length === 0) dialog.append(text('p', undefined, 'No saved versions yet.'));
    dialog.append(button('Close', () => dialog.remove()));
    showDialog(dialog);
  }

  function showRestoreCheckpoint(checkpoint: CheckpointRecord, parent: HTMLElement): void {
    const dialog = dialogElement('Restore this version?', `This makes the version from ${formatTime(checkpoint.createdAt)} your current working document. It stays in your version history afterward — restoring doesn't delete or move it, so you can always come back to today's version too. Anything in your current document that isn't saved or backed up yet will be lost.`);
    dialog.append(button('Cancel', () => dialog.remove()), button('Restore', () => {
      dialog.remove();
      parent.remove();
      void (async () => {
        try {
          const decoded = decodeDocument(checkpoint.bytes);
          if (decoded.kind !== 'editable') throw new Error('The selected version is read-only.');
          await replaceDocument(decoded.document, 'recovery');
          message = 'Restored the selected version. The original version remains in version history.';
          refreshControls();
        } catch (error) {
          message = `Freeform couldn't restore this version (${errorMessage(error)}). Your currently open document hasn't changed.`;
          refreshControls();
        }
      })();
    }));
    showDialog(dialog);
  }

  async function chooseBackupFolder(): Promise<void> {
    const picker = (globalThis as unknown as { showDirectoryPicker?: () => Promise<BackupDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      message = 'Your browser does not support choosing a backup folder. Back Up Now will download a copy instead.';
      refreshControls();
      return;
    }
    try {
      const destination = await picker();
      if (!await hasWritePermission(destination)) {
        backupDestination = undefined;
        message = 'Freeform couldn\'t get permission to use that backup folder. Back Up Now will download a copy instead.';
      } else {
        backupDestination = destination;
        message = 'Backup folder selected.';
      }
    } catch (error) {
      message = error instanceof DOMException && error.name === 'AbortError' ? 'Backup folder selection cancelled.' : `Freeform couldn't choose a backup folder (${errorMessage(error)}).`;
    }
    refreshControls();
  }

  async function writeBackup(): Promise<void> {
    if (!backup) return;
    const result = await backup.writeBackup(observed.getState().document, backupDestination, browserDownload);
    if (result.ok) {
      message = result.method === 'filesystem'
        ? `Backup saved as ${result.filename} in your chosen folder.`
        : `Backup downloaded as ${result.filename}. Choose a backup folder to skip the download step next time.`;
    } else {
      message = `Freeform couldn't write a backup to your chosen folder (${result.message}). Try again, or back up using a download instead.`;
    }
    reminder = { ...reminder, lastPromptedAt: Date.now() };
    refreshControls();
  }

  function renderBackupPrompt(): HTMLElement {
    const prompt = element('section', 'backup-prompt');
    prompt.append(
      text('h4', 'Back up your show?'),
      text('p', 'It\'s been a day since your last backup prompt. Want to back up a copy now? Freeform only checks this while the app is open in this tab — it doesn\'t back up on a background schedule.'),
      button('Remind me tomorrow', () => { reminder = { ...reminder, lastPromptedAt: Date.now() }; refreshControls(); }),
      button('Back up now', () => { void writeBackup(); }),
    );
    return prompt;
  }

  function setMessage(next: string): void {
    message = next;
    refreshControls();
  }

  return { store: observed, start, dispose, renderControls: renderPersistenceControls };
}

function fileErrorCopy(error: unknown): string {
  const message = errorMessage(error);
  const code = error instanceof FreeformFileError ? error.code : '';
  switch (code) {
    case 'INVALID_JSON': return 'Freeform couldn\'t read this file — it isn\'t valid Freeform JSON. Your currently open document hasn\'t changed.';
    case 'WRONG_FORMAT': return 'This doesn\'t look like a Freeform show file. Freeform couldn\'t open it, and your currently open document hasn\'t changed.';
    case 'INVALID_VERSION': return 'Freeform couldn\'t tell what format version this file uses, so it can\'t be opened safely. Your currently open document hasn\'t changed.';
    case 'UNSUPPORTED_MAJOR': return `This file uses a format version older than Freeform can open directly (${message}). Your currently open document hasn\'t changed.`;
    case 'UNSUPPORTED_MINOR': return `This file uses a newer Freeform format that this app version can\'t update automatically yet. Your currently open document hasn\'t changed. Open it with the Freeform version that created it, or check for an app update.`;
    case 'SEMANTIC': return `This file's contents don't add up — for example a duplicate ID or a reference to something that doesn't exist (${message}). Freeform won't open it as-is. Your currently open document hasn't changed.`;
    default: return `This file has a problem Freeform can't fix automatically (${message}). Your currently open document hasn't changed.`;
  }
}

async function hasWritePermission(destination: BackupDirectoryHandle): Promise<boolean> {
  const handle = destination as BackupDirectoryHandle & { queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>; requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState> };
  const existing = await handle.queryPermission?.({ mode: 'readwrite' });
  if (existing === 'granted') return true;
  return await handle.requestPermission?.({ mode: 'readwrite' }) === 'granted';
}

function knownDocumentIds(current: string): readonly string[] {
  const key = 'freeform-known-document-ids';
  try {
    const values = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    const ids = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
    const next = [...new Set([...ids, current])];
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return [current];
  }
}

function isTextEditing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function checkpointLabel(source: CheckpointRecord['source']): string {
  return source === 'explicit-save' ? 'Saved version'
    : source === 'import' ? 'Imported file'
      : source === 'pre-destructive' ? 'Automatic backup before a big change'
        : 'Original file (before format upgrade)';
}

function formatTime(timestamp: number): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp); }
function formatBytes(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (className) node.className = className; return node; }
function text<K extends keyof HTMLElementTagNameMap>(tag: K, classNameOrValue: string | undefined, value?: string): HTMLElementTagNameMap[K] {
  const className = value === undefined ? undefined : classNameOrValue;
  const node = element(tag, className);
  node.textContent = value ?? classNameOrValue ?? '';
  return node;
}
function label(control: HTMLInputElement, value: string): HTMLLabelElement { const node = document.createElement('label'); node.htmlFor = control.id; node.textContent = value; return node; }
function button(value: string, click: () => void): HTMLButtonElement { const node = document.createElement('button'); node.type = 'button'; node.textContent = value; node.addEventListener('click', click); return node; }
function dialogElement(titleValue: string, body: string): HTMLElement { const node = element('section', 'persistence-dialog'); node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'true'); node.append(text('h3', undefined, titleValue)); if (body) node.append(text('p', undefined, body)); return node; }
function showDialog(dialog: HTMLElement): void { document.body.append(dialog); const first = dialog.querySelector<HTMLElement>('button'); first?.focus(); }
