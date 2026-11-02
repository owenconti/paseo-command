/**
 * The only ways this server changes Linear: a fixed list of named mutations,
 * each with its input checked field by field before anything is sent. An
 * unknown name or field is refused; every request is `essential` (it is the
 * user's own action, so it goes out even when the hourly budget is low).
 */
import type {
  LinearAttachment,
  LinearComment,
  LinearCustomView,
  LinearIssue,
  LinearNotification,
  WriteName,
} from "../../src/linear/types";
import {
  issuePreferences,
  PROJECT_HEALTHS,
  projectPreferences,
  toIssueFilter,
  toProjectFilter,
  type IssueViewFilter,
  type ProjectDisplay,
  type ProjectFilters,
} from "../../src/linear/viewFilter";
import type { Display } from "../../src/linear/display";
import { LinearError, linearRequest } from "./client";
import {
  ATTACHMENT_FIELDS,
  COMMENT_FIELDS,
  ISSUE_FIELDS,
  NOTIFICATION_FIELDS,
  VIEW_FIELDS,
  VIEW_PREFERENCES_QUERY,
} from "./fragments";
import { linearUpload } from "./image";
import { attachmentOf, commentOf, customViewOf, issueOf, notificationOf, recOf } from "./normalize";

type Vars = Record<string, unknown>;
type WriteResult = {
  issue?: LinearIssue;
  comment?: LinearComment;
  notifications?: LinearNotification[];
  attachment?: LinearAttachment;
  view?: LinearCustomView;
  /** False when Linear saved the view but refused its display. */
  displaySaved?: boolean;
  ok?: true;
};
type Check = (value: unknown, name: string) => unknown;

const ID = /^[0-9a-f-]{8,64}$/i;
const invalid = (message: string) => new LinearError("invalid", message);

const id: Check = (v, name) => {
  if (typeof v !== "string" || !ID.test(v)) throw invalid(`${name} must be an id`);
  return v;
};
const nullableId: Check = (v, name) => (v === null ? null : id(v, name));
const text =
  (min: number, max: number, trim: boolean): Check =>
  (v, name) => {
    if (typeof v !== "string") throw invalid(`${name} must be text`);
    const value = trim ? v.trim() : v;
    if ((trim ? value : value.trim()).length < min || value.length > max)
      throw invalid(`${name} must be ${min === 0 ? `at most ${max}` : `${min} to ${max}`} characters`);
    return value;
  };
const priority: Check = (v, name) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 4) throw invalid(`${name} must be 0 to 4`);
  return v;
};
const estimate: Check = (v, name) => {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1000) throw invalid(`${name} must be a whole number or null`);
  return v;
};
const dueDate: Check = (v, name) => {
  if (v === null) return null;
  const ok =
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!ok) throw invalid(`${name} must be YYYY-MM-DD or null`);
  return v;
};
const labelIds: Check = (v, name) => {
  if (!Array.isArray(v) || v.length > 50) throw invalid(`${name} must be at most 50 ids`);
  return v.map((x) => id(x, name));
};
const oneOf =
  (...values: string[]): Check =>
  (v, name) => {
    if (typeof v !== "string" || !values.includes(v)) throw invalid(`${name} must be one of ${values.join(", ")}`);
    return v;
  };

const when: Check = (v, name) => {
  const at = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
  // Within a year either way: a read, snooze or unsnooze time, not a typo.
  if (!Number.isFinite(at) || Math.abs(at - Date.now()) > 366 * 86_400_000) throw invalid(`${name} must be a time within a year`);
  return new Date(at).toISOString();
};

