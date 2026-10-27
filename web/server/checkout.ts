import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * This repository's main checkout: the directory itself when it holds
 * `.git`, else the checkout a linked worktree's `.git` file points back to.
 * Read from the files, never a shell. `PASEO_COMMAND_REPO` overrides.
 */
export function mainCheckout(cwd = process.cwd()) {
  if (process.env.PASEO_COMMAND_REPO)
    return resolve(process.env.PASEO_COMMAND_REPO);
  let dir = resolve(cwd);
  for (;;) {
    const git = join(dir, ".git");
    if (existsSync(git)) {
      if (statSync(git).isDirectory()) return dir;
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(git, "utf8"));
      if (!m) return dir;
      const gitdir = isAbsolute(m[1].trim())
        ? m[1].trim()
        : resolve(dir, m[1].trim());
      // <main>/.git/worktrees/<name> → <main>
      const at = gitdir.lastIndexOf(`${join(".git", "worktrees")}`);
      return at > 0 ? dirname(gitdir.slice(0, at + 4)) : dir;
    }
    const up = dirname(dir);
    if (up === dir) return resolve(cwd);
    dir = up;
  }
}
