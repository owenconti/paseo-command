/**
 * A repository's pull request filters, shared by the page (the chips under
 * the list's head) and the server (`q/prs?repo=…`, which asks GitHub's search
 * with them). Each is one of GitHub's search qualifiers, so one value each:
 * state (open by default), author, review status, draft and CI status.
 */

export type RepoFilters = {
  state: "open" | "closed" | "merged";
  author?: "me";
  review?: "required" | "approved" | "changes";
  draft?: "draft" | "ready";
  checks?: "passing" | "failing" | "pending";
};
export type FilterField = keyof RepoFilters;

export const DEFAULT_FILTERS: RepoFilters = { state: "open" };

/** Each filter's name, its values' words, and what GitHub's search says for them. */
export const FILTERS: { [F in FilterField]: { label: string; values: Record<NonNullable<RepoFilters[F]>, { text: string; query: string }> } } = {
  state: {
    label: "State",
    values: {
      open: { text: "Open", query: "is:open" },
      closed: { text: "Closed", query: "is:closed is:unmerged" },
      merged: { text: "Merged", query: "is:merged" },
    },
  },
  author: { label: "Author", values: { me: { text: "You", query: "author:@me" } } },
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
export const FILTER_FIELDS = Object.keys(FILTERS) as FilterField[];

/** Untrusted filters (a query, localStorage) as valid ones; anything unknown is left out. */
export function checkFilters(raw: unknown): RepoFilters {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: RepoFilters = { ...DEFAULT_FILTERS };
  for (const field of FILTER_FIELDS) {
    const v = o[field];
    if (typeof v === "string" && Object.hasOwn(FILTERS[field].values, v)) (out as Record<string, string>)[field] = v;
  }
  return out;
}

/** The filters as query parameters (in a fixed order, so equal filters ask the same path). */
export function filterParams(f: RepoFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of FILTER_FIELDS) if (f[field]) out[field] = f[field]!;
  return out;
}

/** GitHub's search for a repository's pull requests with these filters, most recently updated first. */
export function filterQuery(repo: string, f: RepoFilters): string {
  const parts = ["is:pr", `repo:${repo}`];
  for (const field of FILTER_FIELDS) {
    const v = f[field];
    if (v) parts.push((FILTERS[field].values as Record<string, { query: string }>)[v]!.query);
  }
  parts.push("sort:updated-desc");
  return parts.join(" ");
}

/** The filters set beyond the default (open). */
export const filtersSet = (f: RepoFilters) => FILTER_FIELDS.some((field) => field !== "state" && f[field]) || f.state !== "open";

/** A filter's value in words. */
export const filterText = (field: FilterField, value: string) => (FILTERS[field].values as Record<string, { text: string }>)[value]?.text ?? value;
