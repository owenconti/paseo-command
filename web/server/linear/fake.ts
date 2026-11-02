/**
 * A fake Linear for tests: a small workspace kept in Linear's GraphQL shape
 * (so the server's normalize code is exercised) behind `LINEAR.fetch`.
 * Requests dispatch on `operationName` to one function in `OPERATIONS`: the
 * workspace's people and teams, your Inbox, and its read, unread and archive
 * writes, which are all Activity's Linear source asks. Nothing here reaches the network.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LINEAR } from "../links";
import { secretsFile } from "../secrets";
import { readSettings, settingsFile, writeSettings } from "../settings";

type Ref = { id: string };

export type FakeUser = { id: string; name: string; displayName: string; avatarUrl?: string };
export type FakeTeam = { id: string; key: string; name: string };
export type FakeNotification = {
  id: string;
  /** IssueNotification, ProjectNotification or PullRequestNotification: which of `issue` (with `comment`), `project` or `pullRequest` it has. */
  kind: "issue" | "project" | "pullRequest";
  type: string;
  title: string;
  subtitle: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  snoozedUntilAt: string | null;
  archivedAt: string | null;
  actor: Ref | null;
  issue?: { id: string; identifier: string };
  comment?: { id: string; body: string } | null;
  project?: Ref;
  pullRequest?: { id: string; title: string; sourceBranch: string };
};
export type FakeWorkspace = {
  viewerId: string;
  /** The workspace's address on linear.app (`linear.app/<urlKey>/…`). */
  urlKey: string;
  users: FakeUser[];
  teams: FakeTeam[];
  notifications: FakeNotification[];
};

/** A stable UUID for the n-th fake entity of a kind (kind picks the last-but-one group). */
function uuid(kind: number, n: number): string {
  const hex = (v: number, len: number) => v.toString(16).padStart(len, "0");
  return `${hex(0xfa4e0000 + kind, 8)}-0000-4000-8000-${hex(n, 12)}`;
}
const seq = (kind: number, names: string[]) => Object.fromEntries(names.map((name, i) => [name, uuid(kind, i + 1)]));

const ISSUE_KEYS = ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5", "ENG-6", "DE-1", "DE-2"];

/** Every fake entity's id, by name, for tests to point at. */
export const FAKE_IDS = {
  ...(seq(1, ["owen", "sam"]) as { owen: string; sam: string }),
  ...(seq(2, ["eng", "de"]) as { eng: string; de: string }),
  projects: seq(7, ["launch", "docs"]) as { launch: string; docs: string },
  issues: seq(10, ISSUE_KEYS) as Record<string, string>,
  comments: seq(11, ["first", "reply", "reacted"]) as { first: string; reply: string; reacted: string },
  notifications: seq(15, ["eng1Comment", "eng1Reaction", "eng3Assigned", "launchUpdate", "de2Snoozed"]) as {
    eng1Comment: string;
    eng1Reaction: string;
    eng3Assigned: string;
    launchUpdate: string;
    de2Snoozed: string;
  },
};

const DAY = 86_400_000;

