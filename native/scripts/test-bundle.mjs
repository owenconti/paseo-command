// Checks the built app bundles: each flavour carries a universal Node of the pinned version,
// the server and the page, with the right identity, and verifies as signed.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pinned = JSON.parse(readFileSync(join(root, 'native/node-version.json'), 'utf8')).version;
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const flavours = [
  { flavour: 'dev', dir: 'Paseo Command Dev.app', id: 'io.github.owenconti.paseo-command.dev', name: 'Paseo Command Dev', port: '4321' },
  { flavour: 'release', dir: 'Paseo Command.app', id: 'io.github.owenconti.paseo-command', name: 'Paseo Command', port: '4310' },
];

let checked = 0;
const failures = [];
for (const f of flavours) {
  const app = join(root, 'native/build', f.dir);
  if (!existsSync(app)) { console.log(`skip ${f.dir}: not built`); continue; }
  const check = (label, ok, detail = '') => { if (!ok) failures.push(`${f.dir}: ${label} ${detail}`.trim()); };
  const res = join(app, 'Contents/Resources');
  const node = join(res, 'node/node');
  check('node exists', existsSync(node));
  if (existsSync(node)) {
    const archs = run('lipo', ['-archs', node]).split(/\s+/);
    check('node is universal', archs.includes('arm64') && archs.includes('x86_64'), `(${archs})`);
    check('node version', run(node, ['--version']) === `v${pinned}`, `(want v${pinned})`);
  }
  check('server.mjs', existsSync(join(res, 'server/server.mjs')));
  check('ui/index.html', existsSync(join(res, 'ui/index.html')));
  const key = k => { try { return run('/usr/libexec/PlistBuddy', ['-c', `Print :${k}`, join(app, 'Contents/Info.plist')]); } catch { return '<missing>'; } };
  for (const [k, want] of [
    ['CFBundleIdentifier', f.id], ['CFBundleName', f.name], ['CFBundleShortVersionString', version],
    ['PaseoCommandFlavor', f.flavour], ['PaseoCommandPort', f.port],
  ]) check(k, key(k) === want, `(got ${key(k)}, want ${want})`);
  const build = key('CFBundleVersion');
  check('CFBundleVersion', /^[1-9][0-9]*$/.test(build), `(got ${build}, want a positive integer)`);
  try { run('codesign', ['--verify', '--deep', '--strict', app]); } catch (e) { check('codesign', false, String(e.stderr ?? e).trim()); }
  checked++;
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(checked ? `bundle checks passed (${checked} flavour${checked > 1 ? 's' : ''})` : 'no app built; run npm run native:build first');