/** A web address to attach: http or https, no credentials, at most 2,000 characters. */
const webAddress: Check = (v, name) => {
  let url: URL | undefined;
  try {
    url = typeof v === "string" && v.length <= 2000 ? new URL(v.trim()) : undefined;
  } catch {
    url = undefined;
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw invalid(`${name} must be an http or https address`);
  return url.href;
};
/** A file uploaded to Linear (`/api/linear/upload` answers its address). */
const uploadAddress: Check = (v, name) => {
  const url = typeof v === "string" ? linearUpload(v) : null;
  if (!url) throw invalid(`${name} must be a file uploaded to Linear`);
  return url.href;
};

/** The checked fields of `input`: every `required` one present, every present one known and valid. */
function fields(input: unknown, required: Record<string, Check>, optional: Record<string, Check> = {}): Vars {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Expected an object");
  const given = input as Vars;
  const known = { ...required, ...optional };
  for (const name of Object.keys(given)) if (!Object.hasOwn(known, name)) throw invalid(`Unexpected field ${name}`);
  const out: Vars = {};
  for (const name of Object.keys(required)) {
    if (given[name] === undefined) throw invalid(`Missing field ${name}`);
  }
  for (const [name, check] of Object.entries(known)) {
    if (given[name] !== undefined) out[name] = check(given[name], name);
  }
  return out;
}

/** The issue fields shared by update and create, all optional. */
const ISSUE_INPUT: Record<string, Check> = {
  title: text(1, 255, true),
  description: text(0, 100000, false),
  stateId: id,
  priority,
  estimate,
  assigneeId: nullableId,
  labelIds,
  projectId: nullableId,
  projectMilestoneId: nullableId,
  cycleId: nullableId,
  parentId: nullableId,
  dueDate,
};

const split = (checked: Vars, ...keep: string[]): Vars => {
  const head: Vars = {};
  const input: Vars = {};
  for (const [k, v] of Object.entries(checked)) (keep.includes(k) ? head : input)[k] = v;
  return { ...head, input };
};

type Write = { validate(input: unknown): Vars; run(vars: Vars): Promise<WriteResult> };

/**
 * A notification write's variables: the notifications it acts on, those of one
 * issue or project or one notification (`input`, Linear's NotificationEntityInput),
 * and its time (`timeName`, when it has one).
 */
function notificationsOf(input: unknown, timeName?: string): Vars {
  const checked = fields(input, timeName ? { [timeName]: when } : {}, { id, issueId: id, projectId: id });
  const named = ["id", "issueId", "projectId"].filter((k) => checked[k] !== undefined);
  if (named.length !== 1) throw invalid("Name one notification, issue or project");
  return { input: { [named[0]]: checked[named[0]] }, ...(timeName ? { [timeName]: checked[timeName] } : {}) };
}
/** A notification write on many (an issue's, a project's, or one by id): the notifications as Linear has them now. */
const notificationsWrite = (field: string, operation: string, timeName?: string) =>
  write(
    operation,
    `mutation ${operation}($input: NotificationEntityInput!${timeName ? `, $${timeName}: DateTime!` : ""}) {
      ${field}(input: $input${timeName ? `, ${timeName}: $${timeName}` : ""}) { success notifications { ${NOTIFICATION_FIELDS} } } }`,
    (input) => notificationsOf(input, timeName),
    (data) => {
      succeeded(data, field);
      const list = recOf(data)[field];
      const nodes = Array.isArray(recOf(list).notifications) ? (recOf(list).notifications as unknown[]) : [];
      return { notifications: nodes.map((n) => notificationOf(recOf(n))).filter((n) => n !== null) };
    },
  );

const issueOut = (data: unknown, path: string[]): LinearIssue => {
  let at: unknown = data;
  for (const step of path) at = recOf(at)[step];
  const issue = issueOf(recOf(at));
  if (!issue) throw new LinearError("failed", "Linear did not return the issue.");
  return issue;
};
const commentOut = (data: unknown, path: string[]): LinearComment => {
  let at: unknown = data;
  for (const step of path) at = recOf(at)[step];
  const comment = commentOf(recOf(at));
  if (!comment) throw new LinearError("failed", "Linear did not return the comment.");
  return comment;
};
const attachmentOut = (data: unknown, field: string): LinearAttachment => {
  const attachment = attachmentOf(recOf(recOf(recOf(data)[field]).attachment));
  if (!attachment) throw new LinearError("failed", "Linear did not return the attachment.");
  return attachment;
};
const succeeded = (data: unknown, field: string) => {
  if (recOf(recOf(data)[field]).success !== true) throw new LinearError("failed", "Linear did not make the change.");
};

/** A write: `check` the input, send `query` as `operation`, and shape the answer with `shape`. */
function write(
  operation: string,
  query: string,
  validate: (input: unknown) => Vars,
  shape: (data: unknown) => WriteResult,
): Write {
  return {
    validate,
    async run(vars) {
      const data = await linearRequest<unknown>(operation, query, vars, { essential: true });
      return shape(data);
    },
  };
}

/** A write on one issue by id, answering the issue (Linear calls it `entity` for archive and unarchive). */
const issueWrite = (field: string, operation: string, resultField: "issue" | "entity") =>
  write(
    operation,
    `mutation ${operation}($id: String!) { ${field}(id: $id) { success ${resultField} { ${ISSUE_FIELDS} } } }`,
    (input) => fields(input, { id }),
    (data) => {
      succeeded(data, field);
      return { issue: issueOut(data, [field, resultField]) };
    },
  );

/** A list of at most `max` distinct values, each passing `each`. */
const listOf =
  (each: Check, max = 100): Check =>
  (v, name) => {
    if (!Array.isArray(v) || v.length === 0 || v.length > max) throw invalid(`${name} must be 1 to ${max} values`);
    return [...new Set(v.map((x) => each(x, name)))];
  };
/** An id, or "none" (the issues or projects without one). */
const idOrNone: Check = (v, name) => (v === "none" ? v : id(v, name));
const STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];

