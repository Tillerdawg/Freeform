import type {
  CommandStore,
  DocumentCommand,
  DocumentState,
  FreeformDocument,
} from './types';
import { assertValidDot } from '../geometry/nfhs';

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
    case 'performer.create':
      return addPerformer(document, command.performer);
    case 'dot.create':
      return placeDot(document, command, false);
    case 'dot.move':
      return placeDot(document, command, true);
    case 'document.replace':
      return command.document;
  }
}

function addPerformer(
  document: FreeformDocument,
  performer: FreeformDocument['performers'][number],
): FreeformDocument {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(performer.id)) {
    throw new Error(`Invalid performer ID: ${performer.id}`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(performer.rankCode)) {
    throw new Error(`Invalid rank code: ${performer.rankCode}`);
  }
  if (performer.displayName.trim().length === 0) {
    throw new Error('Performer display name is required.');
  }
  if (document.performers.some((candidate) => candidate.id === performer.id)) {
    throw new Error(`Performer ID already exists: ${performer.id}`);
  }
  if (document.performers.some((candidate) => candidate.rankCode.toLowerCase() === performer.rankCode.toLowerCase())) {
    throw new Error(`Rank code already exists: ${performer.rankCode}`);
  }
  return { ...document, performers: [...document.performers, performer] };
}

function placeDot(
  document: FreeformDocument,
  command: Extract<DocumentCommand, { readonly type: 'dot.create' | 'dot.move' }>,
  mustAlreadyExist: boolean,
): FreeformDocument {
  assertValidDot(command.dot);
  if (!document.performers.some((performer) => performer.id === command.performerId)) {
    throw new Error(`Unknown performer: ${command.performerId}`);
  }

  const set = document.sets.find((candidate) => candidate.id === command.setId);
  if (!set) throw new Error(`Unknown set: ${command.setId}`);

  const hasExistingDot = command.performerId in set.positions;
  if (mustAlreadyExist && !hasExistingDot) {
    throw new Error(`Cannot move missing dot for performer: ${command.performerId}`);
  }
  if (!mustAlreadyExist && hasExistingDot) {
    throw new Error(`Dot already exists for performer: ${command.performerId}`);
  }

  return {
    ...document,
    sets: document.sets.map((candidate) => candidate.id === command.setId
      ? { ...candidate, positions: { ...candidate.positions, [command.performerId]: command.dot } }
      : candidate),
  };
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
