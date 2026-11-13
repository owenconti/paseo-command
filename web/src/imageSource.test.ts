import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveImage } from "./imageSource";

test("a remote agent's image file loads through its host's daemon; a local one from this Mac", () => {
  assert.deepEqual(resolveImage("/tmp/run 5/page.png", "srv_remote"), {
    kind: "local",
    url: "/api/attachments/image?path=%2Ftmp%2Frun%205%2Fpage.png&host=srv_remote",
    path: "/tmp/run 5/page.png",
    name: "page.png",
  });
  assert.equal(resolveImage("file:///tmp/a.png").kind === "local" && resolveImage("file:///tmp/a.png").url, "/api/attachments/image?path=%2Ftmp%2Fa.png");
  assert.equal(resolveImage("https://example.com/a.png", "srv_remote").kind, "remote");
  assert.equal(resolveImage("file://elsewhere/tmp/a.png", "srv_remote").kind, "invalid");
});
