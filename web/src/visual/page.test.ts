import { it } from "node:test";
import assert from "node:assert/strict";
import {
  VISUAL_CSP,
  VISUAL_FENCE,
  VISUAL_LIMITS,
  fenceClosed,
  findLocalImages,
  frameHeight,
  inlineImages,
  isVisualLang,
  readKey,
  readLink,
  readSize,
  titleOf,
  usesViewportHeight,
  visualDocument,
  visualTheme,
  withoutPages,
} from "./page";

const theme = visualTheme("dark", () => "");

it("only an html-render fence is a page", () => {
  assert.ok(isVisualLang("html-render"));
  assert.ok(isVisualLang("HTML-Render"));
  assert.ok(!isVisualLang("html"));
  assert.ok(!isVisualLang(undefined));
  assert.ok(VISUAL_FENCE.test("```html-render\n<p>x</p>\n```"));
  assert.ok(!VISUAL_FENCE.test("```html\n<p>x</p>\n```"));
});

it("the theme uses the app's tokens where set, else its own for the appearance", () => {
  const set = visualTheme("light", (t) => (t === "--panel" ? " #abcdef " : ""));
  assert.equal(set.variables["--background"], "#abcdef");
  assert.equal(set.variables["--foreground"], "#29394e");
  assert.equal(theme.variables["--foreground"], "#e2e9f2");
  assert.equal(theme.variables["--chart-6"], "#a3e635");
  // A token can't end its declaration or the sheet.
  const bad = visualTheme("light", () => "red;}</style><script>x</script>");
  assert.equal(bad.variables["--background"], "red/stylescriptx/script");
});

it("the policy, theme and bootstrap come before anything the page wrote", () => {
  for (const html of [
    "<!doctype html><html><head><title>T</title><script>evil()</script></head><body></body></html>",
    "<html><body><script>evil()</script></body></html>",
    "<!doctype html><p>hi</p><script>evil()</script>",
    "<p>hi</p><script>evil()</script>",
    // A script ahead of the page's own head still comes after the policy.
    '<!-- <head> --><script>var s = "<head>";evil()</script><html><head></head></html>',
  ]) {
    const doc = visualDocument(html, theme);
    assert.match(doc, /^<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/, html);
    assert.ok(doc.indexOf("paseo/size") < doc.indexOf("evil()"), html);
    assert.equal(doc.split("Content-Security-Policy").length, 2);
    assert.equal(doc.split(/<!doctype/i).length, 2);
    assert.ok(doc.endsWith(html.replace(/^<!doctype html>/, "")), html);
  }
  assert.match(visualDocument("<p>x</p>", theme), /color-scheme:dark;--background:#172130;/);
});

it("the policy allows https and inline code, never plain http, frames or forms", () => {
  assert.match(VISUAL_CSP, /default-src 'none'/);
  assert.match(VISUAL_CSP, /connect-src https:(;|$)/);
  assert.match(VISUAL_CSP, /form-action 'none'/);
  assert.match(VISUAL_CSP, /base-uri 'none'/);
  assert.doesNotMatch(VISUAL_CSP, /http:|\*|frame-src|'self'/);
});

it("links are handed to the app, or sent to a new tab where the frame may open one", () => {
  assert.match(visualDocument("<p>x</p>", theme), /paseo\/open-link/);
  const popups = visualDocument("<p>x</p>", theme, { popups: true });
  assert.doesNotMatch(popups, /paseo\/open-link/);
  assert.match(popups, /"target","_blank"/);
});

it("messages from a page are read strictly", () => {
  assert.equal(readSize({ type: "paseo/size", height: 412 }), 412);
  assert.equal(readSize({ type: "paseo/size", height: -1 }), undefined);
  assert.equal(readSize({ type: "paseo/size", height: "9" }), undefined);
  assert.equal(readSize({ type: "other", height: 9 }), undefined);
  assert.equal(readSize(null), undefined);
  assert.equal(
    readLink({ type: "paseo/open-link", url: "https://example.com/a?b=1" }),
    "https://example.com/a?b=1",
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "paseo://x",
    "https://user:pw@example.com/",
    "not a url",
    7,
  ])
    assert.equal(readLink({ type: "paseo/open-link", url }), undefined);
  assert.deepEqual(readKey({ type: "paseo/key", key: "k", code: "KeyK", metaKey: true }), {
    key: "k",
    code: "KeyK",
    metaKey: true,
    ctrlKey: false,
  });
  assert.deepEqual(readKey({ type: "paseo/key", key: "Escape", code: "Escape", metaKey: true }), {
    key: "Escape",
    code: "Escape",
    metaKey: false,
    ctrlKey: false,
  });
  // Only the app's own keys: never ⌘W, ⌘Q, a plain letter.
  assert.equal(readKey({ type: "paseo/key", key: "w", metaKey: true }), undefined);
  assert.equal(readKey({ type: "paseo/key", key: "k" }), undefined);
});

