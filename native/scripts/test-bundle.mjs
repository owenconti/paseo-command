// Checks the built app bundles: each flavour carries an Apple silicon Node of the pinned version,
// the server and the page, with the right identity, and verifies as signed.
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pinned = JSON.parse(readFileSync(join(root, 'native/node-version.json'), 'utf8')).version;
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const flavours = [
  { flavour: 'dev', dir: 'native/build/Paseo Command Dev.app', id: 'io.github.owenconti.paseo-command.dev', name: 'Paseo Command Dev', port: '4321' },
  { flavour: 'release', dir: 'native/release/Paseo Command.app', id: 'io.github.owenconti.paseo-command', name: 'Paseo Command', port: '4310' },
];

let checked = 0;
const failures = [];
for (const f of flavours) {
  const app = join(root, f.dir);
  if (!existsSync(app)) { console.log(`skip ${f.dir}: not built`); continue; }
  const key = k => { try { return run('/usr/libexec/PlistBuddy', ['-c', `Print :${k}`, join(app, 'Contents/Info.plist')]); } catch { return '<missing>'; } };
  // An app from before the flavours (the old checkout app) is not one of these bundles.
  if (key('PaseoCommandFlavor') === '<missing>') { console.log(`skip ${f.dir}: no PaseoCommandFlavor (an older build)`); continue; }
  const check = (label, ok, detail = '') => { if (!ok) failures.push(`${f.dir}: ${label} ${detail}`.trim()); };
  const res = join(app, 'Contents/Resources');
  const node = join(res, 'node/node');
  check('node exists', existsSync(node));
  if (existsSync(node)) {
    const archs = run('lipo', ['-archs', node]).split(/\s+/).filter(Boolean);
    check('node is Apple silicon only', archs.length === 1 && archs[0] === 'arm64', `(${archs})`);
    check('node version', run(node, ['--version']) === `v${pinned}`, `(want v${pinned})`);
  }
  check('server.mjs', existsSync(join(res, 'server/server.mjs')));
  check('ui/index.html', existsSync(join(res, 'ui/index.html')));
  for (const [k, want] of [
    ['CFBundleIdentifier', f.id], ['CFBundleName', f.name], ['CFBundleShortVersionString', version],
    ['PaseoCommandFlavor', f.flavour], ['PaseoCommandPort', f.port],
  ]) check(k, key(k) === want, `(got ${key(k)}, want ${want})`);
  // Sparkle: its framework with symlinks kept; updates (and their keys) in the release only.
  const sparkle = join(app, 'Contents/Frameworks/Sparkle.framework');
  check('Sparkle.framework', existsSync(join(sparkle, 'Versions/B/Sparkle')));
  check('Sparkle symlinks kept', existsSync(sparkle) && lstatSync(join(sparkle, 'Versions/Current')).isSymbolicLink());
  const updates = f.flavour === 'release'
    ? [['SUFeedURL', 'https://github.com/owenconti/paseo-command/releases/latest/download/appcast.xml'],
       ['SUEnableAutomaticChecks', 'true'], ['SUAutomaticallyUpdate', 'true'], ['SUScheduledCheckInterval', '3600']]
    : [['SUFeedURL', '<missing>'], ['SUPublicEDKey', '<missing>']];
  for (const [k, want] of updates) check(k, key(k) === want, `(got ${key(k)}, want ${want})`);
  if (f.flavour === 'release') check('SUPublicEDKey', !['', '<missing>'].includes(key('SUPublicEDKey')));
  const build = key('CFBundleVersion');
  check('CFBundleVersion', /^[1-9][0-9]*$/.test(build), `(got ${build}, want a positive integer)`);
  try { run('codesign', ['--verify', '--deep', '--strict', app]); } catch (e) { check('codesign', false, String(e.stderr ?? e).trim()); }
  const adhoc = /flags=0x\w*\(adhoc/.test(execFileSync('sh', ['-c', 'codesign -dvv "$0" 2>&1', app], { encoding: 'utf8' }));
  if (f.flavour === 'release' && adhoc) console.log(`${f.dir}: unsigned (ad hoc) release build; Developer ID checks skipped`);
  if (f.flavour === 'release' && !adhoc) {
    // Notarization needs Developer ID signatures under the hardened runtime, with the entitlements it needs.
    for (const path of [app, join(res, 'node/node')]) {
      const info = execFileSync('sh', ['-c', 'codesign -dvv "$0" 2>&1', path], { encoding: 'utf8' });
      check(`${path.slice(app.length) || 'app'} Developer ID`, /Authority=Developer ID Application: /.test(info));
      check(`${path.slice(app.length) || 'app'} hardened runtime`, /flags=0x\w*\(runtime\)/.test(info));
      check(`${path.slice(app.length) || 'app'} timestamp`, /Timestamp=/.test(info));
    }
    const entitlements = (path) => execFileSync('sh', ['-c', 'codesign -d --entitlements - --xml "$0" 2>/dev/null', path], { encoding: 'utf8' });
    check('node may JIT', entitlements(join(res, 'node/node')).includes('com.apple.security.cs.allow-jit'));
  }
  checked++;
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(checked ? `bundle checks passed (${checked} flavour${checked > 1 ? 's' : ''})` : 'no app built; run npm run native:build first');
