import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = new URL('.', import.meta.url);
export const docsDirectory = fileURLToPath(new URL('../docs/', scriptDirectory));

/**
 * Return portable Python invocation candidates for the documentation gate.
 * Windows normally provides the Python launcher as `py`; POSIX installations
 * conventionally provide `python3`. The remaining candidates support Python
 * distributions that expose only the alternate command without shell syntax.
 */
export function pythonCommands(platform) {
  if (platform === 'win32') {
    return [
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ];
  }

  return [
    { command: 'python3', args: [] },
    { command: 'python', args: [] },
  ];
}

/**
 * Start the documentation validation gate. Only a missing executable prompts
 * trying the next platform-specific candidate; a running validator's failure
 * is always returned unchanged instead of being masked by a fallback.
 */
export function runDocsValidation({
  platform = process.platform,
  spawn = spawnSync,
  cwd = docsDirectory,
} = {}) {
  const candidates = pythonCommands(platform);

  for (const candidate of candidates) {
    const result = spawn(candidate.command, [...candidate.args, 'validate_fixture.py'], {
      cwd,
      stdio: 'inherit',
    });

    if (result.error?.code === 'ENOENT') {
      continue;
    }

    return result;
  }

  return {
    error: new Error(
      `Python 3 was not found. Tried: ${candidates.map(({ command, args }) => [command, ...args].join(' ')).join(', ')}.`,
    ),
    status: 1,
  };
}

function main() {
  const result = runDocsValidation();
  if (result.error) {
    console.error(`Unable to run documentation validation: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
