#!/usr/bin/env node
/** Install a shared local pre-push hook, or inspect the exact commits Git will push. */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const root = dirname(common);
if (process.argv.includes('--install')) {
  const hook = join(common, 'hooks', 'pre-push');
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  if (existsSync(hook) && !readFileSync(hook, 'utf8').includes('Install a shared local pre-push hook'))
    throw new Error('An existing pre-push hook was preserved. Add the publication guard to it manually.');
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, source, { mode: 0o755 });
  console.log('Installed publication guard in the shared Git hooks directory.');
} else {
  for (const row of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
    const [, oid, destination] = row.split(/\s+/);
    if (/^0+$/.test(oid)) continue; // Deleting a ref publishes no objects.
    if (destination !== 'refs/heads/main') throw new Error('This checkout publishes main only. Old branches and tags must stay private.');
    execFileSync(process.execPath, [join(root, 'scripts', 'public-check.mjs'), '--history', '--ref', oid], {
      cwd: root,
      stdio: 'inherit',
    });
  }
}
