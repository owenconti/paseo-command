import type { PrTab } from "./place";
import type { ChangesMode, PrScope } from "./types";

/** The GitHub tab's names for its places, shared with ⌘K (which mustn't load the tab itself). */
export const TAB_LABEL: Record<PrTab, string> = {
  conversation: "Conversation",
  files: "Files changed",
  commits: "Commits",
  checks: "Checks",
};
export const SCOPE_TITLE: Record<PrScope, string> = {
  review: "Review requests",
  mine: "Your pull requests",
  involved: "Involving you",
};
export const MODE_LABEL: Record<ChangesMode, string> = { all: "All changes", base: "Committed", uncommitted: "Uncommitted" };
