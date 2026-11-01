import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAppLink } from "./appLinks";

describe("app links", () => {
  it("reads a Linear issue's link", () => {
    assert.deepEqual(parseAppLink("https://linear.app/acme/issue/de-42/fix-the-thing"), { kind: "linear", issue: "DE-42" });
    assert.deepEqual(parseAppLink("https://linear.app/acme/issue/DE-7"), { kind: "linear", issue: "DE-7" });
  });

  it("reads a Slack conversation's, message's and reply's links", () => {
    assert.deepEqual(parseAppLink("https://acme.slack.com/archives/C0123ABC"), {
      kind: "slack",
      host: "acme.slack.com",
      conversationId: "C0123ABC",
    });
    assert.deepEqual(parseAppLink("https://acme.slack.com/archives/C0123ABC/p1700000000123456"), {
      kind: "slack",
      host: "acme.slack.com",
      conversationId: "C0123ABC",
      ts: "1700000000.123456",
    });
    assert.deepEqual(
      parseAppLink("https://acme.slack.com/archives/D0123/p1700000001000200?thread_ts=1700000000.123456&cid=D0123"),
      { kind: "slack", host: "acme.slack.com", conversationId: "D0123", threadTs: "1700000000.123456", ts: "1700000001.000200" },
    );
  });

  it("leaves other links alone", () => {
    for (const href of [
      "https://linear.app/acme/project/thing-abc123",
      "https://linear.app/acme/settings",
      "https://evil.example/acme/issue/DE-1",
      "https://linear.app.evil.example/acme/issue/DE-1",
      "https://slack.com/archives/C0123",
      "https://acme.slack.com/client/T1/C0123",
      "javascript:alert(1)",
      "not a url",
    ])
      assert.equal(parseAppLink(href), null, href);
  });
});
