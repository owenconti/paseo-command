import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { decodeEntities, rehypeFilesMarkdown } from "./markdownHtml";

const render = (md: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeFilesMarkdown as never] }, md))
    // Elements' source lines, and React's server-side image preloads, aside.
    .replace(/ data-line="\d+"/g, "")
    .replace(/<link rel="preload"[^>]*>/g, "");

test("a README's HTML: allowed elements made, with what's between them; checked attributes only", () => {
  assert.equal(render('<p align="center"><img src="logo.png" alt="Logo" width="120" onerror="x()"></p>'), '<p align="center"><img src="logo.png" alt="Logo" width="120"/></p>');
  assert.equal(render("Press <kbd>⌘K</kbd>, then<br>go."), "<p>Press <kbd>⌘K</kbd>, then<br/>go.</p>");
  assert.equal(
    render("<details><summary>More</summary>\n\nHidden **text**.\n\n</details>"),
    "<details><summary>More</summary>\n<p>Hidden <strong>text</strong>.</p>\n</details>",
  );
  assert.equal(render('<div align="left" class="app" style="color:red" id="files-sidebar">x</div>'), '<div align="left">x</div>');
});

test("never scripts, styles, frames, forms or handlers; unknown elements left out, their text kept", () => {
  const html = render('<script>alert(1)</script><style>*{}</style><iframe src="https://x"></iframe><form><input></form>\n\n<center><font color="red">kept</font></center>\n\n<a href="javascript:alert(1)" onclick="x()">link</a>');
  assert.doesNotMatch(html, /script|style|iframe|form|input|onclick|center|font|javascript/i);
  assert.match(html, /kept/);
  assert.match(html, /<a[^>]*>link<\/a>/);
  // A dropped element nested in itself is skipped to its own end.
  assert.equal(render("<p>a<svg><svg></svg>hidden</svg>b</p>"), "<p>ab</p>");
  // Comments go; a tag never closed ends with its parent.
  assert.equal(render("<!-- note --><b>bold"), "<b>bold</b>");
});

test("headings get GitHub's anchors, from their text", () => {
  assert.equal(render("# Getting Started\n\n## Getting Started\n\n<h3>From HTML</h3>"), '<h1 data-anchor="getting-started">Getting Started</h1>\n<h2 data-anchor="getting-started-1">Getting Started</h2>\n<h3 data-anchor="from-html">From HTML</h3>');
});

test("entities in raw HTML", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &#x1F600; &#65; &bogus; &#xD800;"), "a & b <c> 😀 A &bogus; �");
});
