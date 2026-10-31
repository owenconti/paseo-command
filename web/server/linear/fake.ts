/**
 * A fake Linear for tests: a small workspace kept in Linear's GraphQL shape
 * (so the server's normalize code is exercised) behind `LINEAR.fetch`.
 * Requests dispatch on `operationName` to one function in `OPERATIONS`; reads
 * and writes add theirs there. Nothing here reaches the network.
 */
import { LINEAR } from "../links";

type Ref = { id: string };
type Nodes<T> = { nodes: T[] };

export type FakeUser = { id: string; name: string; displayName: string; avatarUrl?: string };
export type FakeTeam = {
  id: string;
  key: string;
  name: string;
  cyclesEnabled: boolean;
  triageEnabled: boolean;
  issueEstimationType: "notUsed" | "exponential" | "fibonacci" | "linear" | "tShirt";
  issueEstimationAllowZero: boolean;
};
export type FakeState = {
  id: string;
  name: string;
  type: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";
  color: string;
  position: number;
  team: Ref;
};
export type FakeLabel = { id: string; name: string; color: string; team: Ref | null };
export type FakeCycle = {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  isNext: boolean;
  team: Ref;
};
export type FakeProject = {
  id: string;
  name: string;
  icon: string | null;
  color: string;
  status: { name: string };
  health: "onTrack" | "atRisk" | "offTrack" | null;
  lead: Ref | null;
  targetDate: string | null;
  progress: number;
  teams: Nodes<Ref>;
  projectMilestones: Nodes<{ id: string; name: string }>;
  url: string;
  updatedAt: string;
};
export type FakeInitiative = {
  id: string;
  name: string;
  status: string;
  health: string | null;
  owner: Ref | null;
  targetDate: string | null;
  projects: Nodes<Ref>;
  url: string;
  updatedAt: string;
};
export type FakeIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: 0 | 1 | 2 | 3 | 4;
  estimate: number | null;
  sortOrder: number;
  dueDate: string | null;
  branchName: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  completedAt: string | null;
  state: Ref;
  team: Ref;
  assignee: Ref | null;
  creator: Ref | null;
  labels: Nodes<Ref>;
  project: Ref | null;
  projectMilestone: Ref | null;
  cycle: Ref | null;
  parent: Ref | null;
  children: Nodes<Ref>;
  subscribers: Nodes<Ref>;
  /** Relations this issue owns (it blocks, relates to, duplicates `relatedIssue`). */
  relations: Nodes<{ id: string; type: "blocks" | "related" | "duplicate"; relatedIssue: Ref }>;
  /** Relations other issues own that point at this one. */
  inverseRelations: Nodes<{ id: string; type: "blocks" | "related" | "duplicate"; issue: Ref }>;
  attachments: Nodes<{ title: string; url: string }>;
};
export type FakeComment = {
  id: string;
  issue: Ref;
  parent: Ref | null;
  user: Ref | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  updatedAt: string;
  resolvedAt: string | null;
  reactions: { id: string; emoji: string; user: Ref }[];
};
export type FakeWorkspace = {
  viewerId: string;
  users: FakeUser[];
  teams: FakeTeam[];
  states: FakeState[];
  labels: FakeLabel[];
  cycles: FakeCycle[];
  projects: FakeProject[];
  initiatives: FakeInitiative[];
  issues: FakeIssue[];
  comments: FakeComment[];
};

/** A stable UUID for the n-th fake entity of a kind (kind picks the last-but-one group). */
function uuid(kind: number, n: number): string {
  const hex = (v: number, len: number) => v.toString(16).padStart(len, "0");
  return `${hex(0xfa4e0000 + kind, 8)}-0000-4000-8000-${hex(n, 12)}`;
}
const seq = (kind: number, names: string[]) => Object.fromEntries(names.map((name, i) => [name, uuid(kind, i + 1)]));

const STATE_NAMES = ["Triage", "Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"];
const ISSUE_KEYS = ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5", "ENG-6", "DE-1", "DE-2"];

/** Every fake entity's id, by name, for tests to point at. */
export const FAKE_IDS = {
  ...(seq(1, ["owen", "sam"]) as { owen: string; sam: string }),
  ...(seq(2, ["eng", "de"]) as { eng: string; de: string }),
  states: {
    eng: seq(3, STATE_NAMES),
    de: seq(4, STATE_NAMES),
  } as { eng: Record<string, string>; de: Record<string, string> },
  labels: seq(5, ["bug", "feature"]) as { bug: string; feature: string },
  cycles: seq(6, ["eng", "de"]) as { eng: string; de: string },
  projects: seq(7, ["launch", "docs"]) as { launch: string; docs: string },
  milestones: seq(8, ["beta", "ga"]) as { beta: string; ga: string },
  initiatives: seq(9, ["q4"]) as { q4: string },
  issues: seq(10, ISSUE_KEYS) as Record<string, string>,
  comments: seq(11, ["first", "reply", "reacted"]) as { first: string; reply: string; reacted: string },
  relations: seq(12, ["eng3blocks4"]) as { eng3blocks4: string },
};

