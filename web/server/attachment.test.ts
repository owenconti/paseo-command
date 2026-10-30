import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readAttachmentImage, rememberTimelineImages } from "./attachment";
import type { TimelineItem } from "../src/transcript";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const reply = (text: string, id = "1"): TimelineItem => ({
  kind: "assistant",
  id,
  text,
});

test("generated transcript previews load only after a local reference is observed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-image-test-"));
  try {
    const path = join(dir, "contact sheet (18 slides).png");
    await writeFile(path, PNG);
    assert.equal(await readAttachmentImage(path, 1024), null);
    const rows = [reply(`![Image](${pathToFileURL(path).href})`)];
    rememberTimelineImages(rows, false);
    assert.equal(
      await readAttachmentImage(path, 1024),
      null,
      "remote paths never grant local access",
    );
    rememberTimelineImages(rows, true);
    assert.deepEqual(await readAttachmentImage(path, 1024), PNG);
    assert.equal(
      await readAttachmentImage(path, 10),
      null,
      "size limit still applies",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a streamed reference split across adjacent reply chunks is recognized", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-image-test-"));
  try {
    const path = join(dir, "preview.png");
    await writeFile(path, PNG);
    rememberTimelineImages(
      [reply("![Image](file:///"), reply(`${path.slice(1)})`, "2")],
      true,
    );
    assert.deepEqual(await readAttachmentImage(path, 1024), PNG);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prompt attachments still load without a transcript reference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-image-test-"));
  try {
    const attachments = join(dir, "paseo-attachments-test");
    await mkdir(attachments);
    const path = join(attachments, `${"a".repeat(64)}.png`);
    await writeFile(path, PNG);
    assert.deepEqual(await readAttachmentImage(path, 1024), PNG);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("references cannot expose non-images, SVG, or unrelated files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-image-test-"));
  try {
    for (const name of ["fake.png", "secret.txt", "drawing.svg"]) {
      const path = join(dir, name);
      await writeFile(path, "<svg>not raster image bytes</svg>");
      rememberTimelineImages([reply(`![Image](<${path}>)`)], true);
      assert.equal(await readAttachmentImage(path, 1024), null);
    }
    const path = join(dir, "unrelated.png");
    await writeFile(path, PNG);
    rememberTimelineImages(
      [
        {
          kind: "tool",
          id: "t",
          name: "shell",
          status: "completed",
          summary: "",
          detail: `![Image](${path})`,
        },
      ],
      true,
    );
    assert.equal(await readAttachmentImage(path, 1024), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
