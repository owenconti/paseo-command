/** Standalone app helper. No Vite or globally installed Node is required. */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants, realpathSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import {
  resolve,
  sep,
  extname,
  isAbsolute,
  dirname,
  join,
  delimiter,
} from "node:path";
import { fileURLToPath } from "node:url";
import { attachApiServer } from "./api";
import { connector } from "./daemon";
import { errorCode } from "./errors";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
};
export function isNativeEntrypoint(moduleURL: string, entry = process.argv[1]) {
  try {
    return (
      !!entry &&
      realpathSync(fileURLToPath(moduleURL)) === realpathSync(resolve(entry))
    );
  } catch {
    return false;
  }
}
/** Finder does not inherit terminal PATH. Discover only executable CLI wrappers;
 * Paseo's installed wrapper supplies its own runtime and daemon discovery. */
export async function resolveNativeCli(
  options: {
    env?: NodeJS.ProcessEnv;
    home?: string;
    applicationDirs?: string[];
  } = {},
) {
  const env = options.env ?? process.env;
  if (env.PASEO_COMMAND_CLI) return env.PASEO_COMMAND_CLI;
  const home = options.home ?? homedir();
  const applications = options.applicationDirs ?? [
    join(home, "Applications"),
    "/Applications",
  ];
  const candidates = [
    ...applications.map((directory) =>
      join(directory, "Paseo.app/Contents/Resources/bin/paseo"),
    ),
    join(home, ".local/bin/paseo"),
    ...(env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => isAbsolute(directory))
      .map((directory) => join(directory, "paseo")),
  ];
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* Not installed here, or a dangling/non-executable wrapper. */
    }
  }
  throw new Error(
    "Paseo CLI was not found. Install Paseo in Applications and open it, then relaunch Paseo Command. For a custom installation, set PASEO_COMMAND_CLI to its executable.",
  );
}

export function validateNativeConfig(env = process.env) {
  const checkout = env.PASEO_COMMAND_CHECKOUT;
  const data = env.PASEO_COMMAND_DATA;
  if (!checkout || !isAbsolute(checkout) || !data || !isAbsolute(data))
    throw new Error(
      "Native helper requires absolute PASEO_COMMAND_CHECKOUT and PASEO_COMMAND_DATA paths.",
    );
  const port = Number(env.PASEO_NATIVE_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid native helper port.");
  const ownerPid = Number(env.PASEO_NATIVE_OWNER_PID ?? process.ppid);
  if (
    !Number.isSafeInteger(ownerPid) ||
    ownerPid <= 1 ||
    ownerPid === process.pid
  )
    throw new Error("Invalid owning app PID.");
  return {
    checkout,
    data,
    port,
    ownerPid,
    ui: resolve(
      env.PASEO_NATIVE_UI ?? fileURLToPath(new URL("../ui", import.meta.url)),
    ),
  };
}
export async function startNativeHelper(
  config = validateNativeConfig(),
  options: { connect?: typeof connector.create } = {},
) {
  const cli = await resolveNativeCli();
  await stat(config.checkout);
  if (!(await stat(join(config.ui, "index.html"))).isFile())
    throw new Error("Packaged UI index is missing.");
  process.chdir(config.checkout);
  process.env.PASEO_COMMAND_CLI = cli;
  process.env.PASEO_COMMAND_REPO = config.checkout;
  process.env.PASEO_COMMAND_DATA = config.data;
  process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`;
  let middleware: (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => void = (_req, _res, next) => next();
  let closing: Promise<void> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const http = createServer((req, res) => {
    const origin = `http://${req.headers.host}`;
    if (
      !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "") ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      res.writeHead(403);
      res.end("Local same-origin access only");
      return;
    }
    if (req.url === "/__native/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ready: true,
          pid: process.pid,
          ownerPid: config.ownerPid,
        }),
      );
      return;
    }
    middleware(req, res, () => {
      void serve(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(404);
        res.end("Not found");
      });
    });
  });
  async function serve(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const path = decodeURIComponent(
      new URL(req.url ?? "/", "http://127.0.0.1").pathname,
    );
    const root = await realpath(config.ui);
    let file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep))
      throw new Error("Traversal");
    if (path.endsWith("/") || (!extname(path) && !path.startsWith("/api/")))
      file = resolve(root, "index.html");
    file = await realpath(file);
    if (!file.startsWith(root + sep)) throw new Error("Symlink escape");
    const bytes = await readFile(file);
    res.setHeader(
      "Content-Type",
      MIME[extname(file)] ?? "application/octet-stream",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Cache-Control",
      extname(file) === ".html"
        ? "no-store"
        : "public, max-age=31536000, immutable",
    );
    res.end(req.method === "HEAD" ? undefined : bytes);
  }
  // Bind first: an origin conflict must not touch an incumbent.
  await new Promise<void>((yes, no) => {
    http.once("error", no);
    http.listen(config.port, "127.0.0.1", () => {
      http.off("error", no);
      yes();
    });
  });
  const originalConnector = connector.create;
  if (options.connect) connector.create = options.connect;
  const host = {
    httpServer: http,
    middlewares: {
      use: (fn: typeof middleware) => {
        middleware = fn;
      },
    },
  };
  const cleanup = attachApiServer(host);
  const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const close = () =>
    (closing ??= (async () => {
      if (watchdog) clearInterval(watchdog);
      let cleanupFailure: unknown;
      try {
        await cleanup();
      } catch (error) {
        cleanupFailure = error;
      }
      http.closeIdleConnections();
      await new Promise<void>((done) => http.close(() => done()));
      if (options.connect && connector.create === options.connect)
        connector.create = originalConnector;
      if (cleanupFailure) throw cleanupFailure;
    })());
  const orphaned = () =>
    void close().then(
      () => process.exit(0),
      (error) => {
        console.error(
          JSON.stringify({ event: "shutdown-error", error: String(error) }),
        );
        process.exit(1);
      },
    );
  const ownerWasParent = process.ppid === config.ownerPid;
  watchdog = setInterval(() => {
    if (ownerWasParent && process.ppid !== config.ownerPid) {
      orphaned();
      return;
    }
    try {
      process.kill(config.ownerPid, 0);
    } catch (error) {
      if (errorCode(error) === "ESRCH") orphaned();
    }
  }, 1000);
  watchdog.unref();
  return { origin, close, http };
}
if (isNativeEntrypoint(import.meta.url)) {
  startNativeHelper().then(
    (helper) => {
      console.log(
        JSON.stringify({
          event: "ready",
          origin: helper.origin,
          pid: process.pid,
          ownerPid: Number(process.env.PASEO_NATIVE_OWNER_PID ?? process.ppid),
        }),
      );
      let exiting = false;
      for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
        process.on(signal, () => {
          if (exiting) return;
          exiting = true;
          const deadline = setTimeout(() => {
            console.error(JSON.stringify({ event: "shutdown-timeout" }));
            process.exit(1);
          }, 120000);
          deadline.unref();
          void helper.close().then(
            () => process.exit(0),
            (error) => {
              console.error(error);
              process.exit(1);
            },
          );
        });
    },
    (error) => {
      console.error(
        JSON.stringify({
          event: "startup-error",
          error:
            error?.code === "EADDRINUSE"
              ? "Origin already in use; close the existing app server before launching. No process was stopped."
              : String(error),
        }),
      );
      process.exitCode = 1;
    },
  );
}
