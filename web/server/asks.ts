/**
 * What an agent's last reply asks of the user, judged by TypeSafe's Jev
 * decision model: which of its sentences ask the user something, what kind
 * of answer each wants (and the options a pick names), and whether the reply
 * waits on the user. Code finds the sentences and options; Jev only judges.
 *
 * The key is TYPESAFE_API_KEY, else `typesafeApiKey` in the data
 * directory's secrets.json (the launched server has no shell environment).
 * Without one, nothing is judged. Each reply is judged once.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TypeSafeClient,
  type Questions,
  type SystemOneRequest,
} from "@typesafe-ai/sdk";
import type { DaemonClient } from "./api/hosts";
import { NO_ASKS, type AskKind, type Asks, type ReplyQuestion } from "../src/asks/types";
import { mayAsk, optionReadings, replySentences } from "../src/asks/sentences";
import { fillSuggestions, type SuggestionTemplate } from "../src/asks/suggestions";
import { FORK_LABEL } from "../src/forks/types";
import { fromTimeline } from "../src/transcript";
import { timelineWindow } from "./daemon";
import type { AgentRecord } from "./live/client";
import { dataDir } from "./subagentArchive";
import { SUMMARY_LABEL } from "./workingOn";
import { writeAnswers as helperAnswers, type WriteAnswers } from "./askAnswers";
import { errorText } from "./wire";

/** Yes at or above this; the docs' suggested starting point. */
export const ASKS_YES = 0.7;
/** A suggested reply sends in one click, so only a clear fit is offered. */
export const SUGGEST_YES = 0.85;
const PER_REQUEST = 20;
const RETRY_MS = 60_000;
const REFUSED_RETRY_MS = 10 * 60_000;

type Answers = Record<
  string,
  { noul?: number; choice?: string; probabilities?: Record<string, number> }
>;
/** One decision request: Jev's in use, a fake in tests. */
export type Judge = (req: SystemOneRequest<Questions>) => Promise<{ answers: Answers }>;

