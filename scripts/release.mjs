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
const FEED_URL = `${REPO_URL}/releases/latest/download/appcast.xml`;

const USAGE = 'usage: npm run release -- <version> [--notes <file>] [--dry-run]  (version like 0.2.1)';

/** The command line in any order: one semver version, optionally `--notes <file>` and `--dry-run`. */
export function parseArgs(argv) {
  let version;
  let notes;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--notes') {
      notes = argv[++i];
      if (!notes || notes.startsWith('--')) throw new Error(`--notes needs a file. ${USAGE}`);
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}. ${USAGE}`);
    else if (version === undefined) version = arg;
    else throw new Error(`Unexpected argument ${arg}. ${USAGE}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(USAGE);
  return { version, notes, dryRun };
}

let dryRun = false;
let version;
let notesFile;
let committed = false;

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
export function newer(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** The highest `sparkle:version` (build number) in an appcast, attribute or element, or undefined. */
export function appcastBuild(xml) {
  const builds = [...xml.matchAll(/sparkle:version(?:="|>)\s*(\d+)/g)].map((m) => Number(m[1]));
  return builds.length ? Math.max(...builds) : undefined;
}

/** Sparkle installs an update only when its build number is greater than the installed one's. */
export function buildIsNewer(build, published) {
  return /^\d+$/.test(String(build)) && (published === undefined || Number(build) > published);
}

/** The published appcast's build number; undefined when nothing is published yet (404). */
async function publishedBuild() {
  let response;
  try {
    response = await fetch(FEED_URL, { redirect: 'follow' });
  } catch (error) {
    check(false, `Could not fetch the published appcast (${error.message}), so the build number can't be checked.`);
    return undefined;
  }
  if (response.status === 404) return undefined;
  if (!response.ok) {
    check(false, `Fetching the published appcast gave HTTP ${response.status}, so the build number can't be checked.`);
    return undefined;
  }
  const build = appcastBuild(await response.text());
  if (build === undefined) throw new Error(`The published appcast (${FEED_URL}) has no sparkle:version.`);
  return build;
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

/** The highest vX.Y.Z among the GitHub releases, or undefined when none is published yet. */
function latestPublished(tags) {
  return tags
    .map((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1])
    .filter(Boolean)
    .reduce((best, v) => (best === undefined || newer(v, best) ? v : best), undefined);
}

async function main(original, tmp) {
  step('Checking the checkout');
  // The build number is the commit count, which a shallow clone gets wrong.
  if (git('rev-parse', '--is-shallow-repository') === 'true') throw new Error('This is a shallow clone. Run git fetch --unshallow first.');
  check(git('rev-parse', '--abbrev-ref', 'HEAD') === 'main', 'Releases are made from main.');
  check(git('status', '--porcelain', '--untracked-files=no') === '', 'The working tree has uncommitted changes.');
  git('fetch', 'origin');
  check(git('rev-parse', 'HEAD') === git('rev-parse', 'origin/main'), 'main differs from origin/main. Push or pull first.');

  // Everything the publish needs is checked before anything is built.
  try {
    out('gh', ['auth', 'status'], { stdio: 'pipe' });
  } catch {
    throw new Error('gh is not signed in. Run gh auth login first.');
  }
  const published = JSON.parse(out('gh', ['release', 'list', '--limit', '200', '--json', 'tagName']));
  const tags = published.map((release) => release.tagName);
  if (tags.includes(`v${version}`)) throw new Error(`A GitHub release v${version} already exists.`);
  if (git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`)) throw new Error(`A tag v${version} already exists on origin.`);
  const latest = latestPublished(tags);
  if (latest && !newer(version, latest)) throw new Error(`Version ${version} must be greater than the latest release ${latest}.`);
  console.log(latest ? `Latest release is ${latest}.` : 'No release is published yet.');
  // bundle.sh numbers the build by the commit count; Sparkle skips a build that isn't newer.
  const nextBuild = git('rev-list', '--count', 'HEAD');
  const lastBuild = await publishedBuild();
  if (!buildIsNewer(nextBuild, lastBuild)) throw new Error(`Build ${nextBuild} must be greater than the published build ${lastBuild}, or installed apps won't update.`);

  step('Tests');
  const failures = [];
  for (const script of [['run', 'public:check', '--', '--history'], ['run', 'app:test'], ['run', 'render:test'], ['run', 'native:test']])
    try {
      out('npm', script, { stdio: 'inherit' });
    } catch {
      failures.push(`npm ${script.join(' ')}`);
    }
  if (failures.length) throw new Error(`Not releasing: these failed (output above):\n  ${failures.join('\n  ')}`);

  const notes = gatherNotes(tmp);

  step(`Building ${version}`);
  // package.json may already carry the version (the first release is 0.2.0): then nothing is bumped.
  writeFileSync(packagePath, original.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`));
  out('npm', ['run', 'app:build'], { stdio: 'inherit' });
  out('npm', ['run', 'app:bundle-server'], { stdio: 'inherit' });
  const bundle = spawnSync('sh', ['native/scripts/bundle.sh', '--release'], { cwd: root, stdio: 'inherit' });
  if (bundle.status !== 0) throw new Error('The release build failed (see above). If it asks for it, run npm run release:setup first.');
  const app = join(releaseDir, 'Paseo Command.app');

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
  if (!buildIsNewer(build, lastBuild)) throw new Error(`The app's build ${build} is not greater than the published build ${lastBuild}.`);
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
  const bumped = git('diff', '--name-only', '--', 'package.json') !== '';
  if (bumped) {
    git('add', 'package.json');
    git('commit', '-m', `Release v${version}`);
    committed = true;
  }
  const sha = git('rev-parse', 'HEAD');
  if (bumped) git('push', 'origin', 'main');
  else console.log(`package.json already says ${version}: nothing to commit or push.`);
  const appcast = join(releaseDir, 'appcast.xml');
  const create = ['release', 'create', `v${version}`, '--target', sha, '--title', `Paseo Command ${version}`, '--notes-file', notesPath, zip, appcast];
  try {
    out('gh', create, { stdio: 'inherit' });
  } catch {
    const kept = join(releaseDir, `release-notes-${version}.md`);
    writeFileSync(kept, notes);
    const state = bumped ? `Release v${version} is committed and main is pushed (${sha})` : `Nothing was committed or pushed (main is at ${sha})`;
    throw new Error(`${state}, but creating the GitHub release failed. Finish by hand:\n  gh release create v${version} --target ${sha} --title "Paseo Command ${version}" --notes-file ${kept} ${zip} ${appcast}`);
  }
  console.log(`\nReleased v${version} at ${sha}.`);
}

async function run() {
  const parsed = parseArgs(process.argv.slice(2));
  ({ version, notes: notesFile, dryRun } = parsed);
  const original = readFileSync(packagePath, 'utf8');
  const tmp = mkdtempSync(join(tmpdir(), 'paseo-release-'));
  try {
    await main(original, tmp);
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  } finally {
    // A dry run, or a run that stopped before its commit, leaves package.json as it found it.
    if (!committed && (dryRun || process.exitCode)) writeFileSync(packagePath, original);
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