/** A view's issue filter, as the page's `Filters` and its place's base: only what the app can express. */
const issueViewFilter: Check = (v) => {
  const checked = fields(v, {}, { base: (b) => b, filters: (f) => f });
  const base = fields(checked.base ?? {}, {}, {
    teamId: id,
    stateTypes: listOf(oneOf(...STATE_TYPES), 6),
    me: oneOf("assignee", "creator", "subscriber"),
  });
  const filters = fields(checked.filters ?? {}, {}, {
    status: listOf(text(1, 200, false)),
    assignee: listOf(idOrNone),
    priority: listOf(oneOf("0", "1", "2", "3", "4"), 5),
    labels: listOf(idOrNone),
    project: listOf(idOrNone),
    cycle: listOf(idOrNone),
  });
  return { base, filters };
};
const projectViewFilter: Check = (v) =>
  fields(v, {}, {
    status: listOf(text(1, 200, false)),
    health: listOf(oneOf(...PROJECT_HEALTHS), 3),
    lead: listOf(idOrNone),
    team: listOf(id),
  });
const issueDisplay: Check = (v) => {
  const grouping = oneOf("status", "assignee", "priority", "project", "cycle", "none");
  return fields(v, {
    layout: oneOf("list", "board"),
    grouping,
    subGrouping: grouping,
    ordering: oneOf("priority", "updated", "created", "manual", "due", "title", "relevance"),
    completed: oneOf("all", "month", "week", "none"),
  });
};
const projectDisplay: Check = (v) =>
  fields(v, {
    grouping: oneOf("none", "status", "health", "lead"),
    ordering: oneOf("status", "name", "target", "progress", "updated"),
    completed: oneOf("all", "none"),
  });
