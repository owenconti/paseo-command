/**
 * The Files page's reads: a workspace's folders and files, from its host's
 * daemon (its file explorer: `listDirectory`, `readFile`), so remote hosts'
 * workspaces work as local ones do. Never writes.
 *
 * - `GET /api/files/tree?workspace=&host=&dir=`: a directory's entries, each
 *   marked `ignored` when a `.gitignore` on the way down (or
 *   `.git/info/exclude`) ignores it, and `.git` itself.
 * - `GET /api/files/read?workspace=&host=&path=`: a text file, or why it isn't
 *   shown (binary, an image, past `FILE_LIMITS.maxBytes`).
 * - `GET /api/files/all?workspace=&host=`: every file not ignored (for
 *   quick-open and the filter), walked directory by directory, up to a cap.
 * - `GET /api/files/changed?workspace=&host=`: the changed files (all changes,
 *   as the GitHub tab's Changes shows them).
 * - `GET /api/files/version?workspace=&host=&path=`: what is on disk now (its
 *   modified time and revision), from a daemon subscription to the file held
 *   while it's asked about, so the Files tab notices an agent's edit cheaply.
 * - `POST /api/files/write`: the Files tab's save, through the daemon's
 *   `writeFile`, only over the version it read (`conflict` otherwise).
 * - `GET /api/files/image?workspace=&host=&path=`: a raster image's bytes (PNG,
 *   JPEG, GIF, WebP: by its name and its first bytes; never SVG), at most
 *   `FILES.maxImageBytes`, for a Markdown file's relative images.
 *
 * Paths are the workspace's (relative, `/`-separated): an absolute path,
 * `..`, `.` or an empty segment is refused before the daemon is asked, and the
 * daemon refuses whatever resolves outside the workspace (symlinks out). Each
 * answer is kept a few seconds (`fresh=1` asks again). Only `write` writes.
 */
import { FILE_LIMITS, type FileChange, type FileChanges, type FileEntry, type FileList, type FileRead, type FileTree, type FileVersion, type FileWrite } from "../../src/files/types";
import type { GithubUnavailable } from "../../src/github/types";
import { isIgnored, parseIgnore, type IgnoreRule } from "../files/gitignore";
import { redactText } from "../redact";
import { resolveHost, sdk, timed, type DaemonClient } from "./hosts";
import { aggregate } from "./reads";
import { id } from "./validate";

export const FILES = {
  /** How long each answer is kept. */
  treeMs: 5_000,
  readMs: 5_000,
  allMs: 30_000,
  changedMs: 10_000,
  /** The walk for `all`: at most this many directories, this many at once. */
  maxDirs: 4_000,
  concurrency: 12,
  /** A `.gitignore` past this isn't read. */
  maxIgnoreBytes: 256 * 1024,
  /** At most this many answers are kept. */
  maxCached: 2_000,
  /** A file's version is watched (one daemon subscription) until it hasn't been asked about for this long. */
  watchMs: 30_000,
  /** A larger image isn't sent. */
  maxImageBytes: 10 * 1024 * 1024,
};

/** The images `image` sends, by extension; each checked against its first bytes too. */
const IMAGE_TYPES: Record<string, { mime: string; magic: (b: Uint8Array) => boolean }> = {
  png: { mime: "image/png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  jpg: { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { mime: "image/gif", magic: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  webp: { mime: "image/webp", magic: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
};

const OUTSIDE = "Access outside of workspace is not allowed";

/** A workspace path from the page: relative, `/`-separated, no `..`, `.` or empty segments (`""` the root). */
export function checkPath(raw: string | null, label = "path"): string {
  const p = raw ?? "";
  if (p === "" || p === ".") return "";
  if (p.length > 4096 || p.includes("\0") || p.includes("\\") || p.startsWith("/") || p.startsWith("~"))
    throw new Error(`Invalid ${label}`);
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) throw new Error(`Invalid ${label}`);
  return p;
}

export type Workspace = { client: DaemonClient; cwd: string; key: string };

