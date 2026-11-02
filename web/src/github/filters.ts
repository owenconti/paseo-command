/**
 * A repository's pull request filters, shared by the page (the chips under
 * the list's head) and the server (`q/prs?repo=…`, which asks GitHub's search
 * with them). State, review status, draft and CI are one value each (one of
 * GitHub's search qualifiers); author, reviewer and assignee are any of
 * several people (`@me` is you), which GitHub's search can't OR in one query,
 * so each person (and a reviewer's two qualifiers, requested or reviewed) is
 * one more search, their answers merged: at most `MAX_SEARCHES` of them.
 */

export type PeopleField = "author" | "reviewer" | "assignee";
export type ValueField = "state" | "review" | "draft" | "checks";
export type RepoFilters = {
  state: "open" | "closed" | "merged";
  review?: "required" | "approved" | "changes";
  draft?: "draft" | "ready";
  checks?: "passing" | "failing" | "pending";
  /** Logins (or `@me`), any of them. */
  author?: string[];
  reviewer?: string[];
  assignee?: string[];
};
export type FilterField = ValueField | PeopleField;

export const DEFAULT_FILTERS: RepoFilters = { state: "open" };
/** You, as GitHub's search says it. */
export const ME = "@me";
/** A person's login as a filter takes it: `@me`, a user's login, or an app's (`name[bot]`). */
export const PERSON = /^(?:@me|[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?)$/;
/** At most this many people in one filter, and searches for one list. */
export const MAX_PEOPLE = 6;
export const MAX_SEARCHES = 6;

/** Each one-value filter's name, its values' words, and what GitHub's search says for them. */
export const FILTERS: { [F in ValueField]: { label: string; values: Record<NonNullable<RepoFilters[F]>, { text: string; query: string }> } } = {
  state: {
    label: "State",
    values: {
      open: { text: "Open", query: "is:open" },
      closed: { text: "Closed", query: "is:closed is:unmerged" },
      merged: { text: "Merged", query: "is:merged" },
    },
  },
  review: {
    label: "Review",
    values: {
      required: { text: "Review required", query: "review:required" },
      approved: { text: "Approved", query: "review:approved" },
      changes: { text: "Changes requested", query: "review:changes_requested" },
    },
  },
  draft: {
    label: "Draft",
    values: {
      draft: { text: "Draft", query: "draft:true" },
      ready: { text: "Ready for review", query: "draft:false" },
    },
  },
  checks: {
    label: "CI",
    values: {
      passing: { text: "Passing", query: "status:success" },
      failing: { text: "Failing", query: "status:failure" },
      pending: { text: "Pending", query: "status:pending" },
    },
  },
};
/** The people filters: their names and the search qualifiers each person is asked with (any of them). */
export const PEOPLE: Record<PeopleField, { label: string; qualifiers: string[] }> = {
  author: { label: "Author", qualifiers: ["author"] },
  reviewer: { label: "Reviewer", qualifiers: ["review-requested", "reviewed-by"] },
  assignee: { label: "Assignee", qualifiers: ["assignee"] },
};
export const VALUE_FIELDS = Object.keys(FILTERS) as ValueField[];
export const PEOPLE_FIELDS = Object.keys(PEOPLE) as PeopleField[];
/** In the Filter menu's order. */
export const FILTER_FIELDS: FilterField[] = ["state", "author", "reviewer", "assignee", "review", "draft", "checks"];
export const isPeople = (f: FilterField): f is PeopleField => f in PEOPLE;
export const fieldLabel = (f: FilterField) => (isPeople(f) ? PEOPLE[f].label : FILTERS[f].label);

/** The searches these filters take: each people filter's people × its qualifiers, multiplied. */
export const searchCount = (f: RepoFilters) => PEOPLE_FIELDS.reduce((n, field) => n * Math.max(1, (f[field]?.length ?? 0) * PEOPLE[field].qualifiers.length), 1);

/** Untrusted people (a query, localStorage) as valid logins, once each, in order. */
function checkPeople(raw: unknown): string[] {
  const list = typeof raw === "string" ? [raw === "me" ? ME : raw] : Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const v of list) {
    const login = v === "me" ? ME : v;
    if (typeof login === "string" && PERSON.test(login) && !out.some((o) => o.toLowerCase() === login.toLowerCase())) out.push(login);
  }
  return out.slice(0, MAX_PEOPLE);
}

/**
 * Untrusted filters (a query, localStorage) as valid ones; anything unknown is
 * left out. The old one-value author filter (`"me"`) becomes `["@me"]`; people
 * past `MAX_SEARCHES` are dropped from the last filter that has them.
 */
export function checkFilters(raw: unknown): RepoFilters {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: RepoFilters = { ...DEFAULT_FILTERS };
  for (const field of VALUE_FIELDS) {
    const v = o[field];
    if (typeof v === "string" && Object.hasOwn(FILTERS[field].values, v)) (out as unknown as Record<string, string>)[field] = v;
  }
  for (const field of PEOPLE_FIELDS) {
    const people = checkPeople(o[field]);
    if (people.length) out[field] = people;
  }
  for (const field of [...PEOPLE_FIELDS].reverse())
    while (searchCount(out) > MAX_SEARCHES && out[field]?.length) {
      out[field] = out[field]!.slice(0, -1);
      if (!out[field]!.length) delete out[field];
    }
  return out;
}

const sorted = (people: string[]) => [...people].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

/** The filters as query parameters (in a fixed order, people sorted and comma-joined, so equal filters ask the same path). */
export function filterParams(f: RepoFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of FILTER_FIELDS) {
    const v = f[field];
    if (Array.isArray(v)) {
      if (v.length) out[field] = sorted(v).join(",");
    } else if (v) out[field] = v;
  }
  return out;
}

/** A person as a search qualifier's value: an app's login (`name[bot]`) is `app/name`. */
const whom = (login: string) => (/\[bot\]$/.test(login) ? `app/${login.slice(0, -5)}` : login);

/**
 * GitHub's searches for a repository's pull requests with these filters, most
 * recently updated first: one, or one for each choice of person (and
 * qualifier) across the people filters (in login order, so the same people ask
 * the same searches), whose answers together are the list.
 */
export function filterQueries(repo: string, f: RepoFilters): string[] {
  const base = ["is:pr", `repo:${repo}`];
  for (const field of VALUE_FIELDS) {
    const v = f[field];
    if (v) base.push((FILTERS[field].values as Record<string, { query: string }>)[v]!.query);
  }
  let queries: string[][] = [base];
  for (const field of PEOPLE_FIELDS) {
    const people = sorted(f[field] ?? []);
    if (!people.length) continue;
    const terms = people.flatMap((p) => PEOPLE[field].qualifiers.map((q) => `${q}:${whom(p)}`));
    queries = queries.flatMap((q) => terms.map((t) => [...q, t]));
  }
  return queries.map((q) => [...q, "sort:updated-desc"].join(" "));
}

/** The filters set beyond the default (open). */
export const filtersSet = (f: RepoFilters) => FILTER_FIELDS.some((field) => field !== "state" && (Array.isArray(f[field]) ? f[field]!.length : f[field])) || f.state !== "open";

/** A one-value filter's value in words. */
export const filterText = (field: ValueField, value: string) => (FILTERS[field].values as Record<string, { text: string }>)[value]?.text ?? value;

/** A person in words: you, or their login. */
export const personText = (login: string) => (login === ME ? "You" : login);
/** A people filter's people in words: two named, then how many more. */
export function peopleText(people: string[]): string {
  const names = people.map(personText);
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}
