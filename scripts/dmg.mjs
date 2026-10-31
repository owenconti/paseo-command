#!/usr/bin/env node
/**
 * The release's disk image: the app beside an Applications shortcut, to drag it onto.
 *   node scripts/dmg.mjs <app> <dmg>   makes and checks the image (release.mjs does this itself)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A compressed, read-only image of `app` and an /Applications link, named like the volume. */
export function makeDmg(app, dmg, volume = 'Paseo Command') {
  const stage = mkdtempSync(join(tmpdir(), 'paseo-dmg-'));
  try {
    run('ditto', [app, join(stage, basename(app))]);
    symlinkSync('/Applications', join(stage, 'Applications'));
    rmSync(dmg, { force: true });
    run('hdiutil', ['create', '-volname', volume, '-srcfolder', stage, '-format', 'UDZO', '-ov', dmg]);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** The image checks out and, mounted, holds the app and the Applications link. */
export function verifyDmg(dmg, appName = 'Paseo Command.app') {
  run('hdiutil', ['verify', dmg]);
  const mount = mkdtempSync(join(tmpdir(), 'paseo-dmg-mount-'));
  try {
    run('hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount]);
    try {
      if (!existsSync(join(mount, appName, 'Contents', 'Info.plist'))) throw new Error(`${dmg} has no ${appName}.`);
      if (!lstatSync(join(mount, 'Applications')).isSymbolicLink()) throw new Error(`${dmg} has no Applications link.`);
    } finally {
      run('hdiutil', ['detach', mount]);
    }
  } finally {
    rmSync(mount, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [app, dmg] = process.argv.slice(2);
  try {
    if (!app || !dmg) throw new Error('usage: node scripts/dmg.mjs <app> <dmg>');
    makeDmg(app, dmg);
    verifyDmg(dmg, basename(app));
    console.log(dmg);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
