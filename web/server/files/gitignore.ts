/**
 * `.gitignore` rules, as git reads them, for the Files page's tree: the daemon
 * lists every entry and says nothing of git's ignores, so the server reads
 * the `.gitignore` files on the way down (and `.git/info/exclude`) and marks
 * what they ignore. Pure, so the tests run it.
 *
 * Not git's whole story: the user's global excludes aren't read (they live
 * outside the workspace), and a file git already tracks still shows ignored
 * if a pattern matches it.
 */

/** One pattern of one file: its base directory (`""` the workspace's root), the compiled pattern, and how it applies. */
export type IgnoreRule = { base: string; re: RegExp; negate: boolean; dirOnly: boolean };

/** A glob's characters as a regular expression's (`*` within a segment, `**` across them, `?`, `[…]`). */
function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const before = i === 0 || glob[i - 1] === "/";
        const after = i + 2 === glob.length || glob[i + 2] === "/";
        if (before && after) {
          if (i + 2 === glob.length) out += ".*";
          else {
            // `**/` anywhere: none or any directories.
            out += "(?:.*/)?";
            i++;
          }
          i++;
          continue;
        }
      }
      out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end < 0) {
        out += "\\[";
        continue;
      }
      let set = glob.slice(i + 1, end);
      if (set.startsWith("!")) set = `^${set.slice(1)}`;
      out += `[${set.replace(/\\/g, "\\\\")}]`;
      i = end;
    } else if (c === "\\" && i + 1 < glob.length) {
      out += glob[++i]!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    } else out += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return out;
}

/** A `.gitignore`'s rules, its patterns relative to `base`. */
export function parseIgnore(text: string, base = ""): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Trailing spaces go unless escaped.
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith("\\!") || line.startsWith("\\#")) line = line.slice(1);
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.replace(/\/+$/, "");
    }
    if (!line) continue;
    // A slash before the end anchors the pattern to its file's directory; else it matches at any depth.
    const anchored = line.includes("/");
    line = line.replace(/^\/+/, "");
    if (!line) continue;
    try {
      rules.push({ base, re: new RegExp(`^${anchored ? "" : "(?:.*/)?"}${globToRegex(line)}$`), negate, dirOnly });
    } catch {
      // A pattern git would reject too is skipped.
    }
  }
  return rules;
}

/**
 * Whether `path` (from the workspace's root) is ignored by the rules, read
 * root first and each file's lines in order: the last that matches decides, so
 * a deeper `.gitignore` and a later `!` win. A directory's own ignore
 * covers what's in it; that the caller decides (it doesn't list into one).
 */
export function isIgnored(rules: readonly IgnoreRule[], path: string, isDir: boolean): boolean {
  let ignored = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.base && !path.startsWith(`${r.base}/`)) continue;
    const rel = r.base ? path.slice(r.base.length + 1) : path;
    if (r.re.test(rel)) ignored = !r.negate;
  }
  return ignored;
}
