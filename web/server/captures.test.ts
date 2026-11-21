import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { captureMessage, capturesDir, capturesGet, clock, listCaptures, readManifest, sendCapture } from "./captures";

const ID = "cap-20261120-181341";
// The smallest PNG: what the app's contact sheet stands in for.
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const dir = () => join(capturesDir(), ID);

function bundle(manifest: Record<string, unknown> = {}, id = ID) {
  const d = join(capturesDir(), id);
  mkdirSync(join(d, "frames"), { recursive: true });
  writeFileSync(join(d, "contact-sheet.png"), PNG);
  writeFileSync(
    join(d, "capture.json"),
    JSON.stringify({
      id,
      created: "2026-11-20T18:13:41Z",
      duration: 33.4,
      app: "Safari",
      width: 2560,
      height: 1662,
      frames: [
        { n: 1, t: 4.2, file: "frames/frame-01.png", reasons: ["clicked"] },
        { n: 2, t: 7, file: "frames/frame-02.png", reasons: ["marked", "clicked"] },
        { n: 3, t: 33.3, file: "frames/frame-03.png", reasons: ["end"] },
      ],
      strokes: 1,
      clicks: 2,
      video: "recording.mp4",
      sheet: "contact-sheet.png",
      gif: "capture.gif",
      ...manifest,
    }),
  );
}

beforeEach(() => rmSync(capturesDir(), { recursive: true, force: true }));
afterEach(() => rmSync(capturesDir(), { recursive: true, force: true }));

test("a bundle's manifest is read field by field, never naming a file outside it", () => {
  bundle({
    frames: [
      { n: 1, t: 1, file: "frames/frame-01.png", reasons: ["marked", "rm -rf"] },
      { n: 2, t: 2, file: "../../secrets.json", reasons: [] },
      { n: 0, t: 2, file: "frames/frame-02.png", reasons: [] },
    ],
    sheet: "../secrets.json",
    video: "/etc/passwd",
  });
  const m = readManifest(ID)!;
  assert.deepEqual(m.frames, [{ n: 1, t: 1, file: "frames/frame-01.png", reasons: ["marked"] }]);
  assert.equal(m.sheet, "contact-sheet.png");
  assert.equal(m.video, "recording.mp4");
  // The GIF is named only once it's on disk.
  assert.equal(m.gif, undefined);
  writeFileSync(join(dir(), "capture.gif"), "GIF89a");
  assert.equal(readManifest(ID)!.gif, "capture.gif");
  assert.throws(() => readManifest("../cap-20261120-181341"), /Unknown capture/);
  assert.throws(() => readManifest("cap-1"), /Unknown capture/);
});

test("captures are listed newest first", () => {
  bundle({}, "cap-20261120-181341");
  bundle({}, "cap-20261121-090000");
  bundle({}, "cap-20261121-090000-2");
  mkdirSync(join(capturesDir(), "not-a-capture"));
  assert.deepEqual(
    listCaptures().map((c) => c.id),
    ["cap-20261121-090000-2", "cap-20261121-090000", "cap-20261120-181341"],
  );
});