export function typesafeKey(): string | undefined {
  const env = process.env.TYPESAFE_API_KEY?.trim();
  if (env) return env;
  try {
    const secrets = JSON.parse(readFileSync(join(dataDir(), "secrets.json"), "utf8"));
    const key = secrets?.typesafeApiKey;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

let jev: { key: string; client: TypeSafeClient } | undefined;
const jevJudge = (key: string): Judge => {
  if (jev?.key !== key) jev = { key, client: new TypeSafeClient({ apiKey: key }) };
  const client = jev.client;
  return (req) =>
    client.systemOne(req, { timeout: 15000, retry: { maxRetries: 1 } }) as never;
};

const WAITING = {
  type: "noul",
  instructions:
    "Does `reply`, the coding agent's latest message, end its turn waiting on the user (for an answer, a decision, an approval or information) before it can carry on with the work?",
  criteria: {
    true: "It asks the user something it needs, or offers options to choose between, and stops until they reply.",
    false:
      "It reports the work as done or in progress and needs nothing more from the user; at most it mentions optional follow-ups.",
  },
} as const;
const asks = (i: number) =>
  ({
    type: "noul",
    instructions: `Is \`sentences[${i}]\`, read as part of the agent's message \`reply\`, a question or request the user is expected to answer: a decision, confirmation, choice or missing information?`,
    criteria: {
      true: "The user needs to reply to it, e.g. \"Should the cache be per-host or global?\" or \"Let me know which file you meant.\"",
      false:
        "A statement, even one giving the context or reason for a question next to it (\"That touches the same files as PR #3.\"); a heading; a rhetorical question; or a question the agent answers itself.",
    },
  }) as const;
const kind = (i: number) =>
  ({
    type: "choice",
    instructions: `What kind of answer does \`sentences[${i}]\` ask the user for?`,
    criteria: {
      yes_no: "Yes or no: to approve, confirm or decline one thing.",
      pick: "One of two to four alternatives that it names itself.",
      open: "Free-form information, or anything else.",
    },
  }) as const;

const suggest = (templates: SuggestionTemplate[]) =>
  ({
    type: "choice",
    instructions:
      "Which reply below would the user most plainly send next to `reply`, the coding agent's latest message, exactly as written? Choose none unless one directly follows from what the message says or waits for.",
    criteria: Object.fromEntries([
      ["none", "No reply below directly follows: the user would need to answer a question or say something of their own."],
      ...templates.map((t) => [t.id, `“${t.text}” ${t.when}`]),
    ]),
  }) as const;

/** Judge a reply's questions: one request per twenty sentences that may
 *  ask anything (`mayAsk`), then one more for the options of any picks. */
export async function judgeReply(judge: Judge, reply: string): Promise<Omit<Asks, "pending">> {
  const sentences = replySentences(reply);
  const state = { reply: reply.slice(-6000), sentences };
  const templates = fillSuggestions(reply);
  // Statements never ask; Jev judges only the sentences that might.
  const candidates = sentences.flatMap((s, i) => (mayAsk(s) ? [i] : []));
  const chunks: number[][] = [];
  for (let i = 0; i < candidates.length; i += PER_REQUEST)
    chunks.push(candidates.slice(i, i + PER_REQUEST));
  if (!chunks.length) chunks.push([]);
  const answers = Object.assign(
    {},
    ...(await Promise.all(
      chunks.map((idx, n) => {
        const questions: Questions = {};
        if (n === 0) {
          questions.waiting = WAITING;
          questions.suggest = suggest(templates);
        }
        for (const i of idx) {
          questions[`ask_${i}`] = asks(i);
          questions[`kind_${i}`] = kind(i);
        }
        return judge({ state, questions }).then((r) => r.answers);
      }),
    )),
  ) as Answers;
  const questions: ReplyQuestion[] = [];
  const picks: { q: ReplyQuestion; readings: string[][] }[] = [];
  sentences.forEach((text, i) => {
    if ((answers[`ask_${i}`]?.noul ?? 0) < ASKS_YES) return;
    const k = (answers[`kind_${i}`]?.choice ?? "open") as AskKind;
    const q: ReplyQuestion = { text, kind: k };
    questions.push(q);
    if (k === "pick") {
      const readings = optionReadings(text);
      if (readings.length) picks.push({ q, readings });
      else q.kind = "open";
    }
  });
  if (picks.length) {
    // Select among code's readings of the options rather than write them.
    const questions: Questions = {};
    picks.forEach(({ readings }, n) => {
      const criteria: Record<string, string> = { none: "None of these lists the alternatives exactly." };
      readings.forEach((r, j) => (criteria[`r${j}`] = r.map((o) => `“${o}”`).join(" / ")));
      questions[`options_${n}`] = {
        type: "choice",
        instructions: `Which list names exactly the alternatives that \`picks[${n}]\` asks the user to choose between, each in full and nothing more?`,
        criteria,
      };
    });
    const { answers: chosen } = await judge({
      state: { picks: picks.map((p) => p.q.text) },
      questions,
    });
    picks.forEach(({ q, readings }, n) => {
      const c = chosen[`options_${n}`]?.choice;
      const j = c && c !== "none" ? Number(c.slice(1)) : -1;
      if (readings[j]) q.options = readings[j];
      else q.kind = "open";
    });
  }
  const picked = answers.suggest?.choice;
  const template = templates.find((t) => t.id === picked);
  const sure = (answers.suggest?.probabilities?.[picked ?? ""] ?? 0) >= SUGGEST_YES;
  // A canned reply can't answer a pick or a question only the user can.
  const ownAnswer = questions.some((q) => q.kind !== "yes_no");
  const suggestion = template && sure && !ownAnswer ? template.text : undefined;
  return {
    waiting: (answers.waiting?.noul ?? 0) >= ASKS_YES,
    questions,
    ...(suggestion ? { suggestion } : {}),
  };
}

/** The newest reply since the user last wrote, if the agent's turn ended
 *  with one. */
export function lastReply(items: Parameters<typeof fromTimeline>[0]) {
  const entries = fromTimeline(items);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "user") return undefined;
    if (e.kind === "assistant" && e.text.trim())
      return { text: e.text, messageId: e.messageId };
  }
  return undefined;
}

type Entry = { turn: string; at: number; value: Asks };

/** Injectable for tests: the judge, when there's a key, the clock, and the
 *  writer of answers to open questions. */