/** The fixed sample workspace; dates are relative to now. */
export function fakeWorkspace(): FakeWorkspace {
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY).toISOString();
  const ahead = (days: number) => new Date(now + days * DAY).toISOString();
  const I = FAKE_IDS;
  const ref = (id: string): Ref => ({ id });

  return {
    viewerId: I.owen,
    urlKey: "fake",
    users: [
      { id: I.owen, name: "Owen Conti", displayName: "Owen" },
      { id: I.sam, name: "Sam Rivera", displayName: "Sam", avatarUrl: FAKE_AVATAR },
    ],
    teams: [
      { id: I.eng, key: "ENG", name: "Engineering" },
      { id: I.de, key: "DE", name: "Design Engineering" },
    ],
    notifications: [
      {
        id: I.notifications.eng1Comment,
        kind: "issue",
        type: "issueNewComment",
        title: "ENG-1 Ship the Linear tab",
        subtitle: "Sam Rivera commented",
        url: "https://linear.app/fake/issue/ENG-1#comment",
        createdAt: ago(0.1),
        updatedAt: ago(0.1),
        readAt: null,
        snoozedUntilAt: null,
        archivedAt: null,
        actor: ref(I.sam),
        issue: { id: I.issues["ENG-1"], identifier: "ENG-1" },
        comment: { id: I.comments.first, body: "Can we start with the list?" },
      },
      {
        id: I.notifications.eng1Reaction,
        kind: "issue",
        type: "issueCommentReaction",
        title: "ENG-1 Ship the Linear tab",
        subtitle: "Sam Rivera reacted 👍 to your comment",
        url: "https://linear.app/fake/issue/ENG-1",
        createdAt: ago(0.5),
        updatedAt: ago(0.5),
        readAt: null,
        snoozedUntilAt: null,
        archivedAt: null,
        actor: ref(I.sam),
        issue: { id: I.issues["ENG-1"], identifier: "ENG-1" },
        comment: { id: I.comments.reacted, body: "Beta is on track." },
      },
      {
        id: I.notifications.eng3Assigned,
        kind: "issue",
        type: "issueAssignedToYou",
        title: "ENG-3 Review the sync design",
        subtitle: "Sam Rivera assigned the issue to you",
        url: "https://linear.app/fake/issue/ENG-3",
        createdAt: ago(1),
        updatedAt: ago(1),
        readAt: ago(0.9),
        snoozedUntilAt: null,
        archivedAt: null,
        actor: ref(I.sam),
        issue: { id: I.issues["ENG-3"], identifier: "ENG-3" },
        comment: null,
      },
      {
        id: I.notifications.launchUpdate,
        kind: "project",
        type: "projectUpdateCreated",
        title: "Launch",
        subtitle: "Probe posted a project update",
        url: "https://linear.app/fake/project/launch",
        createdAt: ago(2),
        updatedAt: ago(2),
        readAt: null,
        snoozedUntilAt: null,
        archivedAt: null,
        actor: null,
        project: ref(I.projects.launch),
      },
      {
        id: I.notifications.de2Snoozed,
        kind: "issue",
        type: "issueSubscribed",
        title: "DE-2 Audit the icon set",
        subtitle: "Sam Rivera subscribed you",
        url: "https://linear.app/fake/issue/DE-2",
        createdAt: ago(3),
        updatedAt: ago(3),
        readAt: null,
        snoozedUntilAt: ahead(1),
        archivedAt: null,
        actor: ref(I.sam),
        issue: { id: I.issues["DE-2"], identifier: "DE-2" },
        comment: null,
      },
    ],
  };
}

/** What an operation function gets: the workspace, the request's variables and a helper for writes. */
export type FakeContext = {
  ws: FakeWorkspace;
  variables: Record<string, unknown>;
  /** Sets `updatedAt` to now on every given record; call it from each write. */
  touch(...records: { updatedAt: string }[]): void;
};
/** An operation returns the reply's `data`, or throws a FakeGraphQlError. */
export type FakeOperation = (ctx: FakeContext) => unknown;

export class FakeGraphQlError extends Error {
  constructor(
    message: string,
    public type?: string,
  ) {
    super(message);
  }
}