/** The workspace's folder on its host, and that host's client. */
export async function workspaceOf(params: URLSearchParams, allowed: string[]): Promise<Workspace> {
  for (const k of params.keys()) if (!["workspace", "host", "fresh", ...allowed].includes(k)) throw new Error(`Unexpected parameter ${k}`);
  const workspaceId = id(params.get("workspace"));
  const host = await resolveHost(params.get("host"));
  const rows = (await aggregate("workspaces")).rows as { workspaceId?: string; host?: string; cwd?: string }[];
  const ws = rows.find((w) => w.workspaceId === workspaceId && (w.host || "") === (host?.serverId || ""));
  if (!ws?.cwd) throw new Error("Unknown workspace");
  return { client: await sdk(host), cwd: ws.cwd, key: `${host?.serverId || ""}|${ws.cwd}` };
}

// ── A short cache, by workspace and request ─────────────────────────────────
const kept = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, ms: number, fresh: boolean, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = kept.get(key);
  if (hit && !fresh && now - hit.at < ms) return hit.value as Promise<T>;
  const value = load();
  kept.set(key, { at: now, value });
  // A failure isn't kept.
  value.catch(() => {
    if (kept.get(key)?.value === value) kept.delete(key);
  });
  if (kept.size > FILES.maxCached) {
    for (const [k, v] of kept) if (now - v.at > 60_000 || kept.size > FILES.maxCached) kept.delete(k);
  }
  return value;
}
/** Tests start from nothing kept. */
export function resetFilesCache() {
  kept.clear();
}

/** The daemon's message, as the page should read it. */
function daemonError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(OUTSIDE)) return new Error("That path is outside the workspace.");
  if (/ENOENT|no such file/i.test(message)) return new Error("That file or folder isn't there any more.");
  if (/ENOTDIR|not a directory/i.test(message)) return new Error("That isn't a folder.");
  return new Error(redactText(message).slice(0, 300));
}

const byName = (a: FileEntry, b: FileEntry) =>
  a.kind !== b.kind ? (a.kind === "directory" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || (a.name < b.name ? -1 : 1);

/** A directory's entries as the daemon lists them, without their ignores; kept to their known fields. */
function listing(ws: Workspace, dir: string, fresh: boolean): Promise<FileEntry[]> {
  return cached(`${ws.key}|list|${dir}`, FILES.treeMs, fresh, async () => {
    const r = await timed(ws.client.listDirectory(ws.cwd, dir || "."), undefined, ws.client).catch((e) => {
      throw daemonError(e);
    });
    const entries: FileEntry[] = [];
    for (const e of (Array.isArray(r?.entries) ? r.entries : []) as { name?: unknown; kind?: unknown; size?: unknown }[]) {
      const name = typeof e?.name === "string" ? e.name : "";
      // Only the directory's own children, by name (never the daemon's idea of a path).
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) continue;
      entries.push({
        name,
        path: dir ? `${dir}/${name}` : name,
        kind: e.kind === "directory" ? "directory" : "file",
        size: typeof e.size === "number" && e.size >= 0 ? e.size : 0,
      });
    }
    return entries.sort(byName);
  });
}

/** A text file's contents through the daemon, at most `max` bytes; null when it isn't there. */
async function readText(ws: Workspace, path: string, max: number): Promise<string | null> {
  try {
    const r = await timed(ws.client.readFile(ws.cwd, path, undefined, max), undefined, ws.client);
    if (r.kind !== "text") return null;
    return new TextDecoder().decode(r.bytes);
  } catch {
    return null;
  }
}

/** One directory's own ignore rules: its `.gitignore` (and, at the root, `.git/info/exclude`). */
function ownRules(ws: Workspace, dir: string, hasIgnoreFile: boolean | undefined, fresh: boolean): Promise<IgnoreRule[]> {
  return cached(`${ws.key}|ignore|${dir}`, FILES.treeMs, fresh, async () => {
    const at = (name: string) => (dir ? `${dir}/${name}` : name);
    // Whether it has one, from its listing when that's known.
    const has = hasIgnoreFile ?? (await listing(ws, dir, false).catch(() => [])).some((e) => e.name === ".gitignore" && e.kind === "file");
    const [own, exclude] = await Promise.all([
      has ? readText(ws, at(".gitignore"), FILES.maxIgnoreBytes) : null,
      dir ? null : readText(ws, ".git/info/exclude", FILES.maxIgnoreBytes),
    ]);
    return [...(exclude ? parseIgnore(exclude, "") : []), ...(own ? parseIgnore(own, dir) : [])];
  });
}

