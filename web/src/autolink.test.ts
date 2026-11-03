import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { autolinkRuns, autolinks, type AutolinkContext } from "./autolink";
import { Autolinks } from "./autolinkStore";
import { Markdown } from "./Markdown";

const CTX: AutolinkContext = { repo: "acme/web", linearWorkspace: "acme", teams: new Set(["DE", "ENG"]) };
/** Each mention found, as written, with its link. */
const found = (text: string, ctx = CTX) => autolinks(text, ctx).map((l) => [text.slice(l.start, l.end), l.href]);
const issue = (key: string) => `https://linear.app/acme/issue/${key}`;
const pr = (n: number, repo = "acme/web") => `https://github.com/${repo}/pull/${n}`;

test("links the workspace's teams' Linear keys, not other KEY-123 shapes", () => {
  assert.deepEqual(
    found("The comment on DE-7338 says a new issue will cover it… DE-7413 has no comment at all. So I put both into DE-7829."),
    [
      ["DE-7338", issue("DE-7338")],
      ["DE-7413", issue("DE-7413")],
      ["DE-7829", issue("DE-7829")],
    ],
  );
  assert.deepEqual(found("ENG-1, (ENG-22) and DE-3's"), [
    ["ENG-1", issue("ENG-1")],
    ["ENG-22", issue("ENG-22")],
    ["DE-3", issue("DE-3")],
  ]);
  for (const text of ["UTF-8", "ISO-8601", "SHA-256", "OPS-12 is another team's", "de-7338", "DE-0"])
    assert.deepEqual(found(text), [], text);
  assert.deepEqual(found("DE-7338", { repo: "acme/web" }), [], "no teams known: no Linear links");
  assert.deepEqual(found("DE-7338", { teams: new Set(["DE"]) }), [], "no workspace address: none either");
});

test("links PR numbers to the workspace's repository, and owner/repo#n to that one", () => {
  assert.deepEqual(found("Lucas's comment on DE-7338 also links PR #7054, see #7055 and pull request 7056."), [
    ["DE-7338", issue("DE-7338")],
    ["PR #7054", pr(7054)],
    ["#7055", pr(7055)],
    ["pull request 7056", pr(7056)],
  ]);
  assert.deepEqual(found("Pull request #12 (#13)"), [
    ["Pull request #12", pr(12)],
    ["#13", pr(13)],
  ]);
  assert.deepEqual(found("fixed in getpaseo/paseo#88."), [["getpaseo/paseo#88", pr(88, "getpaseo/paseo")]]);
  assert.deepEqual(found("getpaseo/paseo#88 and #9", {}), [["getpaseo/paseo#88", pr(88, "getpaseo/paseo")]], "owner/repo#n needs no workspace");
  assert.deepEqual(found("PR #7054 and #7055", { linearWorkspace: "acme", teams: new Set(["DE"]) }), [], "no repository: plain");
});

test("leaves numbers that aren't pull requests", () => {
  for (const text of [
    "step #3",
    "Step #3 of 5",
    "item #2",
    "the #1 priority",
    "colour #333",
    "background: #000",
    "#fff and #3a3",
    "#0123",
    "&#123;",
    "a/b/c#12",
    "src/views/DE-7338.ts",
    "feature/DE-7338-thing",
    "DE-7338.md",
    "notes.md#12",
    "example.com/x#12",
    "issue #5",
  ])
    assert.deepEqual(found(text), [], text);
});

test("plain text runs keep every character and skip `code`", () => {
  const text = "See #12, `#13` and DE-1 ``DE-2``.";
  const runs = autolinkRuns(text, CTX);
  assert.equal(runs.map((r) => r.text).join(""), text);
  assert.deepEqual(
    runs.filter((r) => r.href).map((r) => r.text),
    ["#12", "DE-1"],
  );
});

test("Markdown links mentions in prose only: not code, code blocks, links or URLs", () => {
  const md = [
    "Merged PR #7054 for DE-7338, **DE-7413** too.",
    "",
    "`DE-1 #1` and [ENG-2 #2](https://example.com/x) and https://github.com/acme/web/pull/3#4 stay.",
    "",
    "```",
    "DE-5 #5",
    "```",
  ].join("\n");
  const html = renderToStaticMarkup(createElement(Autolinks.Provider, { value: CTX }, createElement(Markdown, { text: md })));
  const hrefs = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(hrefs, [
    ["PR #7054", pr(7054)],
    ["DE-7338", issue("DE-7338")],
    ["DE-7413", issue("DE-7413")],
    ["ENG-2 #2", "https://example.com/x"],
    ["https://github.com/acme/web/pull/3#4", "https://github.com/acme/web/pull/3#4"],
  ]);
  assert.match(html, /<code>DE-1 #1<\/code>/);
  const plain = renderToStaticMarkup(createElement(Markdown, { text: "PR #7054 for DE-7338" }));
  assert.doesNotMatch(plain, /<a /, "outside a conversation nothing links itself");
});
