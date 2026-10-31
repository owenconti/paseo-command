/**
 * The page's `/api/slack/…` requests answered by the real server route
 * (`slackRoute`) in the test process, over the fake Slack (`server/slack/fake.ts`):
 * e2e runs the server's reads, writes, validation and normalising, and nothing
 * reaches Slack. The event stream answers its first (`live`) event and ends, so
 * the page reconnects and polls as it would without Socket Mode.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Page } from "playwright";
import { replier } from "../server/api/http";
import { fakeWorkspace, installFakeSlack, type FakeSlack, type FakeWorkspace } from "../server/slack/fake";
import { slackRoute } from "../server/slack/route";

/** What a route writes, kept for `route.fulfill`. */
class Captured {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = Buffer.alloc(0);
  done!: Promise<void>;
  private finish!: () => void;
  constructor() {
    this.done = new Promise((resolve) => (this.finish = resolve));
  }
  setHeader(name: string, value: string | number) {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }
  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers ?? {})) this.setHeader(k, v);
    return this;
  }
  flushHeaders() {}
  /** What runs once the page has its answer (a stream's listeners and pings stop). */
  closers: (() => void)[] = [];
  on(event: string, run: () => void) {
    if (event === "close") this.closers.push(run);
    return this;
  }
  once(event: string, run: () => void) {
    return this.on(event, run);
  }
  off() {
    return this;
  }
  write(chunk: string | Buffer) {
    this.body = Buffer.concat([this.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    // A stream's first event is all the page needs here.
    if (this.headers["content-type"]?.startsWith("text/event-stream") && this.body.includes("data:")) this.finish();
    return true;
  }
  end(chunk?: string | Buffer) {
    if (chunk !== undefined) this.body = Buffer.concat([this.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    this.finish();
    return this;
  }
}

/** Answers the page's Slack requests from `ws` (the sample workspace by default); `restore` puts Slack back. */
export async function mockSlack(page: Page, ws: FakeWorkspace = fakeWorkspace()): Promise<FakeSlack> {
  const fake = installFakeSlack(ws);
  await page.route("**/api/slack/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataBuffer();
    const res = new Captured();
    const stream = Readable.from(body ? [body] : []);
    // "close" also runs once the page has its answer (an event stream stops); the body's own events stay the stream's.
    const on = stream.on.bind(stream);
    const once = stream.once.bind(stream);
    const req = Object.assign(stream, {
      method: request.method(),
      url: url.pathname + url.search,
      headers: { ...(await request.allHeaders()), host: url.host },
      on: (event: string, run: (...args: unknown[]) => void) => (event === "close" && res.on(event, run), on(event, run), req),
      once: (event: string, run: (...args: unknown[]) => void) => (event === "close" && res.on(event, run), once(event, run), req),
      socket: { setTimeout() {}, setNoDelay() {}, setKeepAlive() {} },
    }) as unknown as IncomingMessage;
    const out = res as unknown as ServerResponse;
    await slackRoute(req, url, out, replier(out));
    await res.done;
    for (const close of res.closers) close();
    await route
      .fulfill({
        status: res.statusCode,
        headers: { "content-type": "application/json", ...res.headers },
        body: res.body,
      })
      .catch(() => {});
  });
  return fake;
}