/** The ancestors of a directory, the root first, itself last. */
const chainOf = (dir: string) => (dir ? ["", ...dir.split("/").map((_, i, all) => all.slice(0, i + 1).join("/"))] : [""]);

/** Every rule that applies in `dir`: its ancestors' and its own. */
async function rulesFor(ws: Workspace, dir: string, entries: FileEntry[] | undefined, fresh: boolean): Promise<IgnoreRule[]> {
  const chain = chainOf(dir);
  const sets = await Promise.all(
    chain.map((d) =>
      ownRules(ws, d, d === dir && entries ? entries.some((e) => e.name === ".gitignore" && e.kind === "file") : undefined, fresh && d === dir),
    ),
  );
  return sets.flat();
}

const marked = (entries: FileEntry[], rules: IgnoreRule[]): FileEntry[] =>
  entries.map((e) => (e.name === ".git" || isIgnored(rules, e.path, e.kind === "directory") ? { ...e, ignored: true as const } : e));

export async function filesTree(params: URLSearchParams): Promise<FileTree> {
  const ws = await workspaceOf(params, ["dir"]);
  const dir = checkPath(params.get("dir"), "folder");
  const fresh = params.get("fresh") === "1";
  const entries = await listing(ws, dir, fresh);
  return { dir, entries: marked(entries, await rulesFor(ws, dir, entries, fresh)) };
}

export async function filesRead(params: URLSearchParams): Promise<FileRead> {
  const ws = await workspaceOf(params, ["path"]);
  const path = checkPath(params.get("path"));
  if (!path) throw new Error("A file is required");
  const fresh = params.get("fresh") === "1";
  return cached(`${ws.key}|read|${path}`, FILES.readMs, fresh, async () => {
    // Its size from its folder's listing when that's at hand: a big file is refused unread.
    const slash = path.lastIndexOf("/");
    const folder = kept.get(`${ws.key}|list|${slash < 0 ? "" : path.slice(0, slash)}`);
    const known = folder ? ((await folder.value.catch(() => [])) as FileEntry[]).find((e) => e.path === path) : undefined;
    if (known && known.kind === "file" && known.size > FILE_LIMITS.maxBytes) return { path, size: known.size, refused: "large" as const };
    let r;
    try {
      r = await timed(ws.client.readFile(ws.cwd, path, undefined, FILE_LIMITS.maxBytes), undefined, ws.client);
    } catch (e) {
      if (/too large/i.test(e instanceof Error ? e.message : "")) return { path, size: known?.size ?? FILE_LIMITS.maxBytes + 1, refused: "large" as const };
      throw daemonError(e);
    }
    const size = typeof r.size === "number" ? r.size : r.bytes.byteLength;
    if (size > FILE_LIMITS.maxBytes || r.bytes.byteLength > FILE_LIMITS.maxBytes) return { path, size, refused: "large" as const };
    if (r.kind === "image") return { path, size, refused: "image" as const, ...(r.mime ? { mime: r.mime } : {}) };
    if (r.kind !== "text" || r.bytes.includes(0)) return { path, size, refused: "binary" as const };
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(r.bytes);
    } catch {
      return { path, size, refused: "binary" as const };
    }
    return { path, size, text, modifiedAt: r.modifiedAt, ...(r.revision ? { revision: r.revision } : {}) };
  });
}

/** Forgets what was kept of a file (its read, its folder's listing), after it was written. */
function forget(ws: Workspace, path: string) {
  const slash = path.lastIndexOf("/");
  kept.delete(`${ws.key}|read|${path}`);
  kept.delete(`${ws.key}|list|${slash < 0 ? "" : path.slice(0, slash)}`);
}

type Watch = { version: FileVersion; asked: number; stop: () => void; ready: Promise<void> };
/** Files the page asks the version of: one daemon subscription each, dropped once it hasn't been asked for a while. */
const watches = new Map<string, Watch>();
let sweeping: ReturnType<typeof setInterval> | undefined;
function sweep() {
  const now = Date.now();
  for (const [key, w] of watches)
    if (now - w.asked > FILES.watchMs) {
      watches.delete(key);
      w.stop();
    }
  if (!watches.size && sweeping) {
    clearInterval(sweeping);
    sweeping = undefined;
  }
}
const versionOf = (path: string, v: { status?: string; size?: number; modifiedAt?: string; revision?: string }): FileVersion =>
  v.status === "ready" && typeof v.modifiedAt === "string"
    ? { path, status: "ready", size: typeof v.size === "number" ? v.size : 0, modifiedAt: v.modifiedAt, ...(v.revision ? { revision: v.revision } : {}) }
    : { path, status: "missing" };

