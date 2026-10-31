import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appcastXML } from './appcast.mjs';
import { appcastBuild, buildIsNewer, newer, parseArgs } from './release.mjs';

test('the version is found in any position, with or without options', () => {
  const plain = { notes: undefined, dryRun: false, unsigned: false };
  assert.deepEqual(parseArgs(['0.2.0']), { ...plain, version: '0.2.0' });
  assert.deepEqual(parseArgs(['0.2.0', '--dry-run']), { ...plain, version: '0.2.0', dryRun: true });
  assert.deepEqual(parseArgs(['--dry-run', '0.2.0']), { ...plain, version: '0.2.0', dryRun: true });
  assert.deepEqual(parseArgs(['--notes', 'n.md', '1.0.3']), { ...plain, version: '1.0.3', notes: 'n.md' });
  assert.deepEqual(parseArgs(['1.0.3', '--notes', 'n.md', '--dry-run']), { ...plain, version: '1.0.3', notes: 'n.md', dryRun: true });
  assert.deepEqual(parseArgs(['--dry-run', '--notes', '/dev/null', '0.2.1']), { ...plain, version: '0.2.1', notes: '/dev/null', dryRun: true });
  assert.deepEqual(parseArgs(['--unsigned', '0.2.0', '--dry-run']), { ...plain, version: '0.2.0', dryRun: true, unsigned: true });
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

test('the published build number is read from an appcast', () => {
  const xml = appcastXML({ version: '0.2.0', build: '512', date: 0, url: 'https://x/a.zip', length: 1, edSignature: 'sig', notesHTML: '' });
  assert.equal(appcastBuild(xml), 512);
  assert.equal(appcastBuild('<item><sparkle:version>77</sparkle:version></item>'), 77);
  assert.equal(appcastBuild('<item sparkle:version="3"/><item sparkle:version="40"/>'), 40);
  assert.equal(appcastBuild('<rss/>'), undefined);
});

test('a build must be strictly greater than the published one', () => {
  assert.ok(buildIsNewer('513', 512));
  assert.ok(!buildIsNewer('512', 512));
  assert.ok(!buildIsNewer('99', 512));
  assert.ok(buildIsNewer('1000', 999), 'numeric, not textual');
  assert.ok(buildIsNewer('1', undefined), 'nothing published yet');
  assert.ok(!buildIsNewer('abc', undefined));
});
