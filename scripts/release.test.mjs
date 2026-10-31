import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appcastXML } from './appcast.mjs';
import { appcastBuild, buildIsNewer, newer, parseArgs, releaseVersion } from './release.mjs';

test('the version is found in any position, with or without options', () => {
  const plain = { bump: undefined, notes: undefined, dryRun: false, unsigned: false };
  assert.deepEqual(parseArgs(['0.2.0']), { ...plain, version: '0.2.0' });
  assert.deepEqual(parseArgs(['0.2.0', '--dry-run']), { ...plain, version: '0.2.0', dryRun: true });
  assert.deepEqual(parseArgs(['--dry-run', '0.2.0']), { ...plain, version: '0.2.0', dryRun: true });
  assert.deepEqual(parseArgs(['--notes', 'n.md', '1.0.3']), { ...plain, version: '1.0.3', notes: 'n.md' });
  assert.deepEqual(parseArgs(['1.0.3', '--notes', 'n.md', '--dry-run']), { ...plain, version: '1.0.3', notes: 'n.md', dryRun: true });
  assert.deepEqual(parseArgs(['--dry-run', '--notes', '/dev/null', '0.2.1']), { ...plain, version: '0.2.1', notes: '/dev/null', dryRun: true });
  assert.deepEqual(parseArgs(['--unsigned', '0.2.0', '--dry-run']), { ...plain, version: '0.2.0', dryRun: true, unsigned: true });
});

test('omitting the version enables automatic selection with any release options', () => {
  const plain = { version: undefined, bump: undefined, notes: undefined, dryRun: false, unsigned: false };
  assert.deepEqual(parseArgs([]), plain);
  assert.deepEqual(parseArgs(['--dry-run']), { ...plain, dryRun: true });
  assert.deepEqual(parseArgs(['--notes', 'n.md', '--unsigned']), { ...plain, notes: 'n.md', unsigned: true });
  assert.deepEqual(parseArgs(['--bump', 'minor', '--dry-run']), { ...plain, bump: 'minor', dryRun: true });
  assert.deepEqual(parseArgs(['--notes', 'n.md', '--bump', 'major']), { ...plain, bump: 'major', notes: 'n.md' });
  assert.deepEqual(parseArgs(['--bump', 'patch']), { ...plain, bump: 'patch' });
});

test('a malformed version gives the usage error', () => {
  assert.throws(() => parseArgs(['v0.2.0']), /usage/);
  assert.throws(() => parseArgs(['0.2']), /usage/);
  assert.throws(() => parseArgs(['01.2.0']), /usage/);
  assert.throws(() => parseArgs(['1.0.0-beta.1']), /usage/);
});

test('bad options are refused', () => {
  assert.throws(() => parseArgs(['0.2.0', '--notes']), /needs a file/);
  assert.throws(() => parseArgs(['0.2.0', '--notes', '--dry-run']), /needs a file/);
  assert.throws(() => parseArgs(['0.2.0', '--force']), /Unknown option/);
  assert.throws(() => parseArgs(['0.2.0', '0.3.0']), /Unexpected argument/);
  assert.throws(() => parseArgs(['--bump']), /needs patch, minor or major/);
  assert.throws(() => parseArgs(['--bump', '--dry-run']), /needs patch, minor or major/);
  assert.throws(() => parseArgs(['--bump', 'feature']), /needs patch, minor or major/);
  assert.throws(() => parseArgs(['--bump', 'patch', '--bump', 'minor']), /only be given once/);
  assert.throws(() => parseArgs(['0.3.0', '--bump', 'minor']), /not both/);
  assert.throws(() => parseArgs(['--bump', 'minor', '0.3.0']), /not both/);
});

test('automatic selection increments the highest published patch numerically', () => {
  assert.equal(releaseVersion('0.2.1', ['v0.2.1', 'v0.2.0']), '0.2.2');
  assert.equal(releaseVersion('0.2.1', ['v0.9.9', 'v0.10.9', 'v0.2.1']), '0.10.10');
  assert.equal(releaseVersion('0.2.1', ['v0.2.1', 'v1.0.0-beta.1', 'unrelated']), '0.2.2');
});

test('automatic selection keeps an unpublished package version, including the first release', () => {
  assert.equal(releaseVersion('0.2.0', []), '0.2.0');
  assert.equal(releaseVersion('0.3.0', ['v0.2.1']), '0.3.0');
  assert.throws(() => releaseVersion('invalid', []), /Invalid package.json version/);
});

test('requested bumps reset lower components and use the newer of package and published versions', () => {
  assert.equal(releaseVersion('0.2.9', ['v0.2.9'], { bump: 'patch' }), '0.2.10');
  assert.equal(releaseVersion('0.2.9', ['v0.2.9'], { bump: 'minor' }), '0.3.0');
  assert.equal(releaseVersion('0.2.9', ['v0.2.9'], { bump: 'major' }), '1.0.0');
  assert.equal(releaseVersion('0.2.1', ['v1.2.3'], { bump: 'minor' }), '1.3.0');
  assert.equal(releaseVersion('1.2.3', ['v0.2.1'], { bump: 'minor' }), '1.3.0');
  assert.equal(releaseVersion('0.2.1', [], { bump: 'minor' }), '0.3.0');
});

test('an explicit version remains an override, checked against published releases by the release preflight', () => {
  assert.equal(releaseVersion('0.2.1', ['v0.2.1'], { version: '1.0.0' }), '1.0.0');
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
