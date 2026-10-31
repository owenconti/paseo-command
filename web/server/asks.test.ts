import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createAsksService, judgeReply, type Judge } from "./asks";
import { writeSettings } from "./settings";
beforeEach(() => writeSettings({ integrations: { typesafe: true } }));
import { parseAnswers } from "./askAnswers";

const REPLY =
  "I've updated the cache layer. Should the cache be per-host or global? Keep the old /v1 endpoint for now? Let me know which file you meant.";

/** Says yes to questions about sentences ending in "?" or "Let me know". */
const fake = (calls: unknown[] = []): Judge => async (req) => {
  calls.push(req);
  const state = req.state as { sentences?: string[]; picks?: string[] };
  const answers: Record<string, { noul?: number; choice?: string }> = {};
  for (const name of Object.keys(req.questions)) {
    const i = Number(name.split("_")[1]);
    const s = state.sentences?.[i] ?? "";
    if (name === "waiting") answers[name] = { noul: 0.9 };
    else if (name.startsWith("ask_"))
      answers[name] = { noul: /\?$|^Let me know/.test(s) ? 0.92 : 0.05 };
    else if (name.startsWith("kind_"))
      answers[name] = { choice: / or /.test(s) ? "pick" : /\?$/.test(s) ? "yes_no" : "open" };
    else if (name.startsWith("options_")) answers[name] = { choice: "r0" };
  }
  return { answers };
};

test("a reply's questions, their kinds and a pick's options", async () => {
  const calls: unknown[] = [];
  const asks = await judgeReply(fake(calls), REPLY);
  assert.equal(asks.waiting, true);
  assert.deepEqual(asks.questions, [
    { text: "Should the cache be per-host or global?", kind: "pick", options: ["per-host", "global"] },
    { text: "Keep the old /v1 endpoint for now?", kind: "yes_no" },
    { text: "Let me know which file you meant.", kind: "open" },
  ]);
  // One request for the sentences, one for the pick's options.
  assert.equal(calls.length, 2);
  // The statement was never put to Jev.
  const asked = Object.keys((calls[0] as { questions: object }).questions);
  assert.ok(!asked.includes("ask_0"));
});

test("a statement leading into a question isn't offered as one, however Jev reads it", async () => {
  const yes: Judge = async (req) => ({
    answers: Object.fromEntries(
      Object.keys(req.questions).map((n) => [n, n.startsWith("kind_") ? { choice: "yes_no" } : { noul: 0.95 }]),
    ),
  });
  const asks = await judgeReply(
    yes,
    "That work touches the same files as the open PR #3, and its Sentry check is still waiting on it. Can you merge PR #3 first?",
  );
  assert.deepEqual(asks.questions.map((q) => q.text), ["Can you merge PR #3 first?"]);
});

const record = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  status: "idle",
  updatedAt: "t1",
  lastUserMessageAt: "u1",
  ...over,
});
const daemon = (items: { type: string; text: string; messageId?: string }[]) => {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    async fetchAgentTimeline() {
      reads++;
      return { entries: items.map((item, i) => ({ seqStart: i + 1, seqEnd: i + 1, item })) };
    },
  };
};
const settle = () => new Promise((r) => setTimeout(r, 10));

test("judged once per turn; pending first, then the questions", async () => {
  const calls: unknown[] = [];
  const service = createAsksService(() => fake(calls));
  const client = daemon([
    { type: "user_message", text: "Cache it" },
    { type: "assistant_message", text: REPLY, messageId: "m1" },
  ]);
  const first = service.request(client as never, "local", record() as never);
  assert.equal(first.pending, true);
  await settle();
  const done = service.request(client as never, "local", record() as never);
  assert.equal(done.pending, false);
  assert.equal(done.messageId, "m1");
  assert.equal(done.questions.length, 3);
  assert.equal(client.reads, 1);
  // A new turn with the same reply re-reads but isn't judged again.
  service.request(client as never, "local", record({ updatedAt: "t2" }) as never);
  await settle();
  assert.equal(client.reads, 2);
  assert.equal(calls.length, 2);
});

