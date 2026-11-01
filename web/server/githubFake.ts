/**
 * A fake GitHub API for tests: `installGithubApi(handler)` enables GitHub in
 * the test settings file, writes a fake `githubToken` to the test
 * secrets.json, and answers every request `githubApi.ts` makes with
 * `handler`; `restore()` puts the files and the fetch back. Requests are
 * recorded in `calls`. Nothing reaches GitHub.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GITHUB_API } from "./githubApi";
import { secretsFile } from "./secrets";
import { settingsFile } from "./settings";

export const FAKE_GITHUB_TOKEN = "ghp_fakeTestToken000000000000000000000000";

export type FakeRequest = {
  method: string;
  /** The API path without the host or query, e.g. `repos/o/r/pulls/1/reviews` or `graphql`. */
  path: string;
  query: URLSearchParams;
  accept: string;
  authorization: string;
  /** The parsed JSON body, if any. */
  body: unknown;
};
export type FakeAnswer = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };

const snapshot = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : undefined);
const put = (file: string, was: string | undefined) => {
  if (was === undefined) rmSync(file, { force: true });
  else writeFileSync(file, was);
};

export function installGithubApi(handler: (req: FakeRequest) => FakeAnswer | Promise<FakeAnswer>, opts: { enabled?: boolean; token?: string | null } = {}) {
  const secrets = secretsFile();
  const settings = settingsFile();
  const hadSecrets = snapshot(secrets);
  const hadSettings = snapshot(settings);
  const json = (text: string | undefined) => {
    try {
      const v = text ? JSON.parse(text) : {};
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const keptSettings = json(hadSettings);
  mkdirSync(dirname(settings), { recursive: true });
  writeFileSync(
    settings,
    JSON.stringify({ ...keptSettings, integrations: { ...(keptSettings.integrations as object), github: opts.enabled ?? true } }),
  );
  const keptSecrets = json(hadSecrets);
  delete keptSecrets.githubToken;
  mkdirSync(dirname(secrets), { recursive: true });
  writeFileSync(secrets, JSON.stringify(opts.token === null ? keptSecrets : { ...keptSecrets, githubToken: opts.token ?? FAKE_GITHUB_TOKEN }));

  const calls: FakeRequest[] = [];
  const was = GITHUB_API.fetch;
  GITHUB_API.fetch = async (url, init) => {
    const u = new URL(url);
    const headers = new Headers(init.headers);
    const req: FakeRequest = {
      method: init.method ?? "GET",
      path: u.pathname.replace(/^\//, ""),
      query: u.searchParams,
      accept: headers.get("accept") ?? "",
      authorization: headers.get("authorization") ?? "",
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(req);
    const answer = await handler(req);
    const status = answer.status ?? 200;
    const body = answer.text ?? (answer.json === undefined ? "" : JSON.stringify(answer.json));
    return new Response([204, 205, 304].includes(status) ? null : body, { status, headers: { "x-oauth-scopes": "repo, notifications, read:org", ...answer.headers } });
  };
  return {
    calls,
    restore() {
      GITHUB_API.fetch = was;
      put(secrets, hadSecrets);
      put(settings, hadSettings);
    },
  };
}
