import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAppLink } from "./appLinks";

describe("app links", () => {
  it("reads a GitHub pull request's link, at its tab", () => {
    assert.deepEqual(parseAppLink("https://github.com/acme/web.app/pull/42"), {
      kind: "github",
      place: { kind: "pr", repo: "acme/web.app", number: 42, tab: "conversation" },
    });
    assert.deepEqual(parseAppLink("https://github.com/acme/web/pull/7/files#diff-abc"), {
      kind: "github",
      place: { kind: "pr", repo: "acme/web", number: 7, tab: "files" },
    });
  });

  it("leaves other links alone", () => {
    for (const href of [
      // Linear issues open in Linear's desktop app (or Conquer): the app's, not the page's.
      "https://linear.app/acme/issue/de-42/fix-the-thing",
      "https://linear.app/acme/project/thing-abc123",
      "https://linear.app/acme/settings",
      "https://evil.example/acme/issue/DE-1",
      "https://linear.app.evil.example/acme/issue/DE-1",
      // Slack links open as ordinary links, in Conquer.
      "https://acme.slack.com/archives/C0123ABC",
      "https://acme.slack.com/archives/D0123/p1700000001000200?thread_ts=1700000000.123456",
      "https://github.com/acme/web/issues/3",
      "https://github.com/acme/web/pull/abc",
      "https://github.com.evil.example/acme/web/pull/1",
      "https://gist.github.com/acme/web/pull/1",
      "javascript:alert(1)",
      "not a url",
    ])
      assert.equal(parseAppLink(href), null, href);
  });
});
