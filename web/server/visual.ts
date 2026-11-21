/**
 * Visual replies published with a tool: the visual-replies Paseo plugin
 * (github.com/owenconti/paseo-cc-plugins) gives every agent on its daemon an
 * `html_render` tool, keeps each page it is given on that machine, and answers
 * the call with the page's id. The timeline marks such a call (`publishedPage`),
 * and the chat reads the page from the plugin over RPC when it draws it
 * (`GET /api/visual`). Read-only: nothing is sent but the id. A host without the
 * plugin has no such calls; agents there write a fenced `html-render` block instead.
 */
export const VISUAL = {
  plugin: "visual-replies",
  method: "page.read",
  timeoutMs: 15000,
  /** A page with its images embedded; the plugin keeps to the same. */
  maxBytes: 25 * 1024 * 1024,
};

const TOOL = /(?:^|__|\.)html_render$/;
const PAGE_ID = /^[a-f0-9]{24}$/;

/** The `visualReply` the plugin's tool answered with, wherever the provider put it in the call's output. */
function findReply(value: unknown, depth = 0): { id?: unknown; title?: unknown } | undefined {
  if (!value || typeof value !== "object" || depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 8)) {
      const found = findReply(v, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.visualReply && typeof record.visualReply === "object")
    return record.visualReply as { id?: unknown; title?: unknown };
  for (const key of ["output", "structuredContent", "result", "content"]) {
    const found = findReply(record[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** The page a completed `html_render` call published, from the daemon's tool call row. */
export function publishedPage(
  name: unknown,
  detail: unknown,
): { page: string; title: string } | undefined {
  if (typeof name !== "string" || !TOOL.test(name)) return undefined;
  const d = detail as { input?: { title?: unknown }; output?: unknown } | null;
  let reply = findReply(d?.output);
  // A provider that keeps only the tool's text: "…(page <id>)…".
  if (!reply) {
    const text = typeof d?.output === "string" ? d.output : JSON.stringify(d?.output ?? "");
    const id = /\(page ([a-f0-9]{24})\)/.exec(text)?.[1];
    if (id) reply = { id, title: d?.input?.title };
  }
  if (!reply || typeof reply.id !== "string" || !PAGE_ID.test(reply.id)) return undefined;
  const title =
    (typeof reply.title === "string" && reply.title) ||
    (typeof d?.input?.title === "string" && d.input.title) ||
    "Page";
  return { page: reply.id, title: title.replace(/\s+/g, " ").trim().slice(0, 120) || "Page" };
}

export type VisualPage = { id: string; title: string; html: string };

/** What the plugin answered, checked: only an id we asked for, a title and HTML within the limit. */
export function visualPageOf(id: string, raw: unknown): VisualPage {
  const r = raw as { id?: unknown; title?: unknown; html?: unknown } | null;
  if (!r || r.id !== id || typeof r.html !== "string") throw new Error("The page couldn't be read.");
  if (Buffer.byteLength(r.html) > VISUAL.maxBytes) throw new Error("The page is too large to show.");
  return {
    id,
    title: typeof r.title === "string" ? r.title.slice(0, 120) : "Page",
    html: r.html,
  };
}

export type VisualDeps = {
  invoke(plugin: string, method: string, input: unknown): Promise<unknown>;
};

/** `GET /api/visual?id=&host=`: one published page, from its host's daemon. */
export async function readVisualPage(id: string | null, deps: VisualDeps): Promise<VisualPage> {
  if (!id || !PAGE_ID.test(id)) throw new Error("Invalid page id");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      deps.invoke(VISUAL.plugin, VISUAL.method, { id }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The host took too long to answer.")), VISUAL.timeoutMs);
      }),
    ]);
    return visualPageOf(id, raw);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `show_in_files` (the same plugin): an agent shows the user a file of its workspace, at a line or a range, or its
 * changes on the branch, in the Files tab beside its conversation. The plugin checks the place and answers with it
 * (`structuredContent.showInFiles`); the timeline marks the completed call (`shownInFiles`), and the chat draws it as a
 * file link and opens it as it arrives (Session.tsx).
 */
export type FilesPlace = { path: string; relative: string; line?: number; endLine?: number; view: "file" | "changes" };
const FILES_TOOL = /(?:^|__|\.)show_in_files$/;

function findPlace(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 8)) {
      const found = findPlace(v, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.showInFiles && typeof record.showInFiles === "object") return record.showInFiles as Record<string, unknown>;
  for (const key of ["output", "structuredContent", "result", "content"]) {
    const found = findPlace(record[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

const lineOf = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10_000_000 ? v : undefined);
const pathOf = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 4096 && !v.includes("\0") ? v : undefined);

/** The place a completed `show_in_files` call showed: the plugin's answer, else (a provider that keeps only the tool's text)
 *  what the call asked, when it wasn't refused. */
export function shownInFiles(name: unknown, detail: unknown): FilesPlace | undefined {
  if (typeof name !== "string" || !FILES_TOOL.test(name)) return undefined;
  const d = detail as { input?: Record<string, unknown>; output?: unknown } | null;
  const answered = findPlace(d?.output);
  const text = typeof d?.output === "string" ? d.output : JSON.stringify(d?.output ?? "");
  const source = answered ?? (/^"?Opened /.test(text) ? d?.input : undefined);
  if (!source) return undefined;
  const asked = pathOf(source.relative) ?? pathOf(source.path);
  if (!asked) return undefined;
  const relative = asked.replace(/^\.\//, "");
  if (relative.split("/").includes("..")) return undefined;
  // The plugin's answer names the real path; what was asked, the path as written (made tidy).
  const path = (answered && pathOf(answered.path)) || relative;
  const line = lineOf(source.line);
  const endLine = line ? lineOf(source.endLine) : undefined;
  return {
    path,
    relative,
    ...(line ? { line } : {}),
    ...(endLine && endLine > (line ?? 0) ? { endLine } : {}),
    view: source.view === "changes" ? "changes" : "file",
  };
}
