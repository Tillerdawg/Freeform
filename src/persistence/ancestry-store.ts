import { STORE_ANCESTRY, requestToPromise, type PersistenceAdapter } from './idb-adapter';

export type FileBaselineSource = 'file-system-access' | 'download' | 'import';

/** The explicit-file ancestry baseline for one document: the most recent
 * point at which the working state is KNOWN to match an explicit file the
 * user holds (a direct write, a downloaded fallback, or a successful
 * import). `download` counts as a successful baseline exactly like a direct
 * write — the user does hold current bytes — even though the app holds no
 * handle to overwrite next time. */
export interface FileBaseline {
  readonly documentId: string;
  readonly title: string;
  readonly source: FileBaselineSource;
  readonly timestamp: number;
  readonly schemaVersion: string;
}

export interface AncestryStore {
  setBaseline(baseline: FileBaseline): Promise<void>;
  getBaseline(documentId: string): Promise<FileBaseline | undefined>;
}

export function createAncestryStore(adapter: PersistenceAdapter): AncestryStore {
  return {
    async setBaseline(baseline) {
      await adapter.run([STORE_ANCESTRY], 'readwrite', (tx) => {
        tx.objectStore(STORE_ANCESTRY).put(baseline);
      });
    },
    async getBaseline(documentId) {
      return adapter.run([STORE_ANCESTRY], 'readonly', (tx) =>
        requestToPromise(tx.objectStore(STORE_ANCESTRY).get(documentId) as IDBRequest<FileBaseline | undefined>),
      );
    },
  };
}
