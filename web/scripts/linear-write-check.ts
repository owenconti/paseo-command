/**
 * Checks the server's whitelisted Linear writes against the real Linear, by
 * hand: `cd web && PASEO_COMMAND_DATA=<the app's data folder> npx tsx
 * scripts/linear-write-check.ts`. It reads the key as the app does
 * (`integrationKey("linear")`): Linear enabled in settings.json and
 * `linearApiKey` in that data folder's secrets.json; never the environment. It writes to one issue only, in team DE,
 * titled exactly `Paseo Command write check (safe to delete)`: it creates that
 * issue (unassigned, in Backlog) if there is none, and refuses any issue whose
 * title or team differs. Every write goes through `linearWrite`, as the page's
 * do; each prints `ok` or `FAIL`, and the first failure stops the run (after
 * one attempt to put the issue back). Edits are put back; the subscription is
 * left as the last step leaves it, and the issue's notifications (if any) read
 * and not snoozed; none is archived. A link and a small text file are
 * attached and removed again (the file stays in Linear's storage, unlinked).
 * Tests never run this.
 */
import { LinearError, linearApiKey, linearBudget, linearRequest, linearUnavailable } from "../server/linear/client";
import { readIssue, readWorkspace } from "../server/linear/reads";
import { uploadToLinear } from "../server/linear/upload";
import { linearWrite } from "../server/linear/writes";
import type { LinearComment, LinearIssue, WriteName } from "../src/linear/types";

const TEAM_KEY = "DE";
const TITLE = "Paseo Command write check (safe to delete)";

const FIND = `query WriteCheckFind($team: String!, $title: String!) {
  issues(first: 5, filter: { team: { key: { eq: $team } }, title: { eq: $title } }) {
    nodes { id identifier title team { key } }
  }
}`;

class Stop extends Error {}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Refuses an issue that isn't the check issue. */
function mustBeCheckIssue(issue: { title: string }, teamId: string, checkTeamId: string): void {
  if (issue.title !== TITLE || teamId !== checkTeamId)
    throw new Stop(`Refusing to write to "${issue.title}": only "${TITLE}" in ${TEAM_KEY} is written to.`);
}

