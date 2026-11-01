/** What a key does in the Linear tab, as in Linear. */
export type LinearKey =
  | "down"
  | "up"
  | "open"
  | "back"
  | "create"
  | "status"
  | "priority"
  | "assign"
  | "assignMe"
  | "labels"
  | "project"
  | "cycle"
  | "copyBranch"
  | "copyLink"
  | "filter"
  | "filterBy";

/** The single keys, pressed without a modifier. */
const PLAIN: Record<string, LinearKey> = {
  j: "down",
  arrowdown: "down",
  k: "up",
  arrowup: "up",
  enter: "open",
  o: "open",
  escape: "back",
  c: "create",
  s: "status",
  p: "priority",
  a: "assign",
  i: "assignMe",
  l: "labels",
  m: "project",
  "/": "filter",
  f: "filterBy",
};

type Target = { tagName?: string; isContentEditable?: boolean } | null;
const typing = (target: Target) =>
  !!target && (target.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? ""));

/**
 * The Linear tab's key for a keydown: j/↓ and k/↑ move through the list,
 * Enter or O opens, Esc goes back, C creates, S, P, A, L, M and ⇧C open the
 * open issue's status, priority, assignee, labels, project and cycle pickers,
 * I assigns it to you, ⌘. and ⌘⇧, copy its branch name and link, / (or ⌘F,
 * even while typing) searches the list and F opens its Filter menu. Null while typing (an input, a textarea, a select, anything
 * editable) and for every other key, ⌘S included (the view's sidebar toggle).
 */
export function linearKeyAction(e: {
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: Target;
}): LinearKey | null {
  if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "f") return "filter";
  if (typing(e.target) || e.ctrlKey || e.altKey) return null;
  if (e.metaKey) {
    if (!e.shiftKey && e.key === ".") return "copyBranch";
    // ⇧ turns , into < on most layouts.
    if (e.shiftKey && (e.key === "," || e.key === "<")) return "copyLink";
    return null;
  }
  if (e.shiftKey) return e.key === "C" ? "cycle" : null;
  return PLAIN[e.key.toLowerCase()] ?? null;
}
