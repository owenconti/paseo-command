/**
 * The page's `/api/linear/…` requests answered by the real server route
 * (`linearRoute`) in the test process, over the fake Linear (`fake.ts`): e2e
 * runs the server's reads, validation and normalising, and nothing reaches
 * Linear. `/api/linear/image` falls through to the test's own route.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Page } from "playwright";
import { replier } from "../server/api/http";
import { fakeWorkspace, installFakeLinear, type FakeLinear, type FakeWorkspace } from "../server/linear/fake";
import { resetLinearReads } from "../server/linear/reads";
import { linearRoute } from "../server/linear/route";

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
  end(chunk?: string | Buffer) {
    if (chunk !== undefined) this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.finish();
    return this;
  }
}

/** Answers the page's Linear requests from `ws` (the sample workspace by default); `restore` puts Linear's fetch back. */
export async function mockLinear(
  page: Page,
  ws: FakeWorkspace = fakeWorkspace(),
): Promise<{ ws: FakeWorkspace; requests: FakeLinear["requests"]; restore: () => void }> {
  const fake = installFakeLinear(ws);
  resetLinearReads();
  await page.route("**/api/linear/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/linear/image") return route.fallback();
    const body = request.postDataBuffer();
    const req = Object.assign(Readable.from(body ? [body] : []), {
      method: request.method(),
      url: url.pathname + url.search,
      headers: { ...(await request.allHeaders()), host: url.host },
    }) as unknown as IncomingMessage;
    const res = new Captured();
    const out = res as unknown as ServerResponse;
    await linearRoute(req, url, out, replier(out));
    await res.done;
    await route
      .fulfill({
        status: res.statusCode,
        headers: { "content-type": "application/json", ...res.headers },
        body: res.body,
      })
      .catch(() => {});
  });
  return { ws: fake.ws, requests: fake.requests, restore: fake.restore };
}
