import type { CommandStore, DocumentCommand, DocumentState } from '../document/types';

export type CommitKind = 'apply' | 'undo' | 'redo';

export interface CommitEvent {
  readonly kind: CommitKind;
  readonly state: DocumentState;
  /** Present only for `apply`. */
  readonly command?: DocumentCommand;
}

export type CommitListener = (event: CommitEvent) => void;

/**
 * Wraps a reviewed `CommandStore` WITHOUT modifying it, so the M7.1-reviewed
 * command-store implementation stays untouched. A listener is notified
 * synchronously for every `apply`/`undo`/`redo` call that actually changed
 * state. `store.apply` throws before returning on an invalid command, so a
 * rejected command can never reach the listener and can never produce a
 * working-copy write or a history snapshot — this is the mechanism behind
 * "failed commands produce no snapshot".
 */
export function observeCommandStore(store: CommandStore, listener: CommitListener): CommandStore {
  return {
    getState: () => store.getState(),
    apply(command) {
      const state = store.apply(command);
      listener({ kind: 'apply', state, command });
      return state;
    },
    undo() {
      const state = store.undo();
      if (state) listener({ kind: 'undo', state });
      return state;
    },
    redo() {
      const state = store.redo();
      if (state) listener({ kind: 'redo', state });
      return state;
    },
    canUndo: () => store.canUndo(),
    canRedo: () => store.canRedo(),
    getUndoCommands: () => store.getUndoCommands(),
  };
}
