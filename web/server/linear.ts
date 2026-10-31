/**
 * The Linear tab's issues: those assigned to you (open ones: not completed or
 * cancelled) and one issue's details, read-only from Linear's GraphQL API with
 * LINEAR_API_KEY, else `linearApiKey` in the data directory's secrets.json.
 * Without a key, or when Linear refuses it, the answer says so and nothing is
 * shown. Lists are cached for `LINEAR_LIST.ttlMs`, details for as long.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINEAR } from "./links";
import { dataDir } from "./subagentArchive";

export const LINEAR_LIST = { ttlMs: 30000, limit: 100 };

export type LinearState = {
  name: string;
  /** Linear's workflow type: triage, backlog, unstarted, started, completed, canceled. */
  type: string;
  color: string;
};
export type LinearLabel = { name: string; color: string };
export type LinearIssueRow = {
  key: string;
  title: string;
  url: string;
  state: LinearState;
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number;
  priorityLabel: string;
  team: string;
  project?: string;
  labels: LinearLabel[];
  /** The branch Linear suggests for it. */
  branchName?: string;
  updatedAt: string;
};
export type LinearComment = { author: string; body: string; createdAt: string };
export type LinearIssueDetail = LinearIssueRow & {
  description: string;
  createdAt: string;
  dueDate?: string;
  estimate?: number;
  assignee?: string;
  creator?: string;
  parent?: { key: string; title: string };
  links: { title: string; url: string }[];
  comments: LinearComment[];
};
export type LinearList =
  | { available: false; reason: string }
  | { available: true; viewer: string; issues: LinearIssueRow[] };
export type LinearDetail =
  | { available: false; reason: string }
  | { available: true; issue: LinearIssueDetail | null };

const NO_KEY =
  "Set LINEAR_API_KEY, or linearApiKey in secrets.json, to see your Linear issues.";
const KEY = /^([a-z]{2,10}\d?)-(\d{1,6})$/i;

