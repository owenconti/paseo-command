/**
 * Reply forks' record, in a small file in this app's data directory
 * (`forks.json`), and the words a fork is started and concluded with. A
 * fork is a helper agent that knows the main conversation up to a reply;
 * the record keeps which helper, what was highlighted and asked, and
 * whether it was closed or sent back.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  FORK_LABEL,
  nextColour,
  type Boundary,
  type Fork,
  type Quote,
} from "../src/forks/types";
import { agentSnapshot, type AgentRecord } from "./api/agents";
import { timed, type DaemonClient, type Remote } from "./api/hosts";
import { MAX_PROMPT } from "./api/validate";
import { TUNING } from "./fleet";
import { redactText } from "./redact";
import { dataDir } from "./subagentArchive";

export const forksFile = () => join(dataDir(), "forks.json");

/** Every fork. No file: none. A damaged one throws rather than be
 *  overwritten (it holds the forks' history). */
function read(): Fork[] {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(forksFile(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("The forks record (forks.json) can't be read.");
  }
  return Array.isArray(raw?.forks) ? raw.forks : [];
}

function write(forks: Fork[]) {
  const file = forksFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ forks }) + "\n");
  renameSync(tmp, file);
}

/** One agent's forks, newest first. */
export function listForks(host: string | null, agentId: string): Fork[] {
  return read()
    .filter((f) => (f.host ?? null) === host && f.agentId === agentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const getFork = (id: string): Fork | undefined =>
  read().find((f) => f.id === id);

/** Insert, or replace the fork with the same id. */
export function saveFork(fork: Fork): Fork {
  write([...read().filter((f) => f.id !== fork.id), fork]);
  return fork;
}

const quoted = (quotes: Quote[]) =>
  quotes
    .map((q) =>
      q.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    )
    .join("\n\n");

/** The helper's first prompt: the highlighted pieces, then the question. */
export const firstPrompt = (quotes: Quote[], question: string) =>
  "This is a short side conversation forked from the conversation above. The user highlighted these parts of your reply:\n\n" +
  `${quoted(quotes)}\n\nTheir question: ${question}`;

export const CONCLUDE_PROMPT =
  "In a few sentences, state what this side conversation concluded, written for the main conversation. Reply with the conclusion only.";

/** What the main agent receives when a fork is sent back. */
export const sendBackText = (quotes: Quote[], conclusion: string) =>
  `From a side conversation about:\n${quoted(quotes)}\n\n${conclusion.trim()}`;

// ── Operations, on a host's daemon ─────────────────────────────────────────

const MAX_QUOTES = 20;
const MAX_QUOTE = 4000;
export const UNSUPPORTED = "Forks aren't supported on this host.";

/** The fork record's host: what the page names it by (none: the local one). */
export const forkHost = (raw: unknown) =>
  typeof raw === "string" && raw ? raw : null;

/** Whether this host's daemon can hand a conversation to a fork; `cursor`:
 *  by timeline position, for a reply without a message id. */
export function forkSupport(client: DaemonClient) {
  const features = client.getLastServerInfoMessage?.()?.features;
  return {
    supported: features?.agentForkContext === true,
    cursor: features?.agentForkContextCursor === true,
  };
}

function validQuotes(raw: unknown): Quote[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_QUOTES)
    throw new Error("Choose up to 20 highlighted pieces.");
  return raw.map((q: any) => {
    if (
      typeof q?.text !== "string" ||
      !q.text.trim() ||
      q.text.length > MAX_QUOTE ||
      typeof q.replyKey !== "string" ||
      !Number.isInteger(q.start) ||
      !Number.isInteger(q.end) ||
      (q.messageId !== undefined && typeof q.messageId !== "string")
    )
      throw new Error("Invalid highlighted piece");
    return {
      ...(q.messageId ? { messageId: q.messageId } : {}),
      replyKey: q.replyKey,
      text: q.text,
      start: q.start,
      end: q.end,
    };
  });
}

function validBoundary(raw: any): Boundary {
  if (typeof raw?.messageId === "string" && raw.messageId)
    return { messageId: raw.messageId };
  if (Number.isInteger(raw?.seq) && raw.seq >= 0)
    return typeof raw.epoch === "string" && raw.epoch
      ? { epoch: raw.epoch, seq: raw.seq }
      : { seq: raw.seq };
  throw new Error("Invalid fork boundary");
}

/** `POST /api/agents/:id/forks`: a helper agent that knows the conversation
 *  up to the boundary, with the main agent's provider, model and mode, asked
 *  the question about the highlighted pieces. */
export async function createFork(
  client: DaemonClient,
  host: Remote | undefined,
  agentId: string,
  body: Record<string, any>,
): Promise<Fork> {
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > MAX_PROMPT || question.includes("\0"))
    throw new Error("Ask a question for the fork.");
  const quotes = validQuotes(body.quotes);
  const boundary = validBoundary(body.boundary);
  const support = forkSupport(client);
  if (!support.supported || (!boundary.messageId && !support.cursor))
    throw new Error(UNSUPPORTED);
  const main = await agentSnapshot(client, agentId, host);
  if (!main.workspaceId || !main.cwd)
    throw new Error("This agent has no workspace for a fork.");
  // A position without its epoch (the page doesn't hold one) is in the
  // conversation's current epoch.
  const epoch =
    boundary.messageId || boundary.epoch
      ? boundary.epoch
      : (
          await timed(
            client.fetchAgentTimeline(agentId, { direction: "tail", limit: 1 }),
            undefined,
            client,
          )
        )?.epoch;
  if (!boundary.messageId && !epoch)
    throw new Error("Couldn't read the conversation for the fork.");
  const context = await timed(
    client.buildAgentForkContext(
      agentId,
      boundary.messageId
        ? { boundaryMessageId: boundary.messageId }
        : { boundaryCursor: { epoch: epoch!, seq: boundary.seq! } },
    ),
    TUNING.writeMs,
  );
  if (!context?.attachment)
    throw new Error(
      redactText(String(context?.error || "Couldn't read the conversation for the fork.")),
    );
  const hostName = forkHost(body.host);
  const id = `fork_${randomUUID()}`;
  const record = main as AgentRecord & Record<string, any>;
  const model: string | undefined =
    record.runtimeInfo?.model || record.model || undefined;
  const modeId: string | undefined =
    record.currentModeId || record.runtimeInfo?.modeId || undefined;
  const helper = await timed(
    client.createAgent({
      idempotencyKey: randomUUID(),
      provider: record.provider,
      cwd: main.cwd,
      workspaceId: main.workspaceId,
      callerAgentId: agentId,
      title: `Fork: ${question.slice(0, 60)}`,
      ...(model ? { model } : {}),
      ...(modeId ? { modeId } : {}),
      labels: { [FORK_LABEL]: id },
      attachments: [context.attachment],
      initialPrompt: firstPrompt(quotes, question),
    }),
    TUNING.writeMs,
  );
  if (!helper?.id) throw new Error("Couldn't start the fork.");
  return saveFork({
    id,
    host: hostName,
    agentId,
    helperId: helper.id,
    boundary,
    quotes,
    question,
    colour: nextColour(
      listForks(hostName, agentId)
        .filter((f) => !f.closedAt)
        .map((f) => f.colour),
    ),
    createdAt: new Date().toISOString(),
  });
}

