/**
 * The only ways this server changes Linear: a fixed list of named mutations,
 * each with its input checked field by field before anything is sent. An
 * unknown name or field is refused; every request is `essential` (it is the
 * user's own action, so it goes out even when the hourly budget is low).
 */
import type { LinearComment, LinearIssue, WriteName } from "../../src/linear/types";
import { LinearError, linearRequest } from "./client";
import { COMMENT_FIELDS, ISSUE_FIELDS } from "./fragments";
import { commentOf, issueOf, recOf } from "./normalize";

type Vars = Record<string, unknown>;
type WriteResult = { issue?: LinearIssue; comment?: LinearComment; ok?: true };
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
};

/** Checks `input` for the write called `name` and sends it; unknown names are invalid. */
export async function linearWrite(name: string, input: unknown): Promise<WriteResult> {
  if (!Object.hasOwn(WRITES, name)) throw invalid(`Unknown write ${name}`);
  const write = WRITES[name as WriteName];
  return write.run(write.validate(input));
}
