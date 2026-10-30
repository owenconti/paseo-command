/**
 * An agent's subagents: a provider subagent's conversation, read as the
 * Paseo app reads it when one is picked in its subagent dropdown
 * (`agent.provider_subagents.timeline.get.request`, the SDK's
 * `fetchProviderSubagentTimeline`), and "Archive finished subagents"
 * (server/subagentArchive.ts). A hidden daemon subagent is an agent of its
 * own: its conversation is read like any agent's (`agents/:id/timeline`).
 */
import { timelineWindow } from "../daemon";
import { rememberTimelineImages } from "../attachment";
import { feedOf } from "../live";
import {
  archiveFinishedSubagents,
  type ArchiveClient,
} from "../subagentArchive";
import { agentSnapshot } from "./agents";
import type { Changed } from "./commands";
import { hostKey, resolveHost, sdk, timed, type Remote } from "./hosts";
import { id } from "./validate";

/**
 * A provider subagent's conversation: the newest rows within the byte
 * budget, or (`before`, `epoch`) the page before a sequence. `owner` is the
 * daemon agent whose turn runs it, when that isn't `agentId` (one run by a
 * hidden daemon subagent of it).
 */
export async function subagentTimeline(
  agentId: string,
  subagentId: string,
  host: Remote | undefined,
  url: URL,
) {
  const client = await sdk(host);
  await agentSnapshot(client, agentId, host);
  const owner = url.searchParams.get("owner")
    ? id(url.searchParams.get("owner"))
    : agentId;
  const raw = url.searchParams.get("limit") ?? "300";
  if (!/^\d{1,3}$/.test(raw) || +raw < 1 || +raw > 600)
    throw new Error("Invalid limit");
  const before = url.searchParams.get("before");
  const epoch = url.searchParams.get("epoch");
  if (
    (before !== null || epoch !== null) &&
    (!before ||
      !/^\d{1,12}$/.test(before) ||
      !epoch ||
      epoch.length > 200 ||
      epoch.includes("\0"))
  )
    throw new Error("Invalid timeline cursor");
  const t = await timed(
    client.fetchProviderSubagentTimeline(owner, subagentId, {
      direction: before ? "before" : "tail",
      ...(before ? { cursor: { epoch: epoch!, seq: Number(before) } } : {}),
      limit: +raw,
    }),
    undefined,
    client,
  );
  if (t?.error) throw new Error(t.error);
  // Its rows are the same projected items an agent's timeline carries.
  const entries = (Array.isArray(t?.rows) ? t.rows : []).map((r) => ({
    ...r,
    seqStart: r.seqStart ?? r.seq,
    seqEnd: r.seqEnd ?? r.seq,
  }));
  const {
    page: _page,
    pageFrom: _pageFrom,
    ...win
  } = timelineWindow({ ...t, entries });
  rememberTimelineImages(win.items, !host);
  return win;
}

/**
 * Archive `agentId`'s finished subagents (never running ones). `dryRun`
 * lists what would be archived and changes nothing.
 */
export async function archiveSubagents(
  agentId: string,
  body: Record<string, unknown>,
  mark: (c: Changed) => void,
) {
  const host = await resolveHost(body.host, "write");
  const dryRun = body.dryRun === true;
  if (!dryRun && body.confirm !== true)
    throw new Error("Archive requires confirmation");
  const client = await sdk(host);
  if (!dryRun) mark({ host, keys: ["agents", "agents-unarchived"] });
  const report = await archiveFinishedSubagents({
    client: client as unknown as ArchiveClient,
    host: hostKey(host),
    parent: agentId,
    dryRun,
  });
  if (!dryRun) {
    for (const c of report.archived) feedOf(hostKey(host))?.exclude(c.id);
    feedOf(hostKey(host))?.republish();
  }
  return report;
}