const newestFirst = <T extends { updatedAt: string }>(items: T[]) =>
  [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/** A notification as Linear answers it: an IssueNotification's issue and comment, a ProjectNotification's project, or a PullRequestNotification's pull request. */
function notificationNode({ kind, ...n }: FakeNotification) {
  const { pullRequest, ...rest } = n;
  if (kind === "issue") return rest;
  const other = { ...rest, issue: undefined, comment: undefined };
  return kind === "pullRequest" ? { ...other, project: undefined, pullRequest } : other;
}

/** The notifications a write names: one by id, or an issue's or project's. */
function named(ws: FakeWorkspace, input: Record<string, string>): FakeNotification[] {
  const list = ws.notifications.filter((n) =>
    input.id ? n.id === input.id : input.issueId ? n.issue?.id === input.issueId : n.project?.id === input.projectId,
  );
  if (input.id && !list.length) throw new FakeGraphQlError("Could not find referenced Notification.", "InvalidInput");
  return list;
}

/** A notification write on many: changes each named one not archived, and answers them. */
const onNotifications =
  (field: string, change: (n: FakeNotification, vars: Record<string, unknown>) => void): FakeOperation =>
  (ctx) => {
    const list = named(ctx.ws, ctx.variables.input as Record<string, string>).filter((n) => !n.archivedAt);
    for (const n of list) change(n, ctx.variables);
    ctx.touch(...list);
    return { [field]: { success: true, notifications: list.map(notificationNode) } };
  };

/** The dispatch table, by GraphQL operation name. */
export const OPERATIONS: Record<string, FakeOperation> = {
  Workspace: ({ ws }) => ({
    viewer: ws.users.find((u) => u.id === ws.viewerId),
    organization: { urlKey: ws.urlKey },
    users: { nodes: ws.users },
    teams: { nodes: ws.teams },
  }),
  /** Your notifications not archived, the most recently updated first, a page at a time. */
  Notifications: ({ ws, variables }) => {
    const all = newestFirst(ws.notifications.filter((n) => !n.archivedAt));
    const start = variables.after ? Number(variables.after) : 0;
    const end = start + Number(variables.first);
    return {
      notifications: {
        nodes: all.slice(start, end).map(notificationNode),
        pageInfo: { hasNextPage: end < all.length, endCursor: end < all.length ? String(end) : null },
      },
    };
  },
  NotificationMarkReadAll: onNotifications("notificationMarkReadAll", (n, v) => {
    n.readAt ??= String(v.readAt);
  }),
  NotificationMarkUnreadAll: onNotifications("notificationMarkUnreadAll", (n) => {
    n.readAt = null;
  }),
  NotificationArchiveAll: onNotifications("notificationArchiveAll", (n) => {
    n.archivedAt = new Date().toISOString();
  }),
};

export type FakeFailure = { status?: number; message: string; type?: string };

export type FakeLinear = {
  ws: FakeWorkspace;
  requests: { operation: string; variables: Record<string, unknown> }[];
  /** Makes every later request for `operation` answer this error, until `clear` or restore. */
  fail(operation: string, error: FakeFailure): void;
  /** Lets `operation` answer normally again. */
  clear(operation: string): void;
  restore(): void;
};

/** A file's text, or undefined when it doesn't exist. */
function snapshot(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
function putBack(file: string, text: string | undefined): void {
  if (text === undefined) rmSync(file, { force: true });
  else writeFileSync(file, text);
}

/** Sam's avatar, on a host that isn't Linear's (as Google's or Gravatar's are), and its image: a 1×1 PNG. */
export const FAKE_AVATAR = "https://avatars.fake.example/sam.png";
const AVATAR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** The fake's API key, as secrets.json keeps it. */
export const FAKE_KEY = "lin_api_fake";

/**
 * Points LINEAR.fetch at the fake workspace and turns Linear on as a user
 * would: `integrations.linear` in settings.json and a fake `linearApiKey` in
 * the (test) data directory's secrets.json. `restore()` puts both files back.
 */
export function installFakeLinear(ws: FakeWorkspace = fakeWorkspace()): FakeLinear {
  const realFetch = LINEAR.fetch;
  const failures = new Map<string, FakeFailure>();
  const requests: FakeLinear["requests"] = [];
  const secrets = secretsFile();
  const settings = settingsFile();
  const hadSecrets = snapshot(secrets);
  const hadSettings = snapshot(settings);
  let kept: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(hadSecrets ?? "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) kept = raw as Record<string, unknown>;
  } catch {
    // An unreadable file is replaced for the test and put back by restore().
  }
  mkdirSync(dirname(secrets), { recursive: true });
  writeFileSync(secrets, JSON.stringify({ ...kept, linearApiKey: FAKE_KEY }));
  const integrations = readSettings()?.integrations;
  writeSettings({
    integrations: {
      ...(integrations && typeof integrations === "object" ? integrations : {}),
      linear: true,
    },
  });

  LINEAR.fetch = (async (target: unknown, init?: RequestInit) => {
    const address = String(target);
    if (address === FAKE_AVATAR) {
      // Never with the key: it isn't Linear's.
      if (new Headers(init?.headers).get("authorization")) return new Response("", { status: 400 });
      return new Response(new Uint8Array(AVATAR_PNG), { status: 200, headers: { "content-type": "image/png" } });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      operationName?: string;
      variables?: Record<string, unknown>;
    };
    const operation = body.operationName ?? "";
    const variables = body.variables ?? {};
    requests.push({ operation, variables });
    const headers = {
      "content-type": "application/json",
      "x-ratelimit-requests-remaining": "2500",
      "x-ratelimit-complexity-remaining": "3000000",
      "x-ratelimit-requests-reset": String(Date.now() + 3_600_000),
    };
    const reply = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers });
    const errorReply = (status: number, message: string, type?: string) =>
      reply(status, { errors: [{ message, extensions: type ? { type } : {} }] });

    const failure = failures.get(operation);
    if (failure) return errorReply(failure.status ?? 200, failure.message, failure.type);
    const run = OPERATIONS[operation];
    if (!run) return errorReply(200, `Unknown operation ${operation}`);
    try {
      const touch: FakeContext["touch"] = (...records) => {
        const at = new Date().toISOString();
        for (const record of records) record.updatedAt = at;
      };
      return reply(200, { data: await run({ ws, variables, touch }) });
    } catch (e) {
      if (e instanceof FakeGraphQlError) return errorReply(200, e.message, e.type);
      throw e;
    }
  }) as typeof fetch;

  return {
    ws,
    requests,
    fail: (operation, error) => void failures.set(operation, error),
    clear: (operation) => void failures.delete(operation),
    restore() {
      LINEAR.fetch = realFetch;
      putBack(secrets, hadSecrets);
      putBack(settings, hadSettings);
    },
  };
}