/** The file's version on disk now, from its listing (a daemon without file subscriptions, or one that failed). */
async function listedVersion(ws: Workspace, path: string): Promise<FileVersion> {
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash);
  const r = await timed(ws.client.listDirectory(ws.cwd, dir || "."), undefined, ws.client).catch((e) => {
    if (/ENOENT|no such file/i.test(e instanceof Error ? e.message : "")) return { entries: [] };
    throw daemonError(e);
  });
  const name = path.slice(slash + 1);
  const e = ((Array.isArray(r?.entries) ? r.entries : []) as { name?: unknown; kind?: unknown; size?: unknown; modifiedAt?: unknown }[]).find(
    (x) => x?.name === name && x.kind === "file",
  );
  return e && typeof e.modifiedAt === "string"
    ? { path, status: "ready", size: typeof e.size === "number" ? e.size : 0, modifiedAt: e.modifiedAt }
    : { path, status: "missing" };
}

export async function filesVersion(params: URLSearchParams): Promise<FileVersion> {
  const ws = await workspaceOf(params, ["path"]);
  const path = checkPath(params.get("path"));
  if (!path) throw new Error("A file is required");
  const key = `${ws.key}|${path}`;
  let w = watches.get(key);
  if (!w) {
    const abort = new AbortController();
    const made: Watch = { version: { path, status: "missing" }, asked: Date.now(), stop: () => abort.abort(), ready: Promise.resolve() };
    made.ready = (async () => {
      try {
        const sub = await timed(
          ws.client.subscribeFile({ cwd: ws.cwd, path, signal: abort.signal }, (v) => {
            made.version = versionOf(path, v);
          }),
          undefined,
          ws.client,
        );
        made.version = versionOf(path, sub.initial);
        made.stop = () => {
          abort.abort();
          void sub.unsubscribe().catch(() => {});
        };
        if (abort.signal.aborted) made.stop();
      } catch {
        // No subscription: each ask reads the listing instead.
        watches.delete(key);
        throw new Error("unwatched");
      }
    })();
    watches.set(key, made);
    sweeping ??= setInterval(sweep, FILES.watchMs / 2);
    sweeping.unref?.();
    w = made;
  }
  w.asked = Date.now();
  try {
    await w.ready;
    return w.version;
  } catch {
    return listedVersion(ws, path);
  }
}

/** Tests: every subscription dropped. */
export function resetFileWatches() {
  for (const w of watches.values()) w.stop();
  watches.clear();
}

const str = (v: unknown, label: string, max = 200) => {
  if (typeof v !== "string" || !v || v.length > max) throw new Error(`Invalid ${label}`);
  return v;
};

export async function filesWrite(body: Record<string, unknown>): Promise<FileWrite> {
  for (const k of Object.keys(body)) if (!["workspace", "host", "path", "text", "modifiedAt", "revision"].includes(k)) throw new Error(`Unexpected field ${k}`);
  const params = new URLSearchParams();
  params.set("workspace", str(body.workspace, "workspace"));
  if (body.host !== undefined && body.host !== null && body.host !== "") params.set("host", str(body.host, "host"));
  const ws = await workspaceOf(params, []);
  const path = checkPath(typeof body.path === "string" ? body.path : null);
  if (!path) throw new Error("A file is required");
  if (typeof body.text !== "string") throw new Error("Invalid text");
  const text = body.text;
  const size = Buffer.byteLength(text, "utf8");
  if (size > FILE_LIMITS.maxBytes) throw new Error("That file is too large to save here.");
  const modifiedAt = str(body.modifiedAt, "version", 100);
  const revision = body.revision === undefined ? undefined : str(body.revision, "revision", 200);
  let r;
  try {
    r = await timed(
      ws.client.writeFile({ cwd: ws.cwd, path, content: text, expectedModifiedAt: modifiedAt, ...(revision ? { expectedRevision: revision } : {}) }),
      undefined,
      ws.client,
    );
  } catch (e) {
    throw daemonError(e);
  } finally {
    forget(ws, path);
  }
  if (r.status === "error") throw daemonError(new Error(r.error));
  const watch = watches.get(`${ws.key}|${path}`);
  if (r.status === "conflict") {
    const version = versionOf(path, r.version);
    if (watch) watch.version = version;
    return { status: "conflict", path, version };
  }
  const written: FileWrite = { status: "written", path, size: r.size, modifiedAt: r.modifiedAt, ...(r.revision ? { revision: r.revision } : {}) };
  if (watch) watch.version = { path, status: "ready", size: r.size, modifiedAt: r.modifiedAt, ...(r.revision ? { revision: r.revision } : {}) };
  return written;
}

