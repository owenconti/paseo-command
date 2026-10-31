import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentKind, linearFileLinks, looksLikeImage, sizeText, uploadHref, uploadMarkdown, uploadSubtitle } from "./files";

const UP = "https://uploads.linear.app/ws/abc/shot%20one.png";

test("linear files: images by name or address, sizes, subtitles", () => {
  assert.ok(looksLikeImage("shot.PNG"));
  assert.ok(looksLikeImage(UP));
  assert.ok(!looksLikeImage("notes.pdf"));
  assert.deepEqual([sizeText(900), sizeText(120 * 1024), sizeText(4.2 * 1024 * 1024), sizeText(3 * 1024 * 1024)], [
    "900 B",
    "120 KB",
    "4.2 MB",
    "3 MB",
  ]);
  assert.equal(uploadSubtitle({ name: "a.png", contentType: "image/png", size: 2048 }), "PNG · 2 KB");
  assert.equal(uploadSubtitle({ name: "README", contentType: "text/plain", size: 10 }), "PLAIN · 10 B");
});

test("linear files: an upload as Markdown, an image showing and a file linked, its name escaped", () => {
  assert.equal(uploadMarkdown({ url: UP, name: "shot one.png", contentType: "image/png" }), `![shot one.png](${UP})`);
  assert.equal(
    uploadMarkdown({ url: "https://uploads.linear.app/ws/x/a(1).pdf", name: "a [1].pdf", contentType: "application/pdf" }),
    "[a \\[1\\].pdf](https://uploads.linear.app/ws/x/a%281%29.pdf)",
  );
});

test("linear files: where an upload loads, and what each attachment is", () => {
  assert.equal(uploadHref(UP, "http://127.0.0.1:4310", true), `http://127.0.0.1:4310/api/linear/image?url=${encodeURIComponent(UP)}`);
  assert.equal(uploadHref(UP, "", false), `/api/linear/file?url=${encodeURIComponent(UP)}`);
  assert.equal(attachmentKind({ url: UP, title: "x" }), "image");
  assert.equal(attachmentKind({ url: "https://uploads.linear.app/ws/x/report.pdf", title: "Report" }), "file");
  assert.equal(attachmentKind({ url: "https://github.com/o/r/pull/12", title: "PR" }), "github");
  assert.equal(attachmentKind({ url: "https://example.com", title: "Doc", sourceType: "github" }), "github");
  assert.equal(attachmentKind({ url: "https://example.com/doc", title: "Doc" }), "link");
});

test("linear files: links to uploads go through the app server; embedded images and other links stay", () => {
  const pdf = "https://uploads.linear.app/ws/x/report.pdf";
  const o = "http://127.0.0.1:4310";
  assert.equal(
    linearFileLinks(`See [the report](${pdf}), [shot](<${UP}>), ![inline](${UP}) and [elsewhere](https://example.com/a.pdf).`, o),
    `See [the report](${o}/api/linear/file?url=${encodeURIComponent(pdf)}), [shot](${o}/api/linear/image?url=${encodeURIComponent(UP)}), ![inline](${UP}) and [elsewhere](https://example.com/a.pdf).`,
  );
  assert.equal(linearFileLinks(`[a](${pdf})`, o), `[a](${o}/api/linear/file?url=${encodeURIComponent(pdf)})`);
});
