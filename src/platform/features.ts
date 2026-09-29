export interface BrowserCapabilities {
  readonly indexedDb: boolean;
  readonly webWorkers: boolean;
  readonly esModules: true;
  readonly fileSystemAccess: boolean;
}

export interface FeatureReport {
  readonly supported: boolean;
  readonly capabilities: BrowserCapabilities;
  readonly messages: readonly string[];
}

export interface FeatureEnvironment {
  readonly indexedDB?: unknown;
  readonly Worker?: unknown;
  readonly showSaveFilePicker?: unknown;
}

export function detectFeatures(environment: FeatureEnvironment = globalThis): FeatureReport {
  const capabilities: BrowserCapabilities = {
    indexedDb: typeof environment.indexedDB !== 'undefined',
    webWorkers: typeof environment.Worker !== 'undefined',
    // The application is executing as an ES module, so a successful bootstrap
    // itself proves module support.
    esModules: true,
    fileSystemAccess: typeof environment.showSaveFilePicker === 'function',
  };

  const missing = [
    !capabilities.indexedDb ? 'IndexedDB' : undefined,
    !capabilities.webWorkers ? 'Web Workers' : undefined,
  ].filter((capability): capability is string => capability !== undefined);

  const messages = missing.length > 0
    ? [`Unsupported browser: ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} required for Freeform.`]
    : [
        'Required capabilities are available: IndexedDB, ES modules, and Web Workers.',
        capabilities.fileSystemAccess
          ? 'File System Access API is available for future direct-save support.'
          : 'File System Access API is unavailable; future file saves will use the download fallback.',
      ];

  return { supported: missing.length === 0, capabilities, messages };
}