/** Every file not ignored, breadth first, so a cap keeps the shallow ones. */
export async function filesAll(params: URLSearchParams): Promise<FileList> {
  const ws = await workspaceOf(params, []);
  const fresh = params.get("fresh") === "1";
  return cached(`${ws.key}|all`, FILES.allMs, fresh, async () => {
    const files: string[] = [];
    let capped = false;
    let queue = [""];
    let dirs = 0;
    while (queue.length && !capped) {
      const next: string[] = [];
      for (let i = 0; i < queue.length && !capped; i += FILES.concurrency) {
        if (dirs >= FILES.maxDirs) {
          capped = true;
          break;
        }
        const batch = queue.slice(i, i + FILES.concurrency);
        dirs += batch.length;
        const listed = await Promise.all(
          batch.map(async (dir) => {
            const entries = await listing(ws, dir, false).catch(() => [] as FileEntry[]);
            return marked(entries, await rulesFor(ws, dir, entries, false));
          }),
        );
        for (const entries of listed)
          for (const e of entries) {
            if (e.ignored) continue;
            if (e.kind === "directory") next.push(e.path);
            else if (files.length < FILE_LIMITS.maxListed) files.push(e.path);
            else capped = true;
          }
      }
      queue = next;
    }
    return { files: files.sort(), capped };
  });
}

export async function filesChanged(params: URLSearchParams): Promise<FileChanges | GithubUnavailable> {
  const ws = await workspaceOf(params, []);
  const fresh = params.get("fresh") === "1";
  return cached(`${ws.key}|changed`, FILES.changedMs, fresh, async () => {
    const diff = await timed(ws.client.getCheckoutDiff(ws.cwd, { mode: "all" }), undefined, ws.client);
    if (diff?.error) return { available: false as const, reason: diff.error.code === "NOT_GIT_REPO" ? "This workspace's folder isn't a git checkout." : "The daemon couldn't diff this checkout." };
    const files: FileChanges["files"] = [];
    for (const f of (Array.isArray(diff?.files) ? diff.files : []) as Record<string, unknown>[]) {
      if (typeof f?.path !== "string") continue;
      const change: FileChange = f.isNew ? "added" : f.isDeleted ? "deleted" : typeof f.oldPath === "string" && f.oldPath !== f.path ? "renamed" : "modified";
      files.push({ path: f.path, change });
    }
    return { files };
  });
}

/**
 * A workspace's image, for a Markdown file's `![…](relative.png)`: only PNG,
 * JPEG, GIF and WebP (named so and starting so), at most `FILES.maxImageBytes`,
 * read through the daemon (which keeps it inside the workspace). Not kept.
 */
export async function filesImage(params: URLSearchParams): Promise<{ bytes: Uint8Array; mime: string }> {
  const ws = await workspaceOf(params, ["path"]);
  const path = checkPath(params.get("path"));
  const type = IMAGE_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  if (!path || !type) throw new Error("Not an image");
  let r;
  try {
    r = await timed(ws.client.readFile(ws.cwd, path, undefined, FILES.maxImageBytes), undefined, ws.client);
  } catch (e) {
    if (/too large/i.test(e instanceof Error ? e.message : "")) throw new Error("That image is too large");
    throw daemonError(e);
  }
  if (r.bytes.byteLength > FILES.maxImageBytes) throw new Error("That image is too large");
  if (!type.magic(r.bytes)) throw new Error("Not an image");
  return { bytes: r.bytes, mime: type.mime };
}
