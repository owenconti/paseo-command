import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fleet, get, install, register } from "../fake-daemon";

const { network, local } = fleet();
const remote = register(local, network, "srv_remote", "10.0.0.9:6767");
let uninstall: () => void;
let dir: string;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
before(async () => {
  uninstall = install(network);
  dir = await mkdtemp(join(tmpdir(), "paseo-image-api-"));
});
after(async () => {
  uninstall();
  await rm(dir, { recursive: true, force: true });
});

test("reading a local agent's timeline makes its generated image available", async () => {
  const path = join(dir, "pdf-contact.png");
  await writeFile(path, PNG);
  const endpoint = `attachments/image?path=${encodeURIComponent(path)}`;
  local.addAgent({ id: "preview-agent" });
  local.pushTimeline("preview-agent", {
    type: "assistant_message",
    text: `![Image](${pathToFileURL(path).href})`,
  });
  assert.equal((await get(endpoint)).status, 404);
  assert.equal((await get("agents/preview-agent/timeline")).status, 200);
  const image = await get(endpoint);
  assert.equal(image.status, 200);
  assert.equal(image.headers["content-type"], "image/png");
  assert.deepEqual(image.data, PNG);
});

test("a remote transcript cannot authorize reading the same path on this machine", async () => {
  const path = join(dir, "remote-contact.png");
  await writeFile(path, PNG);
  remote.addAgent({ id: "remote-agent" });
  remote.pushTimeline("remote-agent", {
    type: "assistant_message",
    text: `![Image](${pathToFileURL(path).href})`,
  });
  assert.equal(
    (await get("agents/remote-agent/timeline?host=srv_remote")).status,
    200,
  );
  assert.equal(
    (await get(`attachments/image?path=${encodeURIComponent(path)}`)).status,
    404,
  );
});