test("an agent on this Mac reads the bundle's paths and how to cut frames; one elsewhere only the keyframes", () => {
  bundle();
  writeFileSync(join(dir(), "capture.gif"), "GIF89a");
  const m = readManifest(ID)!;
  const local = captureMessage(m, "  The menu jumps here. ", dir(), true);
  assert.match(local, /^The menu jumps here\.\n\n\[Screen capture 0:33 · Safari · .*cap-20261120-181341\]\n/);
  assert.match(local, /^- #1 \(0:04\) clicked$/m);
  assert.match(local, /^- #2 \(0:07\) marked, clicked$/m);
  assert.match(local, /^- #3 \(0:33\) last frame$/m);
  assert.ok(local.includes(`Video: ${join(dir(), "recording.mp4")} · GIF: ${join(dir(), "capture.gif")}`));
  assert.ok(local.includes(`ffmpeg -loglevel error -ss 6 -t 2 -i "${join(dir(), "recording.mp4")}"`));
  const remote = captureMessage(m, "", dir(), false);
  assert.match(remote, /^\[Screen capture 0:33 · Safari\]\n/);
  assert.ok(!remote.includes(capturesDir()));
  assert.match(remote, /stay on the Mac that recorded them/);
  assert.equal(clock(3725), "1:02:05");
});

test("sending goes through the agent's send with the contact sheet, on the agent's own host", async () => {
  bundle();
  const sent: [string, Record<string, unknown>][] = [];
  const send = async (agent: string, body: Record<string, unknown>) => {
    sent.push([agent, body]);
    return { ok: true };
  };
  await sendCapture(ID, { agent: "agent-1", message: "Fix this", behavior: "steer" }, send);
  await sendCapture(ID, { agent: "remote:srv_box:agent-2", message: "" }, send);
  assert.equal(sent[0][0], "agent-1");
  assert.equal(sent[0][1].host, undefined);
  assert.equal(sent[0][1].behavior, "steer");
  assert.match(String(sent[0][1].prompt), /^Fix this\n\n\[Screen capture .*cap-20261120-181341\]/);
  assert.deepEqual(sent[0][1].images, [{ data: PNG.toString("base64"), mimeType: "image/png" }]);
  assert.equal(sent[1][0], "agent-2");
  assert.equal(sent[1][1].host, "srv_box");
  assert.ok(!String(sent[1][1].prompt).includes(capturesDir()));
  await assert.rejects(sendCapture(ID, { message: "x" }, send), /Choose an agent/);
  // Only the daemon's behaviours pass (the composer's "queue" is the page's own).
  await sendCapture(ID, { agent: "a", behavior: "queue" }, send);
  assert.equal(sent.at(-1)![1].behavior, undefined);
  await assert.rejects(sendCapture(ID, { agent: "a", message: "x\0" }, send), /Invalid message/);
});

function response() {
  const r = { status: 0, type: "", body: undefined as unknown, bytes: undefined as unknown };
  const res = {
    set statusCode(v: number) {
      r.status = v;
    },
    setHeader(name: string, value: string) {
      if (name === "Content-Type") r.type = value;
    },
    end(bytes: unknown) {
      r.bytes = bytes;
    },
  } as unknown as ServerResponse;
  const reply = (status: number, body: unknown) => {
    r.status = status;
    r.body = body;
  };
  return { r, res, reply };
}

test("the GETs: the list, a manifest, the sheet's PNG and a new agent's draft", () => {
  bundle();
  const get = (path: string) => {
    const x = response();
    capturesGet(new URL(`http://127.0.0.1${path}`), x.res, x.reply);
    return x.r;
  };
  assert.equal((get("/api/captures").body as { captures: unknown[] }).captures.length, 1);
  assert.equal((get(`/api/captures/${ID}`).body as { app: string }).app, "Safari");
  const sheet = get(`/api/captures/${ID}/sheet`);
  assert.equal(sheet.status, 200);
  assert.equal(sheet.type, "image/png");
  assert.deepEqual(sheet.bytes, PNG);
  const draft = get(`/api/captures/${ID}/draft?message=Look&host=srv_box`).body as { prompt: string; image: { name: string } };
  assert.match(draft.prompt, /^Look\n\n\[Screen capture 0:33 · Safari\]/);
  assert.equal(draft.image.name, "contact-sheet.png");
  assert.match((get(`/api/captures/${ID}/draft?message=Look`).body as { prompt: string }).prompt, /Video: /);
  assert.equal(get("/api/captures/cap-20261120-000000").status, 404);
  assert.equal(get("/api/captures/..%2Fsecrets").status, 400);
  assert.equal(get(`/api/captures/${ID}/frames`).status, 404);
});
