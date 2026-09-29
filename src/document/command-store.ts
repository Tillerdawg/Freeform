import type {
  CommandStore,
  DocumentCommand,
  DocumentState,
  FreeformDocument,
} from './types';

interface HistoryEntry {
  readonly command: DocumentCommand;
  readonly before: DocumentState;
  readonly after: DocumentState;
}

/**
 * The only mutable values in this module are the three history cursors. Every
 * document state exposed to callers is cloned and deeply frozen, so downstream
 * geometry/motion engines can safely treat it as a canonical immutable input.
 */
export function createCommandStore(initialDocument: FreeformDocument): CommandStore {
  let current = makeState(initialDocument, 0);
  let undoHistory: HistoryEntry[] = [];
  let redoHistory: HistoryEntry[] = [];

  return {
    getState: () => current,
    apply(command) {
      const nextDocument = reduce(current.document, command);
      const next = makeState(nextDocument, current.revision + 1);
      undoHistory = [...undoHistory, freeze({ command, before: current, after: next })];
      redoHistory = [];
      current = next;
      return current;
    },
    undo() {
      const entry = undoHistory.at(-1);
      if (!entry) return undefined;

      undoHistory = undoHistory.slice(0, -1);
      redoHistory = [...redoHistory, entry];
      current = entry.before;
      return current;
    },
    redo() {
      const entry = redoHistory.at(-1);
      if (!entry) return undefined;

      redoHistory = redoHistory.slice(0, -1);
      undoHistory = [...undoHistory, entry];
      current = entry.after;
      return current;
    },
    canUndo: () => undoHistory.length > 0,
    canRedo: () => redoHistory.length > 0,
    getUndoCommands: () => undoHistory.map(({ command }) => command),
  };
}

function reduce(document: FreeformDocument, command: DocumentCommand): FreeformDocument {
  switch (command.type) {
    case 'show.title.set':
      return { ...document, show: { ...document.show, title: command.title } };
    case 'show.total-counts.set':
      return { ...document, show: { ...document.show, totalCounts: command.totalCounts } };
    case 'document.replace':
      return command.document;
  }
}

function makeState(document: FreeformDocument, revision: number): DocumentState {
  return freeze({ document: clone(document), revision });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      freeze(nestedValue);
    }
  }
  return value;
}