const DAY = 86_400_000;

/** The fixed sample workspace; dates are relative to now. */
export function fakeWorkspace(): FakeWorkspace {
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY).toISOString();
  const ahead = (days: number) => new Date(now + days * DAY).toISOString();
  const day = (days: number) => ahead(days).slice(0, 10);
  const I = FAKE_IDS;
  const ref = (id: string): Ref => ({ id });
  const nodes = <T>(...items: T[]): Nodes<T> => ({ nodes: items });

  const team = (id: string, key: string, name: string, extra: Partial<FakeTeam>): FakeTeam => ({
    id,
    key,
    name,
    cyclesEnabled: false,
    triageEnabled: false,
    issueEstimationType: "notUsed",
    issueEstimationAllowZero: true,
    ...extra,
  });
  const stateType: FakeState["type"][] = ["triage", "backlog", "unstarted", "started", "started", "completed", "canceled"];
  const states = (teamId: string, ids: Record<string, string>): FakeState[] =>
    STATE_NAMES.map((name, i) => ({
      id: ids[name],
      name,
      type: stateType[i],
      color: ["#bec2c8", "#e2e2e2", "#e2e2e2", "#f2c94c", "#5e6ad2", "#5e6ad2", "#95a2b3"][i],
      position: i,
      team: ref(teamId),
    }));

  let order = 0;
  const issue = (key: string, over: Partial<Omit<FakeIssue, "state">> & { title: string; state: string }): FakeIssue => {
    const [prefix, n] = key.split("-");
    const teamId = prefix === "ENG" ? I.eng : I.de;
    const stateIds = prefix === "ENG" ? I.states.eng : I.states.de;
    const { state, ...rest } = over;
    return {
      id: I.issues[key],
      identifier: key,
      description: null,
      url: `https://linear.app/fake/issue/${key}`,
      priority: 0,
      estimate: null,
      sortOrder: ++order,
      dueDate: null,
      branchName: `${key.toLowerCase()}-${over.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      createdAt: ago(30 - Number(n)),
      updatedAt: ago(2),
      archivedAt: null,
      completedAt: null,
      state: ref(stateIds[state]),
      team: ref(teamId),
      assignee: null,
      creator: ref(I.owen),
      labels: nodes(),
      project: null,
      projectMilestone: null,
      cycle: null,
      parent: null,
      children: nodes(),
      subscribers: nodes(),
      relations: nodes(),
      inverseRelations: nodes(),
      attachments: nodes(),
      ...rest,
    };
  };

  return {
    viewerId: I.owen,
    users: [
      { id: I.owen, name: "Owen Conti", displayName: "Owen" },
      { id: I.sam, name: "Sam Rivera", displayName: "Sam" },
    ],
    teams: [
      team(I.eng, "ENG", "Engineering", {
        cyclesEnabled: true,
        triageEnabled: true,
        issueEstimationType: "fibonacci",
        issueEstimationAllowZero: true,
      }),
      team(I.de, "DE", "Design Engineering", {}),
    ],
    states: [...states(I.eng, I.states.eng), ...states(I.de, I.states.de)],
    labels: [
      { id: I.labels.bug, name: "Bug", color: "#eb5757", team: null },
      { id: I.labels.feature, name: "Feature", color: "#bb87fc", team: null },
    ],
    cycles: [
      { id: I.cycles.eng, number: 7, name: null, startsAt: ago(3), endsAt: ahead(11), isActive: true, isNext: false, team: ref(I.eng) },
      { id: I.cycles.de, number: 2, name: "Polish", startsAt: ago(1), endsAt: ahead(13), isActive: true, isNext: false, team: ref(I.de) },
    ],
    projects: [
      {
        id: I.projects.launch,
        name: "Launch",
        icon: null,
        color: "#5e6ad2",
        status: { name: "Started" },
        health: "onTrack",
        lead: ref(I.owen),
        targetDate: day(30),
        progress: 0.4,
        teams: nodes(ref(I.eng)),
        projectMilestones: nodes({ id: I.milestones.beta, name: "Beta" }, { id: I.milestones.ga, name: "GA" }),
        url: "https://linear.app/fake/project/launch",
        updatedAt: ago(1),
      },
      {
        id: I.projects.docs,
        name: "Docs",
        icon: null,
        color: "#26b5ce",
        status: { name: "Planned" },
        health: null,
        lead: null,
        targetDate: null,
        progress: 0,
        teams: nodes(ref(I.de)),
        projectMilestones: nodes(),
        url: "https://linear.app/fake/project/docs",
        updatedAt: ago(5),
      },
    ],
    initiatives: [
      {
        id: I.initiatives.q4,
        name: "Q4",
        status: "Active",
        health: "onTrack",
        owner: ref(I.owen),
        targetDate: day(60),
        projects: nodes(ref(I.projects.launch)),
        url: "https://linear.app/fake/initiative/q4",
        updatedAt: ago(1),
      },
    ],
    issues: [
      issue("ENG-1", {
        title: "Ship the Linear tab",
        state: "In Progress",
        description: "The **parent** issue.\n\n![shot](https://uploads.linear.app/fake/shot.png)",
        priority: 2,
        estimate: 5,
        assignee: ref(I.owen),
        labels: nodes(ref(I.labels.feature)),
        project: ref(I.projects.launch),
        projectMilestone: ref(I.milestones.beta),
        cycle: ref(I.cycles.eng),
        children: nodes(ref(I.issues["ENG-2"])),
        subscribers: nodes(ref(I.owen)),
        attachments: nodes({ title: "Design doc", url: "https://example.com/design" }),
      }),
      issue("ENG-2", {
        title: "Draw the issue list",
        state: "Todo",
        priority: 3,
        estimate: 2,
        assignee: ref(I.sam),
        project: ref(I.projects.launch),
        cycle: ref(I.cycles.eng),
        parent: ref(I.issues["ENG-1"]),
      }),
      issue("ENG-3", {
        title: "Review the sync design",
        state: "In Review",
        priority: 1,
        assignee: ref(I.owen),
        labels: nodes(ref(I.labels.bug)),
        project: ref(I.projects.launch),
        dueDate: day(3),
        relations: nodes({ id: I.relations.eng3blocks4, type: "blocks", relatedIssue: ref(I.issues["ENG-4"]) }),
      }),
      issue("ENG-4", {
        title: "Triage incoming reports",
        state: "Triage",
        priority: 4,
        creator: ref(I.sam),
        inverseRelations: nodes({ id: I.relations.eng3blocks4, type: "blocks", issue: ref(I.issues["ENG-3"]) }),
      }),
      issue("ENG-5", {
        title: "Cut the beta",
        state: "Done",
        assignee: ref(I.owen),
        project: ref(I.projects.launch),
        projectMilestone: ref(I.milestones.beta),
        completedAt: ago(1),
        updatedAt: ago(1),
      }),
      issue("ENG-6", {
        title: "Write the launch plan",
        state: "Done",
        assignee: ref(I.sam),
        project: ref(I.projects.launch),
        completedAt: ago(20),
        updatedAt: ago(20),
      }),
      issue("DE-1", {
        title: "Refresh the docs theme",
        state: "In Progress",
        priority: 3,
        assignee: ref(I.sam),
        project: ref(I.projects.docs),
        cycle: ref(I.cycles.de),
      }),
      issue("DE-2", {
        title: "Audit the icon set",
        state: "Backlog",
        creator: ref(I.sam),
        subscribers: nodes(ref(I.owen)),
      }),
    ],
    comments: [
      {
        id: I.comments.first,
        issue: ref(I.issues["ENG-1"]),
        parent: null,
        user: ref(I.sam),
        body: "Can we start with the list?",
        createdAt: ago(4),
        editedAt: null,
        updatedAt: ago(4),
        resolvedAt: null,
        reactions: [],
      },
      {
        id: I.comments.reply,
        issue: ref(I.issues["ENG-1"]),
        parent: ref(I.comments.first),
        user: ref(I.owen),
        body: "Yes, list first.",
        createdAt: ago(3),
        editedAt: null,
        updatedAt: ago(3),
        resolvedAt: null,
        reactions: [],
      },
      {
        id: I.comments.reacted,
        issue: ref(I.issues["ENG-1"]),
        parent: null,
        user: ref(I.owen),
        body: "Beta is on track.",
        createdAt: ago(2),
        editedAt: ago(1),
        updatedAt: ago(1),
        resolvedAt: null,
        reactions: [{ id: uuid(13, 1), emoji: "👍", user: ref(I.sam) }],
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

type Filter = Record<string, any>;

/** Whether a record passes the part of Linear's IssueFilter the server sends; anything else is a typo and throws. */
function passes(ws: FakeWorkspace, issue: FakeIssue, filter: Filter): boolean {
  return Object.entries(filter).every(([field, cond]) => {
    const stateType = ws.states.find((s) => s.id === issue.state.id)?.type;
    const date = (value: string | null) => {
      if ("null" in cond) return (value === null) === cond.null;
      return value !== null && value > cond.gt;
    };
    switch (field) {
      case "and":
        return (cond as Filter[]).every((f) => passes(ws, issue, f));
      case "or":
        return (cond as Filter[]).some((f) => passes(ws, issue, f));
      case "assignee":
      case "creator": {
        const who = issue[field]?.id;
        return cond.isMe ? (who === ws.viewerId) === cond.isMe.eq : who === cond.id.eq;
      }
      case "team":
      case "project":
        return issue[field]?.id === cond.id.eq;
      case "subscribers":
        return issue.subscribers.nodes.some((u) => u.id === ws.viewerId) === cond.some.isMe.eq;
      case "state": {
        const t = cond.type;
        return t.eq ? stateType === t.eq : t.in ? t.in.includes(stateType) : !t.nin.includes(stateType);
      }
      case "completedAt":
        return date(issue.completedAt);
      case "canceledAt":
        return date(stateType === "canceled" ? issue.updatedAt : null);
      case "updatedAt":
        return date(issue.updatedAt);
      default:
        throw new FakeGraphQlError(`Unknown issue filter ${field}`, "InvalidInput");
    }
  });
}

const newestFirst = <T extends { updatedAt: string }>(items: T[]) =>
  [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/** The dispatch table, by GraphQL operation name: reads here, Task 6's writes beside them. */
export const OPERATIONS: Record<string, FakeOperation> = {
  Workspace: ({ ws }) => {
    const me = ws.users.find((u) => u.id === ws.viewerId);
    return {
      viewer: me,
      users: { nodes: ws.users },
      teams: { nodes: ws.teams },
      workflowStates: { nodes: ws.states },
      issueLabels: { nodes: ws.labels },
      cycles: { nodes: ws.cycles.filter((c) => c.isActive || c.isNext) },
      projects: { nodes: ws.projects },
      initiatives: { nodes: ws.initiatives },
    };
  },
  /** Pages are offsets into the filtered, newest-first list; the cursor is the next offset. */
  Issues: ({ ws, variables }) => {
    const filter = (variables.filter ?? {}) as Filter;
    const all = newestFirst(ws.issues.filter((i) => !i.archivedAt && passes(ws, i, filter)));
    const start = variables.after ? Number(variables.after) : 0;
    const first = Number(variables.first);
    const end = start + first;
    return {
      issues: {
        nodes: all.slice(start, end),
        pageInfo: { hasNextPage: end < all.length, endCursor: end < all.length ? String(end) : null },
      },
    };
  },
  Issue: ({ ws, variables }) => {
    const id = String(variables.id).toUpperCase();
    const issue = ws.issues.find((i) => i.identifier === id || i.id === variables.id);
    if (!issue) return { issue: null };
    const byId = (ref: Ref) => ws.issues.find((i) => i.id === ref.id)!;
    return {
      issue: {
        ...issue,
        children: { nodes: issue.children.nodes.map(byId) },
        comments: { nodes: ws.comments.filter((c) => c.issue.id === issue.id) },
      },
    };
  },
  Sync: ({ ws, variables }) => {
    const since = String(variables.since);
    const first = Number(variables.first);
    const changed = <T extends { updatedAt: string }>(items: T[]) =>
      newestFirst(items.filter((i) => i.updatedAt > since)).slice(0, first);
    return {
      issues: { nodes: changed(ws.issues) },
      comments: { nodes: changed(ws.comments) },
      projects: { nodes: changed(ws.projects) },
      initiatives: { nodes: changed(ws.initiatives) },
    };
  },
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

/** Points LINEAR.fetch at the fake workspace and sets a fake key; call `restore()` after. */
export function installFakeLinear(ws: FakeWorkspace = fakeWorkspace()): FakeLinear {
  const realFetch = LINEAR.fetch;
  const hadKey = process.env.LINEAR_API_KEY;
  const failures = new Map<string, FakeFailure>();
  const requests: FakeLinear["requests"] = [];
  process.env.LINEAR_API_KEY = "lin_api_fake";

  LINEAR.fetch = (async (_url: unknown, init?: RequestInit) => {
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
      if (hadKey === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = hadKey;
    },
  };
}
