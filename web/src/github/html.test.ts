import { test } from "node:test";
import assert from "node:assert/strict";
import { HTML_MAX, sanitizeGithubHtml as clean } from "./html";
import { BOT_HTML, DETAILS_HTML } from "../../server/github/fake";

const CAMO = "https://camo.githubusercontent.com/abc123/68747470733a2f2f";

test("GitHub's rendering of a bot's table, images and line breaks is kept; its hidden comment isn't", () => {
  const html =
    "<p>Review the following changes in direct dependencies. Learn more about <a href=\"https://socket.dev\" rel=\"nofollow\">Socket for GitHub</a>.</p>\n" +
    '<markdown-accessiblity-table><table>\n<thead><tr><th>Diff</th><th width="200px">Package</th><th align="center">Supply Chain<br/>Security</th></tr></thead>\n' +
    `<tbody><tr><td><a href="https://socket.dev/diff/npm/x">Added</a></td><td>x@1.0.0</td><td align="center"><a href="https://socket.dev/x"><img src="${CAMO}" alt="100" width="50" height="40" data-canonical-src="https://github-app-statics.socket.dev/score-100.svg" style="max-width: 100%;"></a></td></tr></tbody>\n` +
    "</table></markdown-accessiblity-table>\n<p><a href=\"https://socket.dev/report\">View full report</a></p>\n<!-- overview-comment -->";
  const out = clean(html);
  assert.ok(out.includes('<div class="md-table" tabindex="0" role="region" aria-label="Table"><table>'));
  assert.ok(out.includes('<th width="200px">Package</th>'));
  assert.ok(out.includes('<th align="center">Supply Chain<br>Security</th>'));
  assert.ok(out.includes(`<img src="${CAMO}" alt="100" width="50" height="40" loading="lazy" decoding="async" referrerpolicy="no-referrer">`));
  assert.ok(out.includes('<a href="https://socket.dev/report" target="_blank" rel="noopener noreferrer nofollow">View full report</a>'));
  assert.ok(!out.includes("overview-comment"));
  assert.ok(!out.includes("markdown-accessiblity-table"));
  assert.ok(!out.includes("style"));
  assert.ok(!out.includes("data-canonical-src"));
  assert.ok(out.endsWith("</p>\n"));
});

test("details, kbd, sub, sup, task lists, alerts and headings keep their shape", () => {
  const out = clean(
    "<details open><summary>More</summary><p>Hidden <kbd>⌘</kbd> H<sub>2</sub>O x<sup>2</sup></p></details>" +
      '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> done</li></ul>' +
      '<div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0Z"></path></svg>Note</p><p dir="auto">Mind it.</p></div>' +
      '<h1 id="user-content-title" class="heading-element">Title</h1><h2>Sub</h2>',
  );
  assert.ok(out.includes("<details open><summary>More</summary><p>Hidden <kbd>⌘</kbd> H<sub>2</sub>O x<sup>2</sup></p></details>"));
  assert.ok(out.includes('<li class="task-list-item"><input type="checkbox" checked disabled class="md-task"> done</li>'));
  assert.ok(out.includes('<div class="markdown-alert markdown-alert-note" dir="auto">'));
  assert.ok(out.includes('<svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0Z"></path></svg>Note'));
  assert.ok(out.includes('<h3 id="user-content-title" class="md-h1">Title</h3><h4 class="md-h2">Sub</h4>'));
});

test("code blocks keep GitHub's highlighting classes, but no others", () => {
  const out = clean('<div class="highlight highlight-source-js notranslate position-relative overflow-auto"><pre><span class="pl-k">const</span> <span class="gh-entry">x</span></pre></div>');
  assert.equal(out, '<div class="highlight highlight-source-js notranslate"><pre><span class="pl-k">const</span> <span>x</span></pre></div>');
});

