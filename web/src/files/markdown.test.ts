import { test } from "node:test";
import assert from "node:assert/strict";
import { findInPieces, headingSlugger, markdownType, pieceAt, resolveImageSource, resolveLink, resolvePath } from "./markdown";

const FROM = "docs/reports/approaches.md";

test("Markdown files by extension, .mdx too", () => {
  assert.equal(markdownType("README.md"), "md");
  assert.equal(markdownType("docs/Guide.MARKDOWN"), "markdown");
  assert.equal(markdownType("site/page.mdx"), "mdx");
  assert.equal(markdownType("notes.txt"), undefined);
  assert.equal(markdownType(".md"), undefined);
  assert.equal(markdownType("md"), undefined);
});

test("paths resolve against the file's folder, or the root with /, and never leave the workspace", () => {
  assert.equal(resolvePath(FROM, "other.md"), "docs/reports/other.md");
  assert.equal(resolvePath(FROM, "./other.md"), "docs/reports/other.md");
  assert.equal(resolvePath(FROM, "../guide.md"), "docs/guide.md");
  assert.equal(resolvePath(FROM, "../../src/app.ts"), "src/app.ts");
  assert.equal(resolvePath(FROM, "/src/app.ts"), "src/app.ts");
  assert.equal(resolvePath("README.md", "src//a.ts"), "src/a.ts");
  assert.equal(resolvePath(FROM, "../../../etc/passwd"), null);
  assert.equal(resolvePath("README.md", "../x"), null);
  assert.equal(resolvePath(FROM, "a\\b"), null);
  assert.equal(resolvePath(FROM, "a\0b"), null);
});

test("links: in-repo files (at a line or heading), folders, anchors, the web; other schemes go nowhere", () => {
  assert.deepEqual(resolveLink(FROM, "other.md"), { kind: "file", path: "docs/reports/other.md" });
  assert.deepEqual(resolveLink(FROM, "../../src/app.ts#L12"), { kind: "file", path: "src/app.ts", line: 12 });
  assert.deepEqual(resolveLink(FROM, "/src/app.ts#L12-L20"), { kind: "file", path: "src/app.ts", line: 12, endLine: 20 });
  assert.deepEqual(resolveLink(FROM, "../guide.md#getting-started"), { kind: "file", path: "docs/guide.md", anchor: "getting-started" });
  assert.deepEqual(resolveLink(FROM, "my%20notes.md?raw=1"), { kind: "file", path: "docs/reports/my notes.md" });
  assert.deepEqual(resolveLink(FROM, "<with space.md>"), { kind: "file", path: "docs/reports/with space.md" });
  assert.deepEqual(resolveLink(FROM, "../"), { kind: "folder", path: "docs" });
  assert.deepEqual(resolveLink(FROM, "/"), { kind: "folder", path: "" });
  assert.deepEqual(resolveLink(FROM, "#why-not-tags"), { kind: "anchor", id: "why-not-tags" });
  assert.deepEqual(resolveLink(FROM, "#caf%C3%A9"), { kind: "anchor", id: "café" });
  assert.deepEqual(resolveLink(FROM, "https://github.com/o/r/pull/7"), { kind: "web", url: "https://github.com/o/r/pull/7" });
  assert.deepEqual(resolveLink(FROM, "http://example.com"), { kind: "web", url: "http://example.com/" });
  assert.deepEqual(resolveLink(FROM, "mailto:a@b.c"), { kind: "web", url: "mailto:a@b.c" });
  for (const nowhere of ["javascript:alert(1)", "JaVaScRiPt:x", "data:text/html,x", "file:///etc/passwd", "//evil.example/x", "vscode://x", "https://u:p@example.com", "../../../x.md", "", "#"])
    assert.deepEqual(resolveLink(FROM, nowhere), { kind: "none" }, nowhere);
});

test("images: the workspace's raster images and https; everything else blocked", () => {
  assert.deepEqual(resolveImageSource(FROM, "shot.png"), { kind: "workspace", path: "docs/reports/shot.png", name: "shot.png" });
  assert.deepEqual(resolveImageSource(FROM, "../img/a%20b.JPG?x=1"), { kind: "workspace", path: "docs/img/a b.JPG", name: "a b.JPG" });
  assert.deepEqual(resolveImageSource(FROM, "/assets/logo.webp"), { kind: "workspace", path: "assets/logo.webp", name: "logo.webp" });
  assert.deepEqual(resolveImageSource(FROM, "https://example.com/a.gif"), { kind: "remote", url: "https://example.com/a.gif", name: "a.gif" });
  for (const blocked of ["http://example.com/a.png", "data:image/png;base64,AAAA", "file:///tmp/a.png", "//cdn.example/a.png", "javascript:x", "icon.svg", "../../../../a.png", "https://u:p@example.com/a.png", ""])
    assert.equal(resolveImageSource(FROM, blocked).kind, "blocked", blocked);
});

test("heading anchors as GitHub names them, repeats numbered", () => {
  const slug = headingSlugger();
  assert.equal(slug("Getting Started"), "getting-started");
  assert.equal(slug("What's new in v2.0?"), "whats-new-in-v20");
  assert.equal(slug("Getting Started"), "getting-started-1");
  assert.equal(slug("  Café & Crème  "), "café--crème");
  assert.equal(slug("snake_case and-dash"), "snake_case-and-dash");
});

test("find in rendered text: across pieces of one block, never between blocks", () => {
  const pieces = [
    { text: "Some ", block: 0 },
    { text: "bold", block: 0 },
    { text: " words", block: 0 },
    { text: "bold start", block: 1 },
  ];
  const r = findInPieces(pieces, "bold words", { caseSensitive: false, regex: false });
  assert.equal(r.matches.length, 1);
  assert.deepEqual(pieceAt(r.starts, r.matches[0]!.start), { piece: 1, offset: 0 });
  assert.deepEqual(pieceAt(r.starts, r.matches[0]!.end, true), { piece: 2, offset: 6 });
  assert.equal(findInPieces(pieces, "BOLD", { caseSensitive: false, regex: false }).matches.length, 2);
  assert.equal(findInPieces(pieces, "BOLD", { caseSensitive: true, regex: false }).matches.length, 0);
  // "words" ends one block, "bold" starts the next: no match across them.
  assert.equal(findInPieces(pieces, "words\\s*bold", { caseSensitive: false, regex: true }).matches.length, 0);
  assert.equal(findInPieces(pieces, "(", { caseSensitive: false, regex: true }).error, "Invalid pattern");
  // An end at a piece's edge stays in the piece before.
  const edge = findInPieces(pieces, "bold", { caseSensitive: false, regex: false }).matches[0]!;
  assert.deepEqual(pieceAt(r.starts, edge.end, true), { piece: 1, offset: 4 });
});
