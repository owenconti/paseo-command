import { test } from "node:test";
import assert from "node:assert/strict";
import { createAsksService, judgeReply, type Judge } from "./asks";

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
  assert.match(keyless.request(client as never, "local", record() as never).error!, /TYPESAFE_API_KEY/);
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
