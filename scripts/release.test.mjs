import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newer, parseArgs } from './release.mjs';

test('the version is found in any position, with or without options', () => {
  assert.deepEqual(parseArgs(['0.2.0']), { version: '0.2.0', notes: undefined, dryRun: false });
  assert.deepEqual(parseArgs(['0.2.0', '--dry-run']), { version: '0.2.0', notes: undefined, dryRun: true });
  assert.deepEqual(parseArgs(['--dry-run', '0.2.0']), { version: '0.2.0', notes: undefined, dryRun: true });
  assert.deepEqual(parseArgs(['--notes', 'n.md', '1.0.3']), { version: '1.0.3', notes: 'n.md', dryRun: false });
  assert.deepEqual(parseArgs(['1.0.3', '--notes', 'n.md', '--dry-run']), { version: '1.0.3', notes: 'n.md', dryRun: true });
  assert.deepEqual(parseArgs(['--dry-run', '--notes', '/dev/null', '0.2.1']), { version: '0.2.1', notes: '/dev/null', dryRun: true });
});

test('a missing or malformed version gives the usage error', () => {
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['--dry-run']), /usage/);
  assert.throws(() => parseArgs(['--notes', 'n.md']), /usage/);
  assert.throws(() => parseArgs(['v0.2.0']), /usage/);
  assert.throws(() => parseArgs(['0.2']), /usage/);
});

test('bad options are refused', () => {
  assert.throws(() => parseArgs(['0.2.0', '--notes']), /needs a file/);
  assert.throws(() => parseArgs(['0.2.0', '--notes', '--dry-run']), /needs a file/);
  assert.throws(() => parseArgs(['0.2.0', '--force']), /Unknown option/);
  assert.throws(() => parseArgs(['0.2.0', '0.3.0']), /Unexpected argument/);
});

test('versions compare numerically', () => {
  assert.ok(newer('0.10.0', '0.9.9'));
  assert.ok(!newer('0.2.0', '0.2.0'));
  assert.ok(!newer('0.1.9', '0.2.0'));
});
