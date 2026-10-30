// Check Git source inputs, including reviewed untracked files; never scan generated dependencies.
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { lstatSync } from 'node:fs';

export function sourceFiles(cwd) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  env.GIT_OPTIONAL_LOCKS = '0';
  return execFileSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      '.',
    ],
    { cwd, encoding: 'utf8', env },
  )
    .split('\0')
    .filter(Boolean)
    .filter((file) => {
      let stat;
      try {
        stat = lstatSync(resolve(cwd, file));
      } catch (error) {
        if (error.code === 'ENOENT') return false; // Pending Git deletion.
        throw error;
      }
      if (!stat.isFile()) throw new Error(`Non-regular source input: ${file}`);
      return true;
    });
}

export function formatArguments(files) {
  return ['--check', '--ignore-unknown', '--', ...files];
}

export function main(cwd) {
  const files = sourceFiles(cwd);
  if (process.argv.includes('--list')) {
    process.stdout.write(JSON.stringify(files));
    return 0;
  }
  if (!files.length) return 0;
  const prettier = createRequire(import.meta.url).resolve(
    'prettier/bin/prettier.cjs',
  );
  const result = spawnSync(
    process.execPath,
    [prettier, ...formatArguments(files)],
    { cwd, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.cwd());
}