export function createAsksService(
  judgeFor: () => Judge | undefined = () => {
    const key = typesafeKey();
    return key ? jevJudge(key) : undefined;
  },
  now = Date.now,
  writeAnswers: WriteAnswers = helperAnswers,
) {
  const cache = new Map<string, Entry>();
  /** Judged replies by their text, so a turn's re-read never asks again. */
  const judged = new Map<string, Omit<Asks, "pending">>();
  let refusedUntil = 0;
  let refusal = "";
  /** Judge the turn's reply, `publish` its questions, then draft answers to
   *  its open ones and publish those too. */
  async function judgeTurn(
    client: DaemonClient,
    source: AgentRecord,
    judge: Judge,
    publish: (value: Asks) => void,
  ) {
    const timeline = await client.fetchAgentTimeline(source.id, {
      direction: "tail",
      limit: 40,
      projection: "canonical",
    });
    const reply = lastReply(timelineWindow(timeline).items as never);
    if (!reply) return publish(NO_ASKS);
    const hash = createHash("sha256").update(reply.text).digest("hex");
    const remember = (value: Omit<Asks, "pending">) => {
      judged.set(hash, value);
      if (judged.size > 500) judged.delete(judged.keys().next().value!);
      publish({ ...value, messageId: reply.messageId, pending: false });
    };
    let value = judged.get(hash);
    if (!value) {
      value = await judgeReply(judge, reply.text);
      const open = value.questions.filter((q) => q.kind === "open");
      if (!open.length) return remember(value);
      // Its questions show at once; only the finished value is remembered.
      publish({ ...value, answering: true, messageId: reply.messageId, pending: false });
      const drafted = await writeAnswers(client, source, reply.text, open.map((q) => q.text)).catch(
        () => open.map(() => []),
      );
      value = {
        ...value,
        questions: value.questions.map((q) => {
          const answers = drafted[open.indexOf(q)];
          return answers?.length ? { ...q, answers } : q;
        }),
      };
    }
    remember(value);
  }
  return {
    /** Whether replies can be judged, and why not. */
    status(): { available: boolean; error?: string } {
      if (!judgeFor()) return { available: false, error: "No TypeSafe key: set TYPESAFE_API_KEY." };
      if (now() < refusedUntil) return { available: false, error: refusal };
      return { available: true };
    },
    request(client: DaemonClient, host: string, source: AgentRecord): Asks {
      if (
        source.status !== "idle" ||
        source.archivedAt ||
        source.archived ||
        source.internal ||
        source.labels?.[SUMMARY_LABEL] ||
        source.labels?.[FORK_LABEL]
      )
        return NO_ASKS;
      const judge = judgeFor();
      if (!judge) return { ...NO_ASKS, error: "No TypeSafe key: set TYPESAFE_API_KEY." };
      const key = `${host}|${source.id}`;
      const turn = `${source.updatedAt ?? ""}|${source.lastUserMessageAt ?? ""}`;
      const entry = cache.get(key);
      if (entry?.turn === turn && (entry.value.pending || !entry.value.error || now() - entry.at < RETRY_MS))
        return entry.value;
      if (now() < refusedUntil) return { ...NO_ASKS, error: refusal };
      for (const [k, v] of cache) if (now() - v.at > 6 * 3600_000) cache.delete(k);
      const next: Entry = {
        turn,
        at: now(),
        // Keep showing what was judged while the turn is read again.
        value: { ...(entry?.value ?? NO_ASKS), pending: true },
      };
      delete next.value.error;
      cache.set(key, next);
      void judgeTurn(client, source, judge, (value) => (next.value = value))
        .catch((e) => {
          const status = (e as { status?: number }).status;
          const error =
            status === 401 || status === 403
              ? "TypeSafe refused the key. Check TYPESAFE_API_KEY."
              : `Couldn't judge the reply: ${errorText(e)}`;
          if (status === 401 || status === 403) {
            refusedUntil = now() + REFUSED_RETRY_MS;
            refusal = error;
          }
          next.value = { ...NO_ASKS, error };
        })
        .finally(() => (next.at = now()));
      return next.value;
    },
  };
}
export const replyAsks = createAsksService();