it("the frame fits its page between limits, and a viewport-sized page gets a fixed height", () => {
  assert.equal(frameHeight(412.2, false), 413);
  assert.equal(frameHeight(3, false), VISUAL_LIMITS.minHeight);
  assert.equal(frameHeight(1e6, false), VISUAL_LIMITS.maxHeight);
  assert.equal(frameHeight(900, true), VISUAL_LIMITS.fixedHeight);
  assert.ok(usesViewportHeight("<style>body{min-height:100vh}</style>"));
  assert.ok(usesViewportHeight('<div style="height: 50dvh"></div>'));
  assert.ok(!usesViewportHeight("<style>body{width:100vw}</style><p>1vh in prose</p>"));
  assert.ok(!usesViewportHeight("<!-- <style>a{height:1vh}</style> --><p></p>"));
});

it("the page's title names it", () => {
  assert.equal(titleOf("<title> Build  times &amp; sizes </title>"), "Build times & sizes");
  assert.equal(titleOf("<p>none</p>"), "");
  assert.equal(titleOf(`<title>${"x".repeat(300)}</title>`).length, VISUAL_LIMITS.title);
});

it("local images are found by absolute path and replaced where one was read", () => {
  const html =
    '<img src="/tmp/a b.png"><img src=\'/tmp/c.jpeg\'><i style="background:url(/tmp/d.webp)"></i>' +
    '<img src="https://x.test/e.png"><img src="//x.test/f.png"><img src="rel/g.png"><a href="/tmp/h.txt"></a>';
  const found = findLocalImages(html);
  assert.deepEqual(
    found.map((f) => f.path),
    ["/tmp/a b.png", "/tmp/c.jpeg", "/tmp/d.webp"],
  );
  const out = inlineImages(html, found, new Map([["/tmp/a b.png", "data:image/png;base64,AA"], ["/tmp/d.webp", "data:image/webp;base64,BB"]]));
  assert.ok(out.includes('<img src="data:image/png;base64,AA">'));
  assert.ok(out.includes("url(data:image/webp;base64,BB)"));
  assert.ok(out.includes("'/tmp/c.jpeg'"));
});

it("a streamed fence is closed only by its own closing fence", () => {
  assert.ok(fenceClosed("```html-render\n<p>x</p>\n```"));
  assert.ok(fenceClosed("````html-render\n```\n````\n"));
  assert.ok(!fenceClosed("```html-render\n<p>x</p>"));
  assert.ok(!fenceClosed("````html-render\n```"));
  assert.ok(!fenceClosed("```html-render"));
});

it("a reply's preview leaves its pages' HTML out", () => {
  assert.equal(
    withoutPages("```html-render\n<p>```</p>\n<b>x</b>\n```\n\nTwo are flaky.").trim(),
    "Two are flaky.",
  );
  assert.equal(withoutPages("Before.\n\n~~~html-render\n<p>half").trim(), "Before.");
  assert.equal(withoutPages("```html\n<p>kept</p>\n```"), "```html\n<p>kept</p>\n```");
});
