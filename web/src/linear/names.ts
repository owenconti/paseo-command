import type { LinearCycle } from "./types";

/** Names the Linear screens share, as Linear words them. */
export const PRIORITY_LABEL = ["No priority", "Urgent", "High", "Medium", "Low"];

/** "Cycle 7", or "Cycle 7 · Polish" when it has a name. */
export const cycleName = (c: Pick<LinearCycle, "number" | "name">) =>
  c.name ? `Cycle ${c.number} · ${c.name}` : `Cycle ${c.number}`;
