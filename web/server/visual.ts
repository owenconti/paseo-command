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
