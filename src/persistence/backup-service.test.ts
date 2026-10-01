import { describe, expect, it, vi } from 'vitest';
import {
  BACKUP_REMINDER_INTERVAL_MS,
  BACKUP_RETENTION_COUNT,
  createBackupService,
  type BackupDirectoryHandle,
} from './backup-service';
import type { Clock } from './clock';
import type { FreeformDocument } from '../document/types';

function makeDocument(title = 'A Show'): FreeformDocument {
  return {
    format: 'freeform', formatVersion: '1.0.0',
    show: { id: 'show-1', title, totalCounts: 0 },
    field: { preset: 'NFHS_11_PLAYER', unitsPerYard: 2880, lengthUnits: 288000, widthUnits: 153600, frontHashY: 51200, backHashY: 102400 },
    settings: { collisionThresholdUnits: 2880 },
    performers: [{ id: 'a', rankCode: 'A1', displayName: 'A' }],
    sets: [{ id: 'set-1', name: 'One', startCount: 0, positions: { a: { x: 0, y: 0 } } }],
    transitions: [], annotations: [],
  };
}

function fakeClock(initial: number): Clock & { set(value: number): void } {
  let current = initial;
  return { now: () => current, set: (value) => { current = value; } };
}

function fakeDirectory(initialNames: readonly string[] = []): BackupDirectoryHandle & { writtenFiles: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  for (const name of initialNames) files.set(name, new Uint8Array());
  return {
    writtenFiles: files,
    async getFileHandle(name) {
      return {
        async createWritable() {
          return {
            async write(data: Uint8Array) { files.set(name, data); },
            async close() {},
          };
        },
      };
    },
    async *keys() {
      for (const name of files.keys()) yield name;
    },
    async removeEntry(name: string) {
      files.delete(name);
    },
  };
}

describe('backup reminder scheduling', () => {
  it('does not prompt when there is no unsaved-origin editing stretch', () => {
    const service = createBackupService(fakeClock(0));
    expect(service.shouldPromptForBackup({ documentId: 'doc-1' })).toBe(false);
  });

  it('prompts the first time unsaved-origin editing is seen with no prior prompt', () => {
    const service = createBackupService(fakeClock(1000));
    expect(service.shouldPromptForBackup({ documentId: 'doc-1', unsavedOriginSince: 500 })).toBe(true);
  });

  it('does not prompt again before a full 24h have passed since the last prompt', () => {
    const clock = fakeClock(0);
    const service = createBackupService(clock);
    const reminder = { documentId: 'doc-1', unsavedOriginSince: 0, lastPromptedAt: 0 };
    clock.set(BACKUP_REMINDER_INTERVAL_MS - 1);
    expect(service.shouldPromptForBackup(reminder)).toBe(false);
  });

  it('prompts again at exactly the 24h boundary since the last prompt', () => {
    const clock = fakeClock(0);
    const service = createBackupService(clock);
    const reminder = { documentId: 'doc-1', unsavedOriginSince: 0, lastPromptedAt: 0 };
    clock.set(BACKUP_REMINDER_INTERVAL_MS);
    expect(service.shouldPromptForBackup(reminder)).toBe(true);
  });
});

describe('backup writing', () => {
  it('writes to the chosen filesystem destination when one is active/permitted', async () => {
    const service = createBackupService(fakeClock(123456));
    const directory = fakeDirectory();
    const download = vi.fn();

    const result = await service.writeBackup(makeDocument(), directory, download);

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ method: 'filesystem' });
    expect(download).not.toHaveBeenCalled();
    expect(directory.writtenFiles.size).toBe(1);
  });

  it('falls back to a browser download with no pretend filesystem write when no destination is active', async () => {
    const service = createBackupService(fakeClock(123456));
    const download = vi.fn();

    const result = await service.writeBackup(makeDocument(), undefined, download);

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ method: 'download' });
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('reports write-failed honestly (not success) when the destination write throws', async () => {
    const service = createBackupService(fakeClock(1));
    const directory = fakeDirectory();
    directory.getFileHandle = async () => { throw new Error('permission revoked'); };
    const download = vi.fn();

    const result = await service.writeBackup(makeDocument(), directory, download);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('write-failed');
    expect(download).not.toHaveBeenCalled();
  });

  it('retains only the last 10 owned backups for this document title, deleting the oldest first', async () => {
    const clock = fakeClock(0);
    const service = createBackupService(clock);
    const directory = fakeDirectory();
    const download = vi.fn();

    for (let i = 0; i < 12; i += 1) {
      clock.set(i * 1000);
      await service.writeBackup(makeDocument('A Show'), directory, download);
    }

    expect(directory.writtenFiles.size).toBe(BACKUP_RETENTION_COUNT);
    // The two oldest timestamps (0 and 1000) must have been pruned.
    const remainingTimestamps = [...directory.writtenFiles.keys()].map((name) => Number(name.match(/backup-(\d+)\.freeform$/)![1]));
    expect(Math.min(...remainingTimestamps)).toBe(2000);
  });

  it('never deletes an unrelated file in the destination directory during retention pruning', async () => {
    const clock = fakeClock(0);
    const directory = fakeDirectory(['unrelated-file.txt', 'someone-elses-show.freeform']);
    const service = createBackupService(clock);
    const download = vi.fn();

    for (let i = 0; i < 12; i += 1) {
      clock.set(i * 1000);
      await service.writeBackup(makeDocument('A Show'), directory, download);
    }

    expect(directory.writtenFiles.has('unrelated-file.txt')).toBe(true);
    expect(directory.writtenFiles.has('someone-elses-show.freeform')).toBe(true);
  });

  it('matches only this document title owned-file naming prefix, not another show backed up to the same destination', async () => {
    const clock = fakeClock(0);
    const directory = fakeDirectory();
    const service = createBackupService(clock);
    const download = vi.fn();

    for (let i = 0; i < 12; i += 1) {
      clock.set(i * 1000);
      await service.writeBackup(makeDocument('Show One'), directory, download);
    }
    const showOneCountBeforeOther = [...directory.writtenFiles.keys()].filter((n) => n.startsWith('Show One')).length;
    expect(showOneCountBeforeOther).toBe(BACKUP_RETENTION_COUNT);

    clock.set(99000);
    await service.writeBackup(makeDocument('Show Two'), directory, download);

    const showOneCount = [...directory.writtenFiles.keys()].filter((n) => n.startsWith('Show One')).length;
    const showTwoCount = [...directory.writtenFiles.keys()].filter((n) => n.startsWith('Show Two')).length;
    expect(showOneCount).toBe(BACKUP_RETENTION_COUNT); // untouched by Show Two's retention pass
    expect(showTwoCount).toBe(1);
  });
});
