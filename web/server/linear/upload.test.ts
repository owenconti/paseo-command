import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, test } from "node:test";
import { resetLinearClient } from "./client";
import { installFakeLinear, type FakeLinear } from "./fake";
import { resetLinearReads } from "./reads";
import { linearRoute } from "./route";
import { LINEAR_UPLOAD, uploadName, uploadType } from "./upload";

let fake: FakeLinear;
beforeEach(() => {
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
});
afterEach(() => fake.restore());

/** What the route answers: a JSON reply, or the bytes and headers it wrote. */
async function call(path: string, method = "GET", body?: Buffer, type = "application/octet-stream") {
  const headers: Record<string, string> = {};
  let json: { status: number; body: any } | undefined;
  let raw: Buffer | undefined;
  const res = {
    statusCode: 0,
    setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v),
    end: (b: Buffer) => void (raw = b),
  } as unknown as ServerResponse;
  const req = Object.assign(Readable.from(body ? [body] : []), { method, headers: { "content-type": type } }) as unknown as IncomingMessage;
  await linearRoute(req, new URL(path, "http://localhost"), res, (status, b) => (json = { status, body: b }));
  return { json, raw, headers, status: json?.status ?? (res as unknown as { statusCode: number }).statusCode };
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

test("uploads a file to Linear and answers its address, which then loads only through the server", async () => {
  const sent = await call("/api/linear/upload?name=shot.png&type=image%2Fpng", "POST", PNG);
  assert.equal(sent.status, 200, JSON.stringify(sent.json?.body));
  const { url, name, contentType, size } = sent.json!.body;
  assert.match(url, /^https:\/\/uploads\.linear\.app\/fake\/.+\/shot\.png$/);
  assert.deepEqual([name, contentType, size], ["shot.png", "image/png", PNG.length]);
  assert.deepEqual(fake.uploads.get(url)?.bytes, PNG);
  const asked = fake.requests.find((r) => r.operation === "FileUpload")!.variables;
  assert.deepEqual(asked, { contentType: "image/png", filename: "shot.png", size: PNG.length });

  // An image through the image route; any file through the file route, as a download.
  const image = await call(`/api/linear/image?url=${encodeURIComponent(url)}`);
  assert.equal(image.headers["content-type"], "image/png");
  assert.deepEqual(image.raw, PNG);
  const file = await call(`/api/linear/file?url=${encodeURIComponent(url)}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers["content-type"], "application/octet-stream");
  assert.equal(file.headers["x-content-type-options"], "nosniff");
  assert.equal(file.headers["content-disposition"], "attachment; filename*=UTF-8''shot.png");
  assert.deepEqual(file.raw, PNG);
  assert.equal((await call("/api/linear/file?url=https%3A%2F%2Fexample.com%2Fa.pdf")).status, 400);
  assert.equal((await call(`/api/linear/file?url=${encodeURIComponent(url)}&x=1`)).status, 400);
});

test("refuses uploads that aren't file bytes, are empty or too large, or carry other parameters", async () => {
  assert.equal((await call("/api/linear/upload?name=a.txt", "POST", Buffer.from("{}"), "application/json")).status, 415);
  assert.equal((await call("/api/linear/upload?name=a.txt", "POST", Buffer.alloc(0))).status, 400);
  assert.equal((await call("/api/linear/upload?name=a.txt", "POST", Buffer.alloc(LINEAR_UPLOAD.maxBytes + 1))).status, 413);
  assert.equal((await call("/api/linear/upload?name=a.txt&x=1", "POST", Buffer.from("hi"))).status, 400);
  assert.equal((await call("/api/linear/upload?name=a.txt", "GET")).status, 404);
  assert.equal(fake.requests.length, 0);
});

test("a refused upload says why", async () => {
  fake.fail("FileUpload", { message: "Uploads are off", type: "InvalidInput" });
  const refused = await call("/api/linear/upload?name=a.txt&type=text%2Fplain", "POST", Buffer.from("hi"));
  assert.equal(refused.status, 400);
  assert.equal(refused.json?.body.error, "Uploads are off");
});

test("names and types files safely", () => {
  assert.equal(uploadName("../../etc/passwd"), "passwd");
  assert.equal(uploadName("C:\\Users\\me\\shot.png"), "shot.png");
  assert.equal(uploadName("a\u0000b\nc.txt"), "abc.txt");
  assert.equal(uploadName(".."), "file");
  assert.equal(uploadName(""), "file");
  assert.equal(uploadName("x".repeat(300)).length, 200);
  assert.equal(uploadType("Image/PNG"), "image/png");
  assert.equal(uploadType("text/html; charset=utf-8"), "application/octet-stream");
  assert.equal(uploadType(""), "application/octet-stream");
});
