#!/usr/bin/env node
/**
 * npm run release -- <version> [--notes <file>] [--dry-run]
 * Tests, builds, signs and zips the app, writes the Sparkle appcast, then (unless --dry-run) commits
 * the version, pushes main and creates the GitHub release. The tag is made by GitHub (`gh release
 * create --target`), as the publication guard refuses to push tags. A dry run leaves the tree as it found it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appcastXML } from './appcast.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = join(root, 'package.json');
const sparkleBin = join(root, 'native', '.build', 'artifacts', 'sparkle', 'Sparkle', 'bin');
const releaseDir = join(root, 'native', 'release');
const REPO_URL = 'https://github.com/owenconti/paseo-command';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const notesIndex = args.indexOf('--notes');
const notesFile = notesIndex >= 0 ? args[notesIndex + 1] : undefined;
const version = args.find((arg, i) => !arg.startsWith('--') && i !== notesIndex + 1);

const out = (cmd, cmdArgs, options = {}) => (execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', ...options }) ?? '').trim();
const git = (...gitArgs) => out('git', gitArgs);
const step = (text) => console.log(`\n==> ${text}`);
/** A check that refuses a real release but only warns in a dry run (so it can be tried from a worktree). */
function check(ok, message) {
  if (ok) return;
  if (!dryRun) throw new Error(message);
  console.warn(`warning (dry run): ${message}`);
}

const parse = (v) => v.split('.').map(Number);
function newer(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Notes as Sparkle shows them: Markdown bullets and paragraphs as simple HTML. */
function notesToHTML(markdown) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = '';
  let inList = false;
  for (const line of markdown.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const bullet = /^[-*] (.*)$/.exec(line);
    if (bullet && !inList) html += '<ul>';
    if (!bullet && inList) html += '</ul>';
    inList = Boolean(bullet);
    html += bullet ? `<li>${escape(bullet[1])}</li>` : `<p>${escape(line)}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

/** The previous release's commit, or undefined when there is none (or it is not a commit we know). */
function previousReleaseCommit() {
  try {
    const sha = JSON.parse(out('gh', ['release', 'view', '--json', 'targetCommitish'], { stdio: ['ignore', 'pipe', 'pipe'] })).targetCommitish;
    if (/^[0-9a-f]{40}$/.test(sha)) {
      git('cat-file', '-e', `${sha}^{commit}`);
      return sha;
    }
  } catch {
    // No releases yet, no gh login or an unknown commit: fall back to recent history.
  }
  return undefined;
}

function gatherNotes(dir) {
  if (notesFile) return readFileSync(notesFile, 'utf8');
  const previous = previousReleaseCommit();
  const range = previous ? [`${previous}..HEAD`] : ['-n', '30'];
  const subjects = git('log', '--no-merges', '--format=- %s', ...range);
  const draft = join(dir, 'notes.md');
  writeFileSync(draft, `${subjects}\n`);
  if (process.stdin.isTTY) spawnSync(process.env.EDITOR || 'vi', [draft], { stdio: 'inherit' });
  return readFileSync(draft, 'utf8');
}

function main(original, tmp) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('usage: npm run release -- <version> [--notes <file>] [--dry-run]  (version like 0.2.1)');
  const current = JSON.parse(original).version;

  step('Checking the checkout');
  check(git('rev-parse', '--abbrev-ref', 'HEAD') === 'main', 'Releases are made from main.');
  check(git('status', '--porcelain', '--untracked-files=no') === '', 'The working tree has uncommitted changes.');
  git('fetch', 'origin');
  check(git('rev-parse', 'HEAD') === git('rev-parse', 'origin/main'), 'main differs from origin/main. Push or pull first.');
  check(newer(version, current), `Version ${version} must be greater than the current ${current}.`);

  step('Tests');
  for (const script of [['run', 'public:check', '--', '--history'], ['run', 'app:test'], ['run', 'render:test'], ['run', 'native:test']])
    try {
      out('npm', script, { stdio: 'inherit' });
    } catch (error) {
      check(false, `npm ${script.join(' ')} failed.`);
    }

  const notes = gatherNotes(tmp);

  step(`Building ${version}`);
  writeFileSync(packagePath, original.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`));
  out('npm', ['run', 'app:build'], { stdio: 'inherit' });
  out('npm', ['run', 'app:bundle-server'], { stdio: 'inherit' });
  const bundle = spawnSync('sh', ['native/scripts/bundle.sh', '--release'], { cwd: root, stdio: 'inherit' });
  if (bundle.status !== 0) throw new Error('The release build failed (see above). If it asks for it, run npm run release:setup first.');
  const app = join(root, 'native', 'build', 'Paseo Command.app');

  step('Zipping and signing');
  mkdirSync(releaseDir, { recursive: true });
  const zip = join(releaseDir, `Paseo-Command-${version}.zip`);
  rmSync(zip, { force: true });
  out('ditto', ['-c', '-k', '--keepParent', app, zip]);
  const signed = out(join(sparkleBin, 'sign_update'), [zip]);
  const edSignature = /sparkle:edSignature="([^"]+)"/.exec(signed)?.[1];
  if (!edSignature) throw new Error(`sign_update printed no signature: ${signed}`);
  const length = statSync(zip).size;
  const build = out('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', join(app, 'Contents', 'Info.plist')]);
  writeFileSync(
    join(releaseDir, 'appcast.xml'),
    appcastXML({
      version,
      build,
      date: new Date(),
      url: `${REPO_URL}/releases/download/v${version}/Paseo-Command-${version}.zip`,
      length,
      edSignature,
      notesHTML: notesToHTML(notes),
      minimumSystemVersion: '14.0',
    }),
  );

  step('Verifying');
  out('codesign', ['--verify', '--deep', '--strict', app]);
  out(join(sparkleBin, 'sign_update'), ['--verify', zip, edSignature]);
  const unpacked = join(tmp, 'unzipped');
  mkdirSync(unpacked);
  out('ditto', ['-x', '-k', zip, unpacked]);
  console.log(`bundled node ${out(join(unpacked, 'Paseo Command.app', 'Contents', 'Resources', 'node', 'node'), ['--version'])}`);

  if (dryRun) {
    console.log(`\nDry run done: ${zip} and appcast.xml are in native/release. Nothing was committed, pushed or published.`);
    return;
  }

  step('Publishing');
  const notesPath = join(tmp, 'release-notes.md');
  writeFileSync(notesPath, notes);
  git('add', 'package.json');
  git('commit', '-m', `Release v${version}`);
  committed = true;
  const sha = git('rev-parse', 'HEAD');
  git('push', 'origin', 'main');
  out('gh', ['release', 'create', `v${version}`, '--target', sha, '--title', `Paseo Command ${version}`, '--notes-file', notesPath, zip, join(releaseDir, 'appcast.xml')], { stdio: 'inherit' });
  console.log(`\nReleased v${version} at ${sha}.`);
}

const original = readFileSync(packagePath, 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'paseo-release-'));
let failed = false;
let committed = false;
try {
  main(original, tmp);
} catch (error) {
  failed = true;
  console.error(`\n${error.message}`);
} finally {
  // A dry run, or a run that stopped before its commit, leaves package.json as it found it.
  if (!committed && (dryRun || failed)) writeFileSync(packagePath, original);
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
