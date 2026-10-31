import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeDmg, verifyDmg } from './dmg.mjs';

test('the disk image holds the app and an Applications link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmg-test-'));
  try {
    const app = join(dir, 'Sample.app');
    mkdirSync(join(app, 'Contents'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist/>');
    const dmg = join(dir, 'Sample.dmg');
    makeDmg(app, dmg, 'Sample');
    verifyDmg(dmg, 'Sample.app');
    rmSync(join(app, 'Contents', 'Info.plist'));
    makeDmg(app, dmg, 'Sample');
    assert.throws(() => verifyDmg(dmg, 'Sample.app'), /has no Sample.app/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
