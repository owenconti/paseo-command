#!/usr/bin/env node
/** Create a linked checkout inside the main repository's worktrees directory. */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const [branch, start = 'refs/heads/main', ...extra] = process.argv.slice(2);
if (!branch || branch === '--help' || extra.length) {
  console.log('Usage: npm run worktree:add -- <new-branch> [start-point]');
  if (branch !== '--help') process.exitCode = 1;
} else {
  try {
    git('check-ref-format', '--branch', branch);
    if (branch.startsWith('-') || branch === '@{-1}') throw new Error('Use a literal new branch name.');
    // The common Git directory belongs to main, even from a linked checkout.
    const root = dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir'));
    const parent = join(root, 'worktrees');
    mkdirSync(parent, { recursive: true });
    const target = join(parent, branch.replaceAll('/', '--'));
    execFileSync('git', ['worktree', 'add', '-b', branch, target, start], { cwd, stdio: 'inherit' });
    console.log(`Worktree: ${target}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
