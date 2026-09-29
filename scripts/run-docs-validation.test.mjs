import { describe, expect, it, vi } from 'vitest';
import { pythonCommands, runDocsValidation } from './run-docs-validation.mjs';

describe('documentation validation launcher', () => {
  it('uses the Windows Python launcher before alternate commands', () => {
    expect(pythonCommands('win32')).toEqual([
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ]);
  });

  it('uses python3 before the unversioned command on macOS', () => {
    expect(pythonCommands('darwin')).toEqual([
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ]);
  });

  it('tries the next command only when the current executable is unavailable', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }) })
      .mockReturnValueOnce({ status: 0 });

    const result = runDocsValidation({ platform: 'win32', spawn, cwd: '/docs' });

    expect(result).toEqual({ status: 0 });
    expect(spawn).toHaveBeenNthCalledWith(1, 'py', ['-3', 'validate_fixture.py'], { cwd: '/docs', stdio: 'inherit' });
    expect(spawn).toHaveBeenNthCalledWith(2, 'python', ['validate_fixture.py'], { cwd: '/docs', stdio: 'inherit' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('preserves a validator failure instead of hiding it behind a fallback', () => {
    const spawn = vi.fn().mockReturnValue({ status: 7 });

    const result = runDocsValidation({ platform: 'win32', spawn, cwd: '/docs' });

    expect(result).toEqual({ status: 7 });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('reports every platform candidate when Python is unavailable', () => {
    const spawn = vi.fn().mockReturnValue({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }) });

    const result = runDocsValidation({ platform: 'darwin', spawn, cwd: '/docs' });

    expect(result.status).toBe(1);
    expect(result.error?.message).toContain('python3, python');
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