async function main() {
  if (!linearApiKey()) throw new Stop(`No Linear API key: ${linearUnavailable()}`);
  const ws = await readWorkspace(true);
  const team = ws.teams.find((t) => t.key === TEAM_KEY);
  if (!team) throw new Stop(`No team ${TEAM_KEY} in this workspace.`);

  /** Runs one write and prints its result; a failure stops the run. */
  const step = async (label: string, name: WriteName, input: Record<string, unknown>) => {
    try {
      const result = await linearWrite(name, input);
      const what = result.issue
        ? `${result.issue.key} updated ${result.issue.updatedAt}`
        : result.comment
          ? `comment ${result.comment.id}`
          : result.notifications
            ? `${result.notifications.length} notification(s)`
            : result.attachment
              ? `attachment ${result.attachment.id}`
              : "success";
      console.log(`ok    ${label}: ${what}`);
      return result;
    } catch (e) {
      const kind = e instanceof LinearError ? ` (${e.kind})` : "";
      console.log(`FAIL  ${label}${kind}: ${message(e)}`);
      throw new Stop(`${label} failed`);
    }
  };

  // The check issue: found, or made (the only issue this ever creates).
  const found = await linearRequest<{ issues: { nodes: { id: string; identifier: string; title: string; team: { key: string } }[] } }>(
    "WriteCheckFind",
    FIND,
    { team: TEAM_KEY, title: TITLE },
  );
  const match = found.issues.nodes.find((n) => n.title === TITLE && n.team.key === TEAM_KEY);
  let issueId = match?.id;
  if (match) console.log(`found ${match.identifier}: ${TITLE}`);
  else {
    const backlog = ws.states
      .filter((s) => s.teamId === team.id && s.type === "backlog")
      .sort((a, b) => a.position - b.position)[0];
    if (!backlog) throw new Stop(`${TEAM_KEY} has no Backlog status.`);
    const made = await step("issueCreate", "issueCreate", {
      teamId: team.id,
      title: TITLE,
      stateId: backlog.id,
      assigneeId: null,
    });
    issueId = made.issue!.id;
  }

  const read = async () => {
    const got = await readIssue(issueId!);
    if (!got) throw new Stop("The check issue is gone.");
    mustBeCheckIssue(got.issue, got.issue.teamId, team.id);
    return got;
  };
  const start = (await read()).issue;
  const before = { priority: start.priority, estimate: start.estimate, dueDate: start.dueDate, labelIds: start.labelIds };
  console.log(`start ${start.key}: ${JSON.stringify(before)}`);

  /** An issueUpdate, only on the check issue (as Linear answers it after each write). */
  let current: LinearIssue = start;
  const update = async (label: string, change: Record<string, unknown>) => {
    mustBeCheckIssue(current, current.teamId, team.id);
    const { issue } = await step(label, "issueUpdate", { id: current.id, ...change });
    current = issue!;
    mustBeCheckIssue(current, current.teamId, team.id);
  };
  const restore = () =>
    update("issueUpdate (put back)", {
      priority: before.priority,
      estimate: before.estimate ?? null,
      dueDate: before.dueDate ?? null,
      labelIds: before.labelIds,
    });

  let comment: LinearComment | undefined;
  try {
    await update("issueUpdate priority", { priority: before.priority === 3 ? 2 : 3 });
    const estimate = team.estimates.find((n) => n !== before.estimate && n > 0);
    if (estimate !== undefined) await update("issueUpdate estimate", { estimate });
    else console.log(`skip  issueUpdate estimate: ${TEAM_KEY} doesn't use estimates`);
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await update("issueUpdate dueDate", { dueDate: due === before.dueDate ? null : due });
    const label =
      ws.labels.find((l) => l.teamId === team.id && !before.labelIds.includes(l.id)) ??
      ws.labels.find((l) => !l.teamId && !before.labelIds.includes(l.id));
    if (label) {
      await update(`issueUpdate label add (${label.name})`, { labelIds: [...before.labelIds, label.id] });
      await update(`issueUpdate label remove (${label.name})`, { labelIds: before.labelIds });
    } else console.log(`skip  issueUpdate labels: no label for ${TEAM_KEY} to add`);
    await restore();

    // A comment of its own, with a reaction (by shortcode), resolved and unresolved, then deleted.
    comment = (await step("commentCreate", "commentCreate", { issueId: current.id, body: "Write check: a comment." }))
      .comment!;
    if (comment.issueId !== current.id) throw new Stop("The comment isn't on the check issue.");
    await step("commentUpdate", "commentUpdate", { id: comment.id, body: "Write check: an edited comment." });
    await step("reactionCreate", "reactionCreate", { commentId: comment.id, emoji: "+1" });
    const mine = (await read()).comments
      .find((c) => c.id === comment!.id)
      ?.reactions.flatMap((r) => r.ids.filter((_, n) => r.userIds[n] === ws.viewerId));
    if (!mine?.length) {
      console.log("FAIL  reactionDelete: the reaction isn't on the comment");
      throw new Stop("reaction not found");
    }
    await step("reactionDelete", "reactionDelete", { id: mine[0] });
    await step("commentResolve", "commentResolve", { id: comment.id });
    await step("commentUnresolve", "commentUnresolve", { id: comment.id });
    await step("commentDelete", "commentDelete", { id: comment.id });
    comment = undefined;

    await step("issueSubscribe", "issueSubscribe", { id: current.id });
    await step("issueUnsubscribe", "issueUnsubscribe", { id: current.id });

    // A link and an uploaded file attached to the check issue, then removed.
    const linked = await step("attachmentLinkURL", "attachmentLinkURL", {
      issueId: current.id,
      url: "https://example.com/paseo-command-write-check",
      title: "Write check link",
    });
    await step("attachmentDelete (link)", "attachmentDelete", { id: linked.attachment!.id });
    const uploaded = await uploadToLinear(Buffer.from("Paseo Command write check."), "write-check.txt", "text/plain");
    console.log(`ok    fileUpload: ${uploaded.url}`);
    const filed = await step("attachmentCreate", "attachmentCreate", {
      issueId: current.id,
      url: uploaded.url,
      title: uploaded.name,
      subtitle: "TXT",
    });
    await step("attachmentDelete (file)", "attachmentDelete", { id: filed.attachment!.id });

    // The Inbox's writes, on the check issue's notifications only (there may be none: Linear answers the same).
    const now = new Date().toISOString();
    await step("notificationMarkReadAll", "notificationMarkReadAll", { issueId: current.id, readAt: now });
    await step("notificationMarkUnreadAll", "notificationMarkUnreadAll", { issueId: current.id });
    await step("notificationSnoozeAll", "notificationSnoozeAll", {
      issueId: current.id,
      snoozedUntilAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await step("notificationUnsnoozeAll", "notificationUnsnoozeAll", { issueId: current.id, unsnoozedAt: now });
    await step("notificationMarkReadAll (put back)", "notificationMarkReadAll", { issueId: current.id, readAt: now });
  } catch (e) {
    // One attempt to leave the issue as it was, then stop.
    if (comment) await linearWrite("commentDelete", { id: comment.id }).catch(() => {});
    await restore().catch(() => {});
    throw e;
  }

  const end = (await read()).issue;
  const after = { priority: end.priority, estimate: end.estimate, dueDate: end.dueDate, labelIds: end.labelIds };
  const same =
    after.priority === before.priority &&
    after.estimate === before.estimate &&
    after.dueDate === before.dueDate &&
    [...after.labelIds].sort().join() === [...before.labelIds].sort().join();
  console.log(`${same ? "ok   " : "FAIL "} back to its starting values: ${JSON.stringify(after)}`);
  const budget = linearBudget();
  if (budget) console.log(`budget left: ${budget.requestsRemaining} requests, ${budget.complexityRemaining} complexity`);
  if (!same) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Stop ? `stopped: ${e.message}` : `stopped: ${message(e)}`);
  process.exitCode = 1;
});