/** `POST /api/forks/:id/conclude`: the fork's conclusion, as the message
 *  the main agent is sent. */
export async function concludeFork(client: DaemonClient, fork: Fork) {
  const helper = await timed(client.fetchAgent(fork.helperId), undefined, client);
  if (/running|starting|initializing/.test(String(helper?.agent?.status ?? "")))
    throw new Error("The fork is still answering.");
  await timed(client.sendMessage(fork.helperId, CONCLUDE_PROMPT), TUNING.writeMs);
  const result = await client.waitForFinish(fork.helperId, 120000);
  if (result.status !== "idle" || !result.lastMessage?.trim())
    throw new Error("The fork couldn't write a conclusion.");
  return { text: sendBackText(fork.quotes, result.lastMessage) };
}

/** A fork by id, or a refusal. */
export function forkOf(rawId: string) {
  const fork = getFork(rawId);
  if (!fork) throw new Error("No such fork.");
  return fork;
}

/** Close, reopen or mark a fork as sent back. */
export function markFork(fork: Fork, action: "close" | "reopen" | "sent") {
  const next = { ...fork };
  if (action === "close") next.closedAt = new Date().toISOString();
  if (action === "reopen") delete next.closedAt;
  if (action === "sent") next.sentBackAt = new Date().toISOString();
  return saveFork(next);
}

/** Best effort, when the main agent is archived: its forks' helpers go too. */
export async function archiveForkHelpers(
  client: DaemonClient,
  host: string | null,
  agentId: string,
) {
  for (const fork of listForks(host, agentId))
    await Promise.resolve()
      .then(() => client.cancelAgent(fork.helperId))
      .catch(() => {})
      .then(() => client.archiveAgent(fork.helperId))
      .catch(() => {});
}
