/**
 * The only ways this server changes Linear: Activity's read, unread and done
 * (archive) on a row's notifications, each with its input checked field by
 * field before anything is sent. An unknown name or field is refused; every
 * request is `essential` (it is the user's own action, so it goes out even
 * when the hourly budget is low).
 */
import type { LinearNotification, WriteName } from "./types";
import { LinearError, linearRequest } from "./client";
import { NOTIFICATION_FIELDS } from "./fragments";
import { notificationOf, recOf } from "./normalize";

type Vars = Record<string, unknown>;
type WriteResult = { notifications: LinearNotification[] };
type Check = (value: unknown, name: string) => unknown;

const ID = /^[0-9a-f-]{8,64}$/i;
const invalid = (message: string) => new LinearError("invalid", message);

const id: Check = (v, name) => {
  if (typeof v !== "string" || !ID.test(v)) throw invalid(`${name} must be an id`);
  return v;
};
const when: Check = (v, name) => {
  const at = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
  // Within a year either way: a read time, not a typo.
  if (!Number.isFinite(at) || Math.abs(at - Date.now()) > 366 * 86_400_000) throw invalid(`${name} must be a time within a year`);
  return new Date(at).toISOString();
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
const notificationsWrite = (field: string, operation: string, timeName?: string): Write => {
  const query = `mutation ${operation}($input: NotificationEntityInput!${timeName ? `, $${timeName}: DateTime!` : ""}) {
      ${field}(input: $input${timeName ? `, ${timeName}: $${timeName}` : ""}) { success notifications { ${NOTIFICATION_FIELDS} } } }`;
  return {
    validate: (input) => notificationsOf(input, timeName),
    async run(vars) {
      const data = recOf(await linearRequest<unknown>(operation, query, vars, { essential: true }));
      const list = recOf(data[field]);
      if (list.success !== true) throw new LinearError("failed", "Linear did not make the change.");
      const nodes = Array.isArray(list.notifications) ? (list.notifications as unknown[]) : [];
      return { notifications: nodes.map((n) => notificationOf(recOf(n))).filter((n) => n !== null) };
    },
  };
};

export const WRITES: Record<WriteName, Write> = {
  notificationMarkReadAll: notificationsWrite("notificationMarkReadAll", "NotificationMarkReadAll", "readAt"),
  notificationMarkUnreadAll: notificationsWrite("notificationMarkUnreadAll", "NotificationMarkUnreadAll"),
  notificationArchiveAll: notificationsWrite("notificationArchiveAll", "NotificationArchiveAll"),
};

/** Checks `input` for the write called `name` and sends it; unknown names are invalid. */
export async function linearWrite(name: string, input: unknown): Promise<WriteResult> {
  if (!Object.hasOwn(WRITES, name)) throw invalid(`Unknown write ${name}`);
  const write = WRITES[name as WriteName];
  return write.run(write.validate(input));
}
