import { describe, expect, it } from 'vitest';
import { detectFeatures } from './features';

describe('feature detection', () => {
  it('accepts required browser capabilities and describes download fallback', () => {
    const report = detectFeatures({ indexedDB: {}, Worker: class Worker {}, showSaveFilePicker: undefined });

    expect(report.supported).toBe(true);
    expect(report.capabilities).toMatchObject({ indexedDb: true, webWorkers: true, esModules: true, fileSystemAccess: false });
    expect(report.messages.join(' ')).toContain('download fallback');
  });

  it('fails informatively when required browser capabilities are absent', () => {
    const report = detectFeatures({});

    expect(report.supported).toBe(false);
    expect(report.messages).toEqual([
      'Unsupported browser: IndexedDB and Web Workers are required for Freeform.',
    ]);
  });
});