/** A view's icon: one of Linear's icon names, or an emoji (no spaces); null for none. */
const viewIcon: Check = (v, name) => {
  if (v === null) return null;
  if (typeof v !== "string" || !/^[^\s<>"'`]{1,40}$/u.test(v)) throw invalid(`${name} must be an icon name or emoji`);
  return v;
};
const viewColor: Check = (v, name) => {
  if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) throw invalid(`${name} must be a #rrggbb colour`);
  return v.toLowerCase();
};

const VIEW_INPUT: Record<string, Check> = {
  name: text(1, 255, true),
  description: text(0, 500, true),
  icon: viewIcon,
  color: viewColor,
  sharing: oneOf("personal", "team", "workspace"),
  teamId: id,
  filter: issueViewFilter,
  projectFilter: projectViewFilter,
  display: issueDisplay,
  projectDisplay,
};

/** Linear's CustomViewCreateInput / CustomViewUpdateInput fields for the checked ones, and the display to save after. */
function viewInput(checked: Vars, model: "issue" | "project" | undefined): { input: Vars; preferences?: Record<string, string> } {
  const input: Vars = {};
  for (const key of ["name", "description", "icon", "color"]) if (checked[key] !== undefined) input[key] = checked[key];
  const { sharing, teamId } = checked;
  if (teamId !== undefined && sharing !== "team") throw invalid("teamId is only for a view shared with a team");
  if (sharing === "team" && teamId === undefined) throw invalid("Name the team to share the view with");
  if (sharing !== undefined) {
    input.shared = sharing !== "personal";
    input.teamId = sharing === "team" ? teamId : null;
  }
  if (checked.filter !== undefined && checked.projectFilter !== undefined) throw invalid("Give an issue filter or a project filter");
  if (model === "project" && (checked.filter !== undefined || checked.display !== undefined))
    throw invalid("A project view takes a project filter and display");
  if (model === "issue" && (checked.projectFilter !== undefined || checked.projectDisplay !== undefined))
    throw invalid("An issue view takes an issue filter and display");
  if (checked.filter !== undefined) input.filterData = toIssueFilter(checked.filter as IssueViewFilter);
  if (checked.projectFilter !== undefined) input.projectFilterData = toProjectFilter(checked.projectFilter as ProjectFilters);
  if (checked.display !== undefined && checked.projectDisplay !== undefined) throw invalid("Give one display");
  const preferences =
    checked.display !== undefined
      ? issuePreferences(checked.display as Display)
      : checked.projectDisplay !== undefined
        ? projectPreferences(checked.projectDisplay as ProjectDisplay)
        : undefined;
  return { input, ...(preferences ? { preferences } : {}) };
}

/** The view Linear answered, with the display just saved (its answer was made before the preferences were). */
function viewOut(raw: unknown, preferences: Record<string, string> | undefined): LinearCustomView {
  const r = recOf(raw);
  const view = customViewOf(
    preferences ? { ...r, viewPreferencesValues: { ...recOf(r.viewPreferencesValues), ...preferences } } : r,
  );
  if (!view) throw new LinearError("failed", "Linear did not return the view.");
  return view;
}

const essential = { essential: true };
const PREFERENCES_CREATE = `mutation ViewPreferencesCreate($input: ViewPreferencesCreateInput!) {
  viewPreferencesCreate(input: $input) { success } }`;
const PREFERENCES_UPDATE = `mutation ViewPreferencesUpdate($id: String!, $input: ViewPreferencesUpdateInput!) {
  viewPreferencesUpdate(id: $id, input: $input) { success } }`;

/**
 * Saves a view's display as its preferences: a shared view's for everyone (the
 * workspace's, and yours too where you have your own, so you see it), a
 * personal one's as yours. False when Linear refused.
 */
async function savePreferences(viewId: string, preferences: Record<string, string>, created?: { shared: boolean }): Promise<boolean> {
  try {
    const known = created
      ? { shared: created.shared, organizationViewPreferences: null, userViewPreferences: null }
      : recOf(recOf(await linearRequest<unknown>("ViewPreferencesOf", VIEW_PREFERENCES_QUERY, { id: viewId }, essential)).customView);
    const orgId = recOf(known.organizationViewPreferences).id;
    const userId = recOf(known.userViewPreferences).id;
    const put = async (type: "organization" | "user", existing: unknown) => {
      const data =
        typeof existing === "string" && existing
          ? await linearRequest<unknown>("ViewPreferencesUpdate", PREFERENCES_UPDATE, { id: existing, input: { preferences } }, essential)
          : await linearRequest<unknown>(
              "ViewPreferencesCreate",
              PREFERENCES_CREATE,
              { input: { customViewId: viewId, type, viewType: "customView", preferences } },
              essential,
            );
      succeeded(data, typeof existing === "string" && existing ? "viewPreferencesUpdate" : "viewPreferencesCreate");
    };
    if (known.shared === true) {
      await put("organization", orgId);
      if (typeof userId === "string" && userId) await put("user", userId);
    } else await put("user", userId);
    return true;
  } catch {
    return false;
  }
}

const VIEW_CREATE = `mutation CustomViewCreate($input: CustomViewCreateInput!) {
  customViewCreate(input: $input) { success customView { ${VIEW_FIELDS} } } }`;
const VIEW_UPDATE = `mutation CustomViewUpdate($id: String!, $input: CustomViewUpdateInput!) {
  customViewUpdate(id: $id, input: $input) { success customView { ${VIEW_FIELDS} } } }`;
const VIEW_QUERY = `query CustomView($id: String!) { customView(id: $id) { ${VIEW_FIELDS} } }`;

/** Creates a view: its fields, then its display; answers the view as saved. */
const viewCreate: Write = {
  validate(input) {
    const checked = fields(input, { name: VIEW_INPUT.name, sharing: VIEW_INPUT.sharing }, {
      ...VIEW_INPUT,
      model: oneOf("issue", "project"),
      projectId: id,
    });
    const model = (checked.model ?? "issue") as "issue" | "project";
    if (checked.projectId !== undefined && model !== "issue") throw invalid("A project's own views are of issues");
    const { input: linear, preferences } = viewInput(checked, model);
    if (model === "project" && linear.projectFilterData === undefined) linear.projectFilterData = {};
    if (model === "issue" && linear.filterData === undefined) linear.filterData = {};
    if (checked.projectId !== undefined) linear.projectId = checked.projectId;
    if (linear.teamId === null) delete linear.teamId;
    return { input: linear, ...(preferences ? { preferences } : {}) };
  },
  async run({ input, preferences }) {
    const data = await linearRequest<unknown>("CustomViewCreate", VIEW_CREATE, { input }, essential);
    succeeded(data, "customViewCreate");
    const raw = recOf(recOf(data).customViewCreate).customView;
    const view = viewOut(raw, undefined);
    if (!preferences) return { view };
    const displaySaved = await savePreferences(view.id, preferences as Record<string, string>, { shared: view.shared });
    return { view: viewOut(raw, displaySaved ? (preferences as Record<string, string>) : undefined), displaySaved };
  },
};

/** Changes a view: the fields given, then (if given) its display; answers the view as saved. */
const viewUpdate: Write = {
  validate(input) {
    const checked = fields(input, { id }, VIEW_INPUT);
    if (Object.keys(checked).length < 2) throw invalid("Nothing to change");
    const { input: linear, preferences } = viewInput(checked, undefined);
    return { id: checked.id, input: linear, ...(preferences ? { preferences } : {}) };
  },
  async run({ id: viewId, input, preferences }) {
    let raw: unknown;
    if (Object.keys(input as Vars).length) {
      const data = await linearRequest<unknown>("CustomViewUpdate", VIEW_UPDATE, { id: viewId, input }, essential);
      succeeded(data, "customViewUpdate");
      raw = recOf(recOf(data).customViewUpdate).customView;
    }
    if (!preferences) return { view: viewOut(raw, undefined) };
    const displaySaved = await savePreferences(viewId as string, preferences as Record<string, string>);
    if (raw === undefined) {
      if (!displaySaved) throw new LinearError("failed", "Linear did not save the view's display.");
      raw = recOf(await linearRequest<unknown>("CustomView", VIEW_QUERY, { id: viewId }, essential)).customView;
    }
    return { view: viewOut(raw, displaySaved ? (preferences as Record<string, string>) : undefined), displaySaved };
  },
};

const idOnly = (input: unknown) => fields(input, { id });
const okShape = (field: string) => (data: unknown) => {
  succeeded(data, field);
  return { ok: true as const };
};

export const WRITES: Record<WriteName, Write> = {
  issueUpdate: write(
    "IssueUpdate",
    `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
    (input) => {
      const checked = fields(input, { id }, ISSUE_INPUT);
      if (Object.keys(checked).length < 2) throw invalid("Nothing to change");
      return split(checked, "id");
    },
    (data) => {
      succeeded(data, "issueUpdate");
      return { issue: issueOut(data, ["issueUpdate", "issue"]) };
    },
  ),
  issueCreate: write(
    "IssueCreate",
    `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
    (input) => ({ input: fields(input, { teamId: id, title: ISSUE_INPUT.title }, ISSUE_INPUT) }),
    (data) => {
      succeeded(data, "issueCreate");
      return { issue: issueOut(data, ["issueCreate", "issue"]) };
    },
  ),
  issueArchive: issueWrite("issueArchive", "IssueArchive", "entity"),
  issueUnarchive: issueWrite("issueUnarchive", "IssueUnarchive", "entity"),
  issueSubscribe: issueWrite("issueSubscribe", "IssueSubscribe", "issue"),
  issueUnsubscribe: issueWrite("issueUnsubscribe", "IssueUnsubscribe", "issue"),
  issueDelete: write(
    "IssueDelete",
    `mutation IssueDelete($id: String!) { issueDelete(id: $id) { success } }`,
    idOnly,
    okShape("issueDelete"),
  ),
  issueRelationCreate: write(
    "IssueRelationCreate",
    `mutation IssueRelationCreate($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`,
    (input) => ({
      input: fields(input, { issueId: id, relatedIssueId: id, type: oneOf("blocks", "related", "duplicate") }),
    }),
    okShape("issueRelationCreate"),
  ),
  issueRelationDelete: write(
    "IssueRelationDelete",
    `mutation IssueRelationDelete($id: String!) { issueRelationDelete(id: $id) { success } }`,
    idOnly,
    okShape("issueRelationDelete"),
  ),
  commentCreate: write(
    "CommentCreate",
    `mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { ${COMMENT_FIELDS} } } }`,
    (input) => ({ input: fields(input, { issueId: id, body: text(1, 100000, false) }, { parentId: id }) }),
    (data) => {
      succeeded(data, "commentCreate");
      return { comment: commentOut(data, ["commentCreate", "comment"]) };
    },
  ),
  commentUpdate: write(
    "CommentUpdate",
    `mutation CommentUpdate($id: String!, $input: CommentUpdateInput!) {
      commentUpdate(id: $id, input: $input) { success comment { ${COMMENT_FIELDS} } } }`,
    (input) => split(fields(input, { id, body: text(1, 100000, false) }), "id"),
    (data) => {
      succeeded(data, "commentUpdate");
      return { comment: commentOut(data, ["commentUpdate", "comment"]) };
    },
  ),
  commentDelete: write(
    "CommentDelete",
    `mutation CommentDelete($id: String!) { commentDelete(id: $id) { success } }`,
    idOnly,
    okShape("commentDelete"),
  ),
  commentResolve: write(
    "CommentResolve",
    `mutation CommentResolve($id: String!) { commentResolve(id: $id) { success comment { ${COMMENT_FIELDS} } } }`,
    idOnly,
    (data) => {
      succeeded(data, "commentResolve");
      return { ok: true, comment: commentOut(data, ["commentResolve", "comment"]) };
    },
  ),
  commentUnresolve: write(
    "CommentUnresolve",
    `mutation CommentUnresolve($id: String!) { commentUnresolve(id: $id) { success comment { ${COMMENT_FIELDS} } } }`,
    idOnly,
    (data) => {
      succeeded(data, "commentUnresolve");
      return { ok: true, comment: commentOut(data, ["commentUnresolve", "comment"]) };
    },
  ),
  reactionCreate: write(
    "ReactionCreate",
    `mutation ReactionCreate($input: ReactionCreateInput!) { reactionCreate(input: $input) { success } }`,
    (input) => ({ input: fields(input, { commentId: id, emoji: text(1, 50, false) }) }),
    okShape("reactionCreate"),
  ),
  reactionDelete: write(
    "ReactionDelete",
    `mutation ReactionDelete($id: String!) { reactionDelete(id: $id) { success } }`,
    idOnly,
    okShape("reactionDelete"),
  ),
  notificationMarkReadAll: notificationsWrite("notificationMarkReadAll", "NotificationMarkReadAll", "readAt"),
  notificationMarkUnreadAll: notificationsWrite("notificationMarkUnreadAll", "NotificationMarkUnreadAll"),
  notificationSnoozeAll: notificationsWrite("notificationSnoozeAll", "NotificationSnoozeAll", "snoozedUntilAt"),
  notificationUnsnoozeAll: notificationsWrite("notificationUnsnoozeAll", "NotificationUnsnoozeAll", "unsnoozedAt"),
  notificationArchiveAll: notificationsWrite("notificationArchiveAll", "NotificationArchiveAll"),
  attachmentLinkURL: write(
    "AttachmentLinkURL",
    `mutation AttachmentLinkURL($issueId: String!, $url: String!, $title: String) {
      attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success attachment { ${ATTACHMENT_FIELDS} } } }`,
    (input) => fields(input, { issueId: id, url: webAddress }, { title: text(1, 255, true) }),
    (data) => {
      succeeded(data, "attachmentLinkURL");
      return { attachment: attachmentOut(data, "attachmentLinkURL") };
    },
  ),
  attachmentCreate: write(
    "AttachmentCreate",
    `mutation AttachmentCreate($input: AttachmentCreateInput!) {
      attachmentCreate(input: $input) { success attachment { ${ATTACHMENT_FIELDS} } } }`,
    (input) => ({
      input: fields(input, { issueId: id, url: uploadAddress, title: text(1, 255, true) }, { subtitle: text(0, 255, true) }),
    }),
    (data) => {
      succeeded(data, "attachmentCreate");
      return { attachment: attachmentOut(data, "attachmentCreate") };
    },
  ),
  attachmentDelete: write(
    "AttachmentDelete",
    `mutation AttachmentDelete($id: String!) { attachmentDelete(id: $id) { success } }`,
    idOnly,
    okShape("attachmentDelete"),
  ),
  customViewCreate: viewCreate,
  customViewUpdate: viewUpdate,
  customViewDelete: write(
    "CustomViewDelete",
    `mutation CustomViewDelete($id: String!) { customViewDelete(id: $id) { success } }`,
    idOnly,
    okShape("customViewDelete"),
  ),
  notificationUnarchive: write(
    "NotificationUnarchive",
    `mutation NotificationUnarchive($id: String!) { notificationUnarchive(id: $id) { success entity { ${NOTIFICATION_FIELDS} } } }`,
    idOnly,
    (data) => {
      succeeded(data, "notificationUnarchive");
      const notification = notificationOf(recOf(recOf(recOf(data).notificationUnarchive).entity));
      if (!notification) throw new LinearError("failed", "Linear did not return the notification.");
      return { notifications: [notification] };
    },
  ),
};

/** Checks `input` for the write called `name` and sends it; unknown names are invalid. */
export async function linearWrite(name: string, input: unknown): Promise<WriteResult> {
  if (!Object.hasOwn(WRITES, name)) throw invalid(`Unknown write ${name}`);
  const write = WRITES[name as WriteName];
  return write.run(write.validate(input));
}
