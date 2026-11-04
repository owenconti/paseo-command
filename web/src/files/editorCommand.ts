/**
 * Settings → Files' "Open files in": the built-in viewer, or an editor command
 * of the user's (`nvim {file}`, `{line}` too) run in a daemon terminal in the
 * workspace's folder. Pure, so the server (`web/server/api/files.ts`, which
 * alone builds what runs) and the page share it, and the tests run it.
 *
 * The command is the user's own shell text; only `{file}` and `{line}` are
 * filled in, the path single-quoted (POSIX quoting, which bash, zsh and fish
 * all read the same way for the paths the Files page allows: relative, no
 * backslashes or NULs) and the line a plain number, so a file's name can never
 * become shell syntax. It runs under the host's login shell, interactive, as
 * the Terminal tab's shells do, so the editor's own PATH, config and LSP apply.
 */
export type OpenIn = "viewer" | "editor";
export type FilesSettings = { openIn: OpenIn; editorCommand: string };

export const DEFAULT_EDITOR_COMMAND = "nvim {file}";
export const DEFAULT_FILES_SETTINGS: FilesSettings = { openIn: "viewer", editorCommand: DEFAULT_EDITOR_COMMAND };
export const EDITOR_COMMAND_MAX = 300;
const PLACEHOLDER = /\{([A-Za-z_]+)\}/g;

/** What's wrong with a command, or null when it can be used. */
export function editorCommandProblem(template: string): string | null {
  const t = template.trim();
  if (!t) return "Enter the command that opens a file, such as nvim {file}.";
  if (t.length > EDITOR_COMMAND_MAX) return `Keep the command under ${EDITOR_COMMAND_MAX} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(t)) return "The command must be one line, without control characters.";
  for (const [, name] of t.matchAll(PLACEHOLDER))
    if (name !== "file" && name !== "line") return `Unknown placeholder {${name}}: use {file} and {line}.`;
  if (!t.includes("{file}")) return "Include {file} where the file's path goes.";
  // The placeholders are quoted for you: inside quotes, the quoting would be read literally.
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") i++;
    else if (quote === '"') {
      if (c === '"') quote = null;
    } else if (c === "'" || c === '"') quote = c;
    if (quote && t[i] === "{" && /^\{(file|line)\}/.test(t.slice(i)))
      return "Leave {file} and {line} unquoted: they're quoted for you.";
  }
  if (quote) return "The command has an unclosed quote.";
  return null;
}

/** A word the shell reads as exactly `text`. */
export const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** The shell text for one file: `{file}` its quoted path (relative to the workspace), `{line}` its line. */
export function editorCommandLine(template: string, file: string, line = 1): string {
  const problem = editorCommandProblem(template);
  if (problem) throw new Error(problem);
  const n = Number.isInteger(line) && line > 0 && line < 10_000_000 ? line : 1;
  // A path that starts with "-" would read as an option: "./" keeps it a path.
  const path = file.startsWith("-") ? `./${file}` : file;
  return template.trim().replace(PLACEHOLDER, (_, name: string) => (name === "file" ? shellQuote(path) : String(n)));
}

/** What the daemon starts: the host's login shell, interactive (the user's PATH, rc files, LSP setup),
 * running the command and ending with it, so the terminal ends when the editor does. `/bin/sh` only
 * finds that shell (`$SHELL`); the command reaches it as an argument, never as text sh reads. */
export function editorLaunch(template: string, file: string, line?: number): { command: string; args: string[] } {
  return {
    command: "/bin/sh",
    args: ["-c", 'exec "${SHELL:-/bin/sh}" -l -i -c "$1"', "paseo-editor", editorCommandLine(template, file, line)],
  };
}

/** The settings file's `files` object, read leniently: anything odd is the default. */
export function filesSettings(raw: unknown): FilesSettings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const command = typeof r.editorCommand === "string" && !editorCommandProblem(r.editorCommand) ? r.editorCommand.trim() : DEFAULT_EDITOR_COMMAND;
  return { openIn: r.openIn === "editor" ? "editor" : "viewer", editorCommand: command };
}
