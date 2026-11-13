/**
 * A remote agent's images (a screenshot it took, named by absolute path in its transcript) load through that host's
 * daemon (server/remoteImage.ts), never this Mac's disk: only paths that host's own transcript gave, only real
 * raster images. Fake daemons only.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fleet, get, install, register } from "./fake-daemon";
import { rememberTimelineImages } from "./attachment";
import type { TimelineItem } from "../src/transcript";

const { network, local } = fleet();
const remote = register(local, network, "srv_remote", "10.0.0.9:6767");
let uninstall: () => void;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const reply = (text: string): TimelineItem => ({ kind: "assistant", id: "1", text });
const url = (path: string, host = "srv_remote") => `attachments/image?path=${encodeURIComponent(path)}${host ? `&host=${host}` : ""}`;

before(() => {
  uninstall = install(network);
  remote.trees.set(
    "/tmp/run 5/shots",
    new Map<string, string | Uint8Array | "dir" | "outside">([
      ["page.png", new Uint8Array(PNG)],
      ["fake.png", "not a png\n"],
      ["escape.png", "outside"],
    ]),
  );
});
after(() => uninstall());

test("a remote transcript's image loads through its host's daemon, once that transcript names it", async () => {
  const path = "/tmp/run 5/shots/page.png";
  assert.equal((await get(url(path))).status, 404, "not before the transcript names it");
  rememberTimelineImages([reply(`![Image](<${path}>)`)], "srv_remote");
  const shown = await get(url(path));
  assert.equal(shown.status, 200);
  assert.equal(shown.headers["content-type"], "image/png");
  assert.equal(shown.headers["x-content-type-options"], "nosniff");
  const read = remote.calls.find((c) => c.method === "readFile")!;
  assert.deepEqual(read.args.slice(0, 2), ["/tmp/run 5/shots", "page.png"], "the file's folder as the root, its name as the path");
  // Never this Mac's file of that name, nor another host's.
  assert.equal((await get(url(path, ""))).status, 404);
  const other = register(local, network, "srv_other", "10.0.0.10:6767");
  other.trees.set("/tmp/run 5/shots", new Map([["page.png", new Uint8Array(PNG)]]));
  assert.equal((await get(url(path, "srv_other"))).status, 404);
});

test("only real raster images, never a path out of the folder", async () => {
  for (const name of ["fake.png", "escape.png"]) {
    const path = `/tmp/run 5/shots/${name}`;
    rememberTimelineImages([reply(`![Image](<${path}>)`)], "srv_remote");
    assert.equal((await get(url(path))).status, 404, name);
  }
  rememberTimelineImages([reply("![Image](/tmp/../etc/x.png)")], "srv_remote");
  assert.equal((await get(url("/tmp/../etc/x.png"))).status, 404);
  assert.equal((await get(url("/tmp/run 5/shots/notes.txt"))).status, 404);
});
