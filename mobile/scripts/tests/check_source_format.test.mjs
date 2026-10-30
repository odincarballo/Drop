import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  unlinkSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs } from 'node:util';
import { sourceFiles, formatArguments } from '../check_source_format.mjs';

test('format inputs include tracked and new sources, excluding ignored generated caches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drop-format-test-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    writeFileSync(
      join(dir, '.gitignore'),
      'vendor/\n.cocoapods/\nnode_modules/\n',
    );
    writeFileSync(join(dir, 'tracked.ts'), 'const tracked = true;\n');
    execFileSync('git', ['-C', dir, 'add', '.']);
    writeFileSync(join(dir, 'new source.ts'), 'const newer = true;\n');
    for (const path of ['vendor', '.cocoapods', 'node_modules']) {
      mkdirSync(join(dir, path));
      writeFileSync(join(dir, path, 'generated.js'), 'bad formatting');
    }
    assert.deepEqual(sourceFiles(dir).sort(), [
      '.gitignore',
      'new source.ts',
      'tracked.ts',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true }); // This test's own fixture only.
  }
});

test('pending deletions are skipped and linked sources fail explicitly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drop-format-delete-test-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    const source = join(dir, 'source.ts');
    writeFileSync(source, 'const value = 1;\n');
    execFileSync('git', ['-C', dir, 'add', '.']);
    unlinkSync(source);
    assert.deepEqual(sourceFiles(dir), []);
    symlinkSync('missing.ts', join(dir, 'linked.ts'));
    assert.throws(() => sourceFiles(dir), /Non-regular source/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('option-shaped filenames remain positional inputs', () => {
  const files = ['--version', '--write', '--config', 'source.ts'];
  const result = parseArgs({
    args: formatArguments(files),
    allowPositionals: true,
    options: {
      check: { type: 'boolean' },
      'ignore-unknown': { type: 'boolean' },
    },
  });
  assert.deepEqual(result.positionals, files);
  assert.equal(result.values.check, true);
});

test('Git environment overrides cannot redirect the source inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drop-format-env-test-'));
  const previous = process.env.GIT_DIR;
  try {
    execFileSync('git', ['init', '-q', dir]);
    writeFileSync(join(dir, 'source.ts'), 'const value = 1;\n');
    process.env.GIT_DIR = join(dir, 'unrelated-git-dir');
    assert.deepEqual(sourceFiles(dir), ['source.ts']);
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
