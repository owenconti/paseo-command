import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { autolinkRuns, autolinks, codeFile, workspaceFiles, type AutolinkContext } from "./autolink";
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

const ROOT = "/Users/me/ws/atlas";
const FILES: AutolinkContext = {
  ...CTX,
  files: workspaceFiles(
    [
      "docs/reports/resource-reference-approaches.md",
      "web/src/index.ts",
      "src/index.ts",
      "src/autolink.ts",
      "package.json",
      "Makefile",
      ".github/workflows/ci.yml",
      "docs/DE-7338.md",
    ],
    `${ROOT}/`,
  ),
};
const files = (text: string, ctx = FILES) => autolinks(text, ctx).map((l) => [text.slice(l.start, l.end), l.file ?? l.href]);

test("paths to the workspace's files link, with their lines; others stay plain", () => {
  assert.deepEqual(files("The report is at docs/reports/resource-reference-approaches.md."), [
    ["docs/reports/resource-reference-approaches.md", { path: "docs/reports/resource-reference-approaches.md" }],
  ]);
  assert.deepEqual(files("See src/autolink.ts:12, ./src/index.ts:3:7 and src/autolink.ts#L4-L9 (web/src/index.ts:20-25)."), [
    ["src/autolink.ts:12", { path: "src/autolink.ts", line: 12 }],
    ["./src/index.ts:3:7", { path: "src/index.ts", line: 3 }],
    ["src/autolink.ts#L4-L9", { path: "src/autolink.ts", line: 4, endLine: 9 }],
    ["web/src/index.ts:20-25", { path: "web/src/index.ts", line: 20, endLine: 25 }],
  ]);
  // Absolute inside the workspace's folder: made relative; outside it, plain.
  assert.deepEqual(files(`Edited ${ROOT}/src/autolink.ts:8 and /etc/src/autolink.ts.`), [
    [`${ROOT}/src/autolink.ts:8`, { path: "src/autolink.ts", line: 8 }],
  ]);
  // A path inside the workspace's files takes its Linear key; hidden folders link too.
  assert.deepEqual(files("Wrote docs/DE-7338.md and .github/workflows/ci.yml"), [
    ["docs/DE-7338.md", { path: "docs/DE-7338.md" }],
    [".github/workflows/ci.yml", { path: ".github/workflows/ci.yml" }],
  ]);
  for (const text of [
    "src/missing.ts and docs/reports/ stay plain",
    "index.ts is in two folders",
    "a Makefile, and src/autolink.tsx or src/autolink.ts.bak",
    "../src/autolink.ts or src/../src/autolink.ts",
    "https://example.com/src/autolink.ts",
    "~/src/autolink.ts",
  ])
    assert.deepEqual(files(text), [], text);
  // A bare name links only when one file has it, and in prose only with an extension.
  assert.deepEqual(files("Bumped package.json; autolink.ts too."), [
    ["package.json", { path: "package.json" }],
    ["autolink.ts", { path: "src/autolink.ts" }],
  ]);
  // Without the workspace's files nothing links as a file.
  assert.deepEqual(files("src/autolink.ts", CTX), []);
});

test("inline code that is exactly a file's path links", () => {
  assert.deepEqual(codeFile("docs/reports/resource-reference-approaches.md", FILES), { path: "docs/reports/resource-reference-approaches.md" });
  assert.deepEqual(codeFile(" src/autolink.ts:40 ", FILES), { path: "src/autolink.ts", line: 40 });
  assert.deepEqual(codeFile("Makefile", FILES), { path: "Makefile" });
  for (const code of ["src/autolink.ts foo", "npm run src/autolink.ts", "index.ts", "src/nope.ts", "const a = 1"])
    assert.equal(codeFile(code, FILES), undefined, code);
  const text = "Open `src/autolink.ts:3` and `cat src/autolink.ts`, then src/index.ts.";
  const runs = autolinkRuns(text, FILES);
  assert.equal(runs.map((r) => r.text).join(""), text);
  assert.deepEqual(
    runs.filter((r) => r.file).map((r) => [r.text, r.file]),
    [
      ["src/autolink.ts:3", { path: "src/autolink.ts", line: 3 }],
      ["src/index.ts", { path: "src/index.ts" }],
    ],
  );
});

test("Markdown links file paths in prose and exact inline code, never in code blocks or links", () => {
  const md = [
    "The report is at `docs/reports/resource-reference-approaches.md`. See src/autolink.ts#L12 too.",
    "",
    "`npm test src/index.ts` and [src/index.ts](https://example.com/a) stay.",
    "",
    "```",
    "src/autolink.ts",
    "```",
  ].join("\n");
  const html = renderToStaticMarkup(createElement(Autolinks.Provider, { value: FILES }, createElement(Markdown, { text: md })));
  const links = [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(links, [
    [
      "<code>docs/reports/resource-reference-approaches.md</code>",
      'href="#files:docs/reports/resource-reference-approaches.md" class="file-link" title="Open in Files" data-file-path="docs/reports/resource-reference-approaches.md"',
    ],
    ["src/autolink.ts#L12", 'href="#files:src/autolink.ts:12" class="file-link" title="Open in Files" data-file-path="src/autolink.ts" data-file-line="12"'],
    ["src/index.ts", 'href="https://example.com/a" target="_blank" rel="noopener noreferrer"'],
  ]);
  assert.match(html, /<code>npm test src\/index.ts<\/code>/);
  assert.match(html, /<pre><code>src\/autolink.ts<\/code><\/pre>/);
});
