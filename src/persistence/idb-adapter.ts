/**
 * Low-level IndexedDB access for Freeform's persistence layer. This module
 * owns database/schema setup and promise-wraps the native async IndexedDB
 * APIs; it has no knowledge of documents, autosave, or history policy.
 *
 * Every error surfaced by `run` is one of the typed classes below so callers
 * can give actionable, non-destructive guidance instead of a generic
 * failure. A rejected `run` never touches in-memory application state —
 * only persistence callers decide what, if anything, to do about it.
 */

export class PersistenceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceUnavailableError';
  }
}

export class PersistenceQuotaError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
    this.name = 'PersistenceQuotaError';
  }
}

export class PersistenceOperationError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
    this.name = 'PersistenceOperationError';
  }
}

export const FREEFORM_DB_NAME = 'freeform-persistence';
export const FREEFORM_DB_VERSION = 1;

export const STORE_WORKING = 'working-copies';
export const STORE_HISTORY = 'version-history';
export const STORE_ANCESTRY = 'file-ancestry';

export interface IdbEnvironment {
  readonly indexedDB?: IDBFactory;
}

export interface PersistenceAdapter {
  run<T>(
    storeNames: readonly string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => Promise<T> | T,
  ): Promise<T>;
  close(): void;
}

/** Feature-detects and opens the shared Freeform database. Each call opens
 * its own connection; callers (tests included) can isolate environments by
 * injecting a distinct `indexedDB` factory instead of relying on a module
 * singleton. */
export async function openPersistenceAdapter(
  environment: IdbEnvironment = globalThis as unknown as IdbEnvironment,
): Promise<PersistenceAdapter> {
  const factory = environment.indexedDB;
  if (!factory) {
    throw new PersistenceUnavailableError('IndexedDB is not available in this environment.');
  }

  let db: IDBDatabase;
  try {
    db = await openDatabase(factory);
  } catch (error) {
    throw classifyOpenError(error);
  }

  let closed = false;
  return {
    async run(storeNames, mode, work) {
      if (closed) throw new PersistenceOperationError('This persistence adapter has been closed.', undefined);
      try {
        const tx = db.transaction(storeNames, mode);
        const resultPromise = Promise.resolve(work(tx));
        const [result] = await Promise.all([resultPromise, transactionDone(tx)]);
        return result;
      } catch (error) {
        throw classifyError(error);
      }
    },
    close() {
      closed = true;
      db.close();
    },
  };
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(FREEFORM_DB_NAME, FREEFORM_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_WORKING)) {
        database.createObjectStore(STORE_WORKING, { keyPath: 'documentId' });
      }
      if (!database.objectStoreNames.contains(STORE_HISTORY)) {
        const store = database.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
        store.createIndex('byDocument', 'documentId');
      }
      if (!database.objectStoreNames.contains(STORE_ANCESTRY)) {
        database.createObjectStore(STORE_ANCESTRY, { keyPath: 'documentId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new PersistenceOperationError('Database open was blocked by another open connection.', request.error));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted.'));
  });
}

function classifyOpenError(error: unknown): Error {
  if (error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'InvalidStateError')) {
    return new PersistenceUnavailableError(`IndexedDB is unavailable in this browsing context: ${error.message}`);
  }
  return classifyError(error);
}

function classifyError(error: unknown): Error {
  if (
    error instanceof PersistenceUnavailableError ||
    error instanceof PersistenceQuotaError ||
    error instanceof PersistenceOperationError
  ) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new PersistenceQuotaError('Storage quota was exceeded.', error);
  }
  return new PersistenceOperationError(messageOf(error), error);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