test("hostile input: no scripts, styles, handlers, frames, forms or script URLs survive", () => {
  const hostile = [
    "<script>alert(1)</script>",
    "<SCRIPT src=//evil.js></SCRIPT>",
    "<img src=x onerror=alert(1)>",
    '<img src="https://evil.example/track.gif" alt="tracker">',
    '<img src="javascript:alert(1)">',
    '<a href="javascript:alert(1)">a</a>',
    '<a href="jav&#x09;ascript:alert(1)">b</a>',
    '<a href="JaVaScRiPt&colon;alert(1)">c</a>',
    '<a href=" data:text/html,<script>alert(1)</script>">d</a>',
    '<a href="vbscript:x">e</a>',
    '<a href="https://ok.example" onclick="alert(1)" style="position:fixed">f</a>',
    "<style>body{display:none}</style>",
    '<div style="background:url(javascript:alert(1))">g</div>',
    '<iframe src="https://evil.example"></iframe>',
    '<form action="https://evil.example"><input type="text" name="q"><button>go</button></form>',
    '<object data="x"><embed src="y"></object>',
    "<svg><script>alert(1)</script><foreignObject><img src=x onerror=alert(1)></foreignObject><a href=\"javascript:1\">h</a></svg>",
    "<math><mi xlink:href=\"javascript:alert(1)\">i</mi></math>",
    "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\"></noscript>",
    "<template><img src=x onerror=alert(1)></template>",
    '<input type="text" value="x" autofocus onfocus="alert(1)">',
    "<p id=\"header\" class=\"app-bar\">j</p>",
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<base href="https://evil.example/">',
    "<a href=\"https://ok.example\" title='\"><script>alert(1)</script>'>k</a>",
    "<div <img src=x onerror=alert(1)>>l</div>",
    "<p>unclosed <b>bold <i>italic",
    "</div></p></table>stray ends",
    "<img src='https://camo.githubusercontent.com/x' onload=alert(1) /><br/onmouseover=alert(1)>",
    "<<script>script>alert(1)<</script>/script>",
    "<details ontoggle=alert(1) open>m</details>",
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    '<source srcset="javascript:alert(1)"><picture><source srcset="https://evil.example/a.png"></picture>',
  ].join("\n");
  const out = clean(hostile);
  const lower = out.toLowerCase();
  for (const bad of ["<script", "<style", "<iframe", "<form", "<object", "<embed", "<math", "<template", "<meta", "<base", "<button", "<foreignobject", "<noscript"]) {
    assert.ok(!lower.includes(bad), `${bad} in ${out}`);
  }
  assert.ok(!/\son[a-z]+=/i.test(out), out);
  assert.ok(!lower.includes("javascript:"), out);
  assert.ok(!lower.includes("vbscript:"), out);
  assert.ok(!lower.includes("data:"), out);
  assert.ok(!lower.includes("style="), out);
  assert.ok(!lower.includes("evil.example"), out);
  assert.ok(!lower.includes('id="header"'), out);
  assert.ok(!lower.includes("app-bar"), out);
  assert.ok(!/<input(?![^>]*disabled)/.test(out), out);
  // What's left reads as text: the link's words, the tracker's alt, escaped text.
  assert.ok(out.includes('<a href="https://ok.example" target="_blank" rel="noopener noreferrer nofollow">f</a>'));
  assert.ok(out.includes("tracker"));
  assert.ok(out.includes("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"));
  assert.ok(out.includes('title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'));
  // Every element it opened is closed.
  assert.ok(out.includes("<p>unclosed <b>bold <i>italic"));
  const opened = (out.match(/<(?!\/)(?!br|img|input|hr|wbr|source|col\b)[a-z][a-z0-9]*/g) ?? []).length;
  const closed = (out.match(/<\/[a-z][a-z0-9]*/g) ?? []).length;
  assert.equal(opened, closed, out);
});

test("in-page links only to GitHub's own footnote ids; mail links stay", () => {
  const out = clean('<sup><a href="#user-content-fn-1" id="user-content-fnref-1" data-footnote-ref>1</a></sup><a href="#top">t</a><a href="mailto:a@b.c">m</a>');
  assert.equal(
    out,
    '<sup><a href="#user-content-fn-1" id="user-content-fnref-1">1</a></sup><a>t</a><a href="mailto:a@b.c" target="_blank" rel="noopener noreferrer nofollow">m</a>',
  );
});

test("nothing, or too much, is no HTML: the body falls back to its Markdown", () => {
  assert.equal(clean(""), "");
  assert.equal(clean("x".repeat(HTML_MAX + 1)), "");
});

test("the fake GitHub's renderings clean as the page draws them", () => {
  const bot = clean(BOT_HTML);
  assert.ok(bot.includes("<table>") && bot.includes('<img src="https://camo.githubusercontent.com/5c0ffee/68747470733a2f2f" width="50" height="40"'));
  assert.ok(!bot.includes("&lt;") && !bot.includes("markdown-accessiblity"));
  assert.ok(clean(DETAILS_HTML).includes("<details>\n<summary>Why</summary>"));
});
