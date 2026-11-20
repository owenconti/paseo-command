/**
 * The Files tab's names for files: a workspace path (relative, `/`-separated, as `/api/files` takes it) and the
 * `file://` URI a language server knows it by, and which language and server group a file is.
 */

/** A server group of the `language-servers` plugin (its `SERVER_GROUPS`). */
export type ServerGroup = "typescript" | "php" | "python" | "go" | "rust" | "css" | "html" | "json" | "yaml" | "lua" | "ruby" | "swift" | "vue";

/** A file's language: CodeMirror's name for it (`@codemirror/language-data`), and the LSP id and server group, when one serves it. */
export type FileLanguage = { name: string; lsp?: { id: string; group: ServerGroup } };

const BY_EXT: Record<string, { name: string; id?: string; group?: ServerGroup }> = {
  ts: { name: "TypeScript", id: "typescript", group: "typescript" },
  mts: { name: "TypeScript", id: "typescript", group: "typescript" },
  cts: { name: "TypeScript", id: "typescript", group: "typescript" },
  tsx: { name: "TSX", id: "typescriptreact", group: "typescript" },
  js: { name: "JavaScript", id: "javascript", group: "typescript" },
  mjs: { name: "JavaScript", id: "javascript", group: "typescript" },
  cjs: { name: "JavaScript", id: "javascript", group: "typescript" },
  jsx: { name: "JSX", id: "javascriptreact", group: "typescript" },
  php: { name: "PHP", id: "php", group: "php" },
  py: { name: "Python", id: "python", group: "python" },
  pyi: { name: "Python", id: "python", group: "python" },
  go: { name: "Go", id: "go", group: "go" },
  rs: { name: "Rust", id: "rust", group: "rust" },
  css: { name: "CSS", id: "css", group: "css" },
  scss: { name: "SCSS", id: "scss", group: "css" },
  less: { name: "LESS", id: "less", group: "css" },
  html: { name: "HTML", id: "html", group: "html" },
  htm: { name: "HTML", id: "html", group: "html" },
  json: { name: "JSON", id: "json", group: "json" },
  jsonc: { name: "JSON", id: "jsonc", group: "json" },
  yaml: { name: "YAML", id: "yaml", group: "yaml" },
  yml: { name: "YAML", id: "yaml", group: "yaml" },
  lua: { name: "Lua", id: "lua", group: "lua" },
  rb: { name: "Ruby", id: "ruby", group: "ruby" },
  swift: { name: "Swift", id: "swift", group: "swift" },
  vue: { name: "Vue", id: "vue", group: "vue" },
  md: { name: "Markdown" },
  markdown: { name: "Markdown" },
  sh: { name: "Shell" },
  bash: { name: "Shell" },
  zsh: { name: "Shell" },
  sql: { name: "SQL" },
  xml: { name: "XML" },
  svg: { name: "XML" },
  toml: { name: "TOML" },
  java: { name: "Java" },
  kt: { name: "Kotlin" },
  c: { name: "C" },
  h: { name: "C" },
  cpp: { name: "C++" },
  hpp: { name: "C++" },
  m: { name: "Objective-C" },
  dockerfile: { name: "Dockerfile" },
};
const BY_NAME: Record<string, string> = { Dockerfile: "dockerfile", Makefile: "", Gemfile: "rb", Rakefile: "rb", ".zshrc": "zsh", ".bashrc": "bash" };

/** The language of a file, by its name (`.blade.php` is PHP; unknown names are plain text). */
export function languageOf(path: string): FileLanguage | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = name in BY_NAME ? BY_NAME[name] : name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const known = ext ? BY_EXT[ext] : undefined;
  if (!known) return null;
  return { name: known.name, ...(known.id && known.group ? { lsp: { id: known.id, group: known.group } } : {}) };
}

/** A path segment as a URI encodes it (as `vscode-uri` does, which most servers use: `@` too). */
const encodeSegment = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** `file://` URI of an absolute folder or file path. */
export function fileUri(absolute: string): string {
  return `file://${absolute.split("/").map(encodeSegment).join("/")}`;
}

/** The absolute path a `file://` URI names, or null for another scheme. */
export function uriPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let rest = uri.slice(7);
  // file://host/path: only a local (empty or localhost) host.
  if (!rest.startsWith("/")) {
    if (!rest.startsWith("localhost/")) return null;
    rest = rest.slice(9);
  }
  try {
    return rest.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

/** Where a URI is: a path in the workspace (its root an absolute path), or outside it (its absolute path). */
export function placeOf(root: string, uri: string): { path: string } | { outside: string } | null {
  const abs = uriPath(uri);
  if (abs === null) return null;
  const base = root.replace(/\/+$/, "");
  if (abs.startsWith(`${base}/`)) {
    const path = abs.slice(base.length + 1);
    if (path && !path.split("/").some((s) => s === "" || s === "." || s === "..")) return { path };
  }
  return { outside: abs };
}

/** The URI of a workspace path. */
export const workspaceUri = (root: string, path: string) => fileUri(`${root.replace(/\/+$/, "")}/${path}`);