export function linearApiKey(): string | undefined {
  const env = process.env.LINEAR_API_KEY?.trim();
  if (env) return env;
  try {
    const secrets = JSON.parse(readFileSync(join(dataDir(), "secrets.json"), "utf8"));
    const key = secrets?.linearApiKey;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const httpsUrl = (v: unknown) => {
  try {
    const url = new URL(str(v));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};
const color = (v: unknown) => (/^#[0-9a-f]{3,8}$/i.test(str(v)) ? str(v) : "#8a8f98");
const nodes = (v: unknown) =>
  Array.isArray((v as { nodes?: unknown })?.nodes)
    ? ((v as { nodes: Record<string, unknown>[] }).nodes)
    : [];
const name = (v: unknown) => clip(str((v as { name?: unknown } | null)?.name), 120);

/** One GraphQL request; `null` data when Linear refuses it. */
async function query(token: string, text: string, variables: Record<string, unknown>) {
  const res = await LINEAR.fetch(LINEAR.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query: text, variables }),
    signal: AbortSignal.timeout(LINEAR.timeoutMs),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: Record<string, unknown> | null;
    errors?: { message?: string }[];
  } | null;
  if (!res.ok || !body?.data) {
    const why = body?.errors?.[0]?.message;
    throw new Error(
      res.status === 401 || res.status === 400 && /auth/i.test(why ?? "")
        ? "Linear refused the API key."
        : why
          ? `Linear: ${clip(why, 200)}`
          : `Linear answered ${res.status}.`,
    );
  }
  return body.data;
}

const ROW_FIELDS = `identifier title url priority priorityLabel branchName updatedAt
  state { name type color } team { key name } project { name }
  labels { nodes { name color } }`;

function row(issue: Record<string, unknown>): LinearIssueRow {
  const state = (issue.state ?? {}) as Record<string, unknown>;
  const team = (issue.team ?? {}) as Record<string, unknown>;
  const priority = Number(issue.priority);
  return {
    key: clip(str(issue.identifier).toUpperCase(), 30),
    title: clip(str(issue.title), 300),
    url: httpsUrl(issue.url),
    state: {
      name: clip(str(state.name), 60),
      type: clip(str(state.type), 20),
      color: color(state.color),
    },
    priority: Number.isInteger(priority) && priority >= 0 && priority <= 4 ? priority : 0,
    priorityLabel: clip(str(issue.priorityLabel), 30),
    team: clip(str(team.key) || str(team.name), 60),
    project: name(issue.project) || undefined,
    labels: nodes(issue.labels).map((l) => ({ name: name(l), color: color(l.color) })),
    branchName: clip(str(issue.branchName), 150) || undefined,
    updatedAt: str(issue.updatedAt),
  };
}

let listCache: { token: string; at: number; value: Promise<LinearList> } | undefined;

/** The open issues assigned to you, most recently updated first. */
export function assignedIssues(now = Date.now(), fresh = false): Promise<LinearList> {
  const token = linearApiKey();
  if (!token) return Promise.resolve({ available: false, reason: NO_KEY });
  if (!fresh && listCache?.token === token && now - listCache.at < LINEAR_LIST.ttlMs)
    return listCache.value;
  const value = (async (): Promise<LinearList> => {
    const data = await query(
      token,
      `query Assigned($first: Int!) { viewer { name assignedIssues(first: $first, orderBy: updatedAt,
        filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${ROW_FIELDS} } } } }`,
      { first: LINEAR_LIST.limit },
    );
    const viewer = (data.viewer ?? {}) as Record<string, unknown>;
    return {
      available: true,
      viewer: name(viewer),
      issues: nodes(viewer.assignedIssues).map(row).filter((i) => i.key),
    };
  })().catch((e): LinearList => ({ available: false, reason: (e as Error).message }));
  listCache = { token, at: now, value };
  // A refusal isn't kept: the next look asks again.
  void value.then((v) => {
    if (!v.available && listCache?.value === value) listCache = undefined;
  });
  return value;
}

const detailCache = new Map<string, { at: number; value: Promise<LinearDetail> }>();

/** One issue's details, its description, links and comments. */
export function issueDetail(rawKey: string, now = Date.now(), fresh = false): Promise<LinearDetail> {
  const key = rawKey.trim().toUpperCase();
  if (!KEY.test(key)) return Promise.reject(new Error("Invalid issue key"));
  const token = linearApiKey();
  if (!token) return Promise.resolve({ available: false, reason: NO_KEY });
  const hit = detailCache.get(key);
  if (!fresh && hit && now - hit.at < LINEAR_LIST.ttlMs) return hit.value;
  const value = (async (): Promise<LinearDetail> => {
    const data = await query(
      token,
      `query Issue($id: String!) { issue(id: $id) { ${ROW_FIELDS}
        description createdAt dueDate estimate assignee { name } creator { name }
        parent { identifier title } attachments(first: 20) { nodes { title url } }
        comments(first: 50, orderBy: createdAt) { nodes { body createdAt user { name } } } } }`,
      { id: key },
    );
    const issue = data.issue as Record<string, unknown> | null;
    if (!issue) return { available: true, issue: null };
    const parent = issue.parent as Record<string, unknown> | null;
    const estimate = Number(issue.estimate);
    return {
      available: true,
      issue: {
        ...row(issue),
        description: clip(str(issue.description), 100000),
        createdAt: str(issue.createdAt),
        dueDate: str(issue.dueDate) || undefined,
        estimate: issue.estimate != null && Number.isFinite(estimate) ? estimate : undefined,
        assignee: name(issue.assignee) || undefined,
        creator: name(issue.creator) || undefined,
        parent: parent
          ? { key: clip(str(parent.identifier), 30), title: clip(str(parent.title), 300) }
          : undefined,
        links: nodes(issue.attachments)
          .map((a) => ({ title: clip(str(a.title), 200), url: httpsUrl(a.url) }))
          .filter((a) => a.url),
        comments: nodes(issue.comments)
          .map((c) => ({
            author: name(c.user) || "Someone",
            body: clip(str(c.body), 20000),
            createdAt: str(c.createdAt),
          }))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      },
    };
  })().catch((e): LinearDetail => ({ available: false, reason: (e as Error).message }));
  detailCache.set(key, { at: now, value });
  if (detailCache.size > 200) detailCache.delete(detailCache.keys().next().value!);
  return value;
}

export function resetLinear() {
  listCache = undefined;
  detailCache.clear();
}

/** Where Linear keeps uploaded files; they load only with the API key. */
const UPLOADS = "uploads.linear.app";
export const LINEAR_IMAGE = { maxBytes: 20 * 1024 * 1024 };

/** Whether `raw` is a Linear upload (https, on its uploads host, no userinfo). */
export function linearUpload(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === UPLOADS && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/** An image uploaded to Linear, fetched with the API key: only images, at most `LINEAR_IMAGE.maxBytes`. */
export async function linearImage(
  raw: string,
): Promise<{ status: number; type?: string; bytes?: Buffer; error?: string }> {
  const url = linearUpload(raw);
  if (!url) return { status: 400, error: "Only Linear uploads load here" };
  const token = linearApiKey();
  if (!token) return { status: 404, error: NO_KEY };
  try {
    const res = await LINEAR.fetch(url.href, {
      headers: { Authorization: token },
      redirect: "follow",
      signal: AbortSignal.timeout(LINEAR.timeoutMs * 2),
    });
    const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!res.ok) return { status: 502, error: `Linear answered ${res.status}.` };
    if (!/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(type))
      return { status: 415, error: "Not an image" };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > LINEAR_IMAGE.maxBytes) return { status: 413, error: "Image too large" };
    return { status: 200, type, bytes };
  } catch {
    return { status: 504, error: "Linear didn't answer" };
  }
}