test("nothing when the user wrote last, the agent runs, or there's no key", async () => {
  const service = createAsksService(() => fake());
  const client = daemon([
    { type: "assistant_message", text: REPLY },
    { type: "user_message", text: "Per host." },
  ]);
  service.request(client as never, "local", record() as never);
  await settle();
  assert.deepEqual(service.request(client as never, "local", record() as never).questions, []);
  assert.equal(service.request(client as never, "local", record({ status: "running" }) as never).pending, false);
  const keyless = createAsksService(() => undefined);
  assert.match(keyless.request(client as never, "local", record() as never).error!, /typesafeApiKey.*secrets.json/);
  assert.equal(keyless.status().available, false);
});

test("a refused key stops judging and says why", async () => {
  let calls = 0;
  const service = createAsksService(() => async () => {
    calls++;
    throw Object.assign(new Error("403"), { status: 403 });
  });
  const client = daemon([{ type: "assistant_message", text: REPLY }]);
  service.request(client as never, "local", record() as never);
  await settle();
  assert.match(service.request(client as never, "local", record({ id: "a2" }) as never).error!, /refused/);
  assert.equal(calls, 1);
  assert.equal(service.status().available, false);
});

/** The fake's answers, with `suggest` chosen as `pick` at `p`. */
const suggesting = (pick: string, p: number, calls: unknown[] = []): Judge => async (req) => {
  const { answers } = await fake(calls)(req);
  if (req.questions.suggest) answers.suggest = { choice: pick, probabilities: { [pick]: p } } as never;
  return { answers };
};

test("an obvious next reply is suggested, its PR filled from the reply", async () => {
  const calls: { questions: Record<string, { criteria: Record<string, string> }> }[] = [];
  const asks = await judgeReply(
    suggesting("merged_pr", 0.93, calls),
    "The migration is ready. Once PR #3 is merged, I will continue.",
  );
  assert.equal(asks.suggestion, "Okay, I've merged PR #3.");
  // Asked in the same request as the questions.
  assert.equal(calls.length, 1);
  assert.match(calls[0].questions.suggest.criteria.merged_pr, /PR #3/);
});

test("no suggestion when Jev isn't sure, or the reply asks for the user's own answer", async () => {
  const unsure = await judgeReply(suggesting("go_ahead", 0.6), "I could rename the module next.");
  assert.equal(unsure.suggestion, undefined);
  const own = await judgeReply(suggesting("go_ahead", 0.95), REPLY);
  assert.equal(own.suggestion, undefined);
  const none = await judgeReply(suggesting("none", 0.99), "I renamed the module.");
  assert.equal(none.suggestion, undefined);
});

test("a PR template is only offered when the reply names one PR", async () => {
  const calls: { questions: Record<string, { criteria: Record<string, string> }> }[] = [];
  await judgeReply(fake(calls), "PR #3 and PR #4 both touch this. I'll wait.");
  assert.ok(!("merged_pr" in calls[0].questions.suggest.criteria));
  const asks = await judgeReply(suggesting("merged_pr", 0.95), "I'll wait for the merge.");
  assert.equal(asks.suggestion, undefined);
});

test("open questions show at once, then with answers drafted for them", async () => {
  let release!: () => void;
  const drafted: string[][] = [];
  const service = createAsksService(() => fake(), Date.now, async (_c, _s, _r, questions) => {
    drafted.push(questions);
    await new Promise<void>((r) => (release = r));
    return [["src/cache.ts", "The one you just edited."]];
  });
  const client = daemon([{ type: "assistant_message", text: REPLY, messageId: "m1" }]);
  service.request(client as never, "local", record() as never);
  await settle();
  const first = service.request(client as never, "local", record() as never);
  assert.equal(first.answering, true);
  assert.equal(first.questions.length, 3);
  // Only the open question is drafted for.
  assert.deepEqual(drafted, [["Let me know which file you meant."]]);
  release();
  await settle();
  const done = service.request(client as never, "local", record() as never);
  assert.equal(done.answering, undefined);
  assert.deepEqual(done.questions[2].answers, ["src/cache.ts", "The one you just edited."]);
  assert.equal(done.questions[0].answers, undefined);
});

test("drafted answers are read from the helper's JSON, one list per question", () => {
  assert.deepEqual(
    parseAnswers('Sure:\n{"answers": [["Yes, only my files.", "  Commit   all of it. "], [], ["x", 3, "<b>"]]}', 3),
    [["Yes, only my files.", "Commit all of it."], [], ["x"]],
  );
  assert.deepEqual(parseAnswers('{"answers": [["a", "b", "c", "d"]]}', 2), [["a", "b", "c"], []]);
  assert.throws(() => parseAnswers("I can't help with that.", 1));
});
