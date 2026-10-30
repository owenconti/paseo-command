#!/usr/bin/env node
/** Check publication paths and personal home paths without printing their values.
 * Credential-pattern scanning is handled separately by Gitleaks. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
const refIndex = process.argv.indexOf('--ref');
const ref = refIndex >= 0 ? process.argv[refIndex + 1] : undefined;
if (refIndex >= 0 && !/^[a-f0-9]{40,64}$/.test(ref ?? '')) throw new Error('--ref requires a full Git object ID');
const history = !!ref || process.argv.includes('--history');
const revision = ref ?? 'HEAD';
const forbidden = /^(?:archive\/|\.paseo-command\/|\.agents\/skills\/|design\/references\/|game\/|phaser\/|dist\/|rendering\/(?:public\/assets\/probe\.png|src\/assets\/(?:probe\.png|galaxy\/))|web\/src\/fixtures\/fleet\.json$)|(?:^|\/)(?:\.env(?:\..*)?|secrets\.json|credentials\.json|\.npmrc|\.netrc|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx|sqlite(?:-.*)?|db(?:-.*)?)$/;
const homes = /\/(?:Users|home)\/([A-Za-z0-9_.-]+)(?=\/)/g;
const examples = new Set(['example', 'me', 'review', 'runner', 'in']);
const issues = new Set();
function checkPath(path) {
  if (path.endsWith('/.env.example') || path === '.env.example') return;
  if (forbidden.test(path)) issues.add(`Excluded publication path: ${path}`);
}
function checkText(bytes, label) {
  if (bytes.includes(0)) return;
  for (const match of bytes.toString('utf8').matchAll(homes))
    if (!examples.has(match[1])) issues.add(`Personal home path in ${label}`);
}

const paths = (ref ? git('ls-tree', '-r', '--name-only', '-z', ref) : git('ls-files', '-z'))
  .toString().split('\0').filter(Boolean);
for (const path of paths) {
  checkPath(path);
  if (ref) continue; // The object scan below checks committed content, not this worktree.
  try { checkText(readFileSync(path), path); }
  catch { issues.add(`Tracked file missing from checkout: ${path}`); }
}

if (history) {
  for (const path of git('log', '--format=', '--name-only', '--no-renames', revision).toString().split('\n').filter(Boolean)) checkPath(path);
  const objects = git('rev-list', '--objects', revision).toString().split('\n').filter(Boolean);
  const data = execFileSync('git', ['cat-file', '--batch'], {
    input: objects.map(row => row.split(' ')[0]).join('\n') + '\n',
    maxBuffer: 128 * 1024 * 1024,
  });
  let offset = 0;
  for (const row of objects) {
    const end = data.indexOf(10, offset);
    const [, type, sizeText] = data.subarray(offset, end).toString().split(' ');
    const size = Number(sizeText);
    if (end < 0 || !Number.isFinite(size)) throw new Error('Invalid git object response');
    const bytes = data.subarray(end + 1, end + 1 + size);
    if (type === 'blob') checkText(bytes, `historical ${row.slice(row.indexOf(' ') + 1)}`);
    if (type === 'commit') {
      checkText(bytes, 'commit message');
      for (const line of bytes.toString().split('\n').filter(line => /^(author|committer) /.test(line))) {
        if (!/<[^<>]+@users\.noreply\.github\.com>/.test(line))
          issues.add('Personal commit email in history; use a GitHub noreply address');
      }
    }
    offset = end + 2 + size;
  }
}

if (issues.size) {
  console.error([...issues].join('\n'));
  process.exitCode = 1;
} else console.log(`Publication checks passed (${paths.length} tracked files${history ? ', including committed history' : ''}).`);
