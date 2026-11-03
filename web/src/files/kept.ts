import { readTabs, type TabsState } from "./tabs";

/**
 * What the Files page keeps per workspace (host and workspace) in localStorage's
 * `files:workspaces`: its open folders, its tabs (each with its scroll), the
 * closed ones for ⇧⌘T, the recently opened files for ⌘P and whether its
 * Changes show in the tabs' place. Pure, over the stored object, so the tests run it.
 */
export type Kept = { open: string[]; recent: string[]; tabs: TabsState; changes?: boolean };
export type KeptWorkspace = { id: string; host?: string };
/** At most this many workspaces are kept (the least recently written go). */
export const KEPT_WORKSPACES = 40;
export const RECENT = 12;

export const keptKey = (ws: KeptWorkspace) => `${ws.host ?? ""}|${ws.id}`;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : []);

export function readKept(all: unknown, ws: KeptWorkspace): Kept {
  const k = all && typeof all === "object" ? (all as Record<string, Record<string, unknown> | undefined>)[keptKey(ws)] : undefined;
  return {
    open: strings(k?.open),
    recent: strings(k?.recent).slice(0, RECENT),
    // `file` is the shown tab (before tabs, the one open file).
    tabs: readTabs(k, typeof k?.file === "string" ? k.file : undefined),
    ...(k?.changes === true ? { changes: true } : {}),
  };
}

/** The stored object with `ws`'s kept state written (last, so it's the most recent). */
export function writeKept(all: unknown, ws: KeptWorkspace, kept: Kept): Record<string, unknown> {
  const { [keptKey(ws)]: _, ...rest } = all && typeof all === "object" ? (all as Record<string, unknown>) : {};
  const { tabs, active, closed } = kept.tabs;
  const stored = { open: kept.open, ...(active ? { file: active } : {}), tabs, closed, recent: kept.recent, ...(kept.changes ? { changes: true } : {}) };
  return Object.fromEntries([...Object.entries(rest), [keptKey(ws), stored] as const].slice(-KEPT_WORKSPACES));
}
