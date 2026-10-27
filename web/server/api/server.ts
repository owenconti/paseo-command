// ── Attaching the API to a dev, preview or native server ───────────────────
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Plugin } from "vite";
import { withdrawAll } from "../daemon";
import { stopLive } from "../live";
import {
  admissionClosed,
  closeAdmission,
  lastHost,
  releaseCleanup,
  retainCleanup,
  stopAll,
} from "../proc";
import { unfollow } from "./hosts";
import { shuttingDown } from "./http";
import { handleApi } from "./routes";
import { handleUpgrade } from "./stream";

type ApiServer = {
  close?: () => Promise<void>;
  httpServer?: {
    once(event: "close", listener: () => void): unknown;
    on?(
      event: "upgrade",
      listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
    ): unknown;
  } | null;
  middlewares: {
    use(
      handler: (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void,
      ) => void,
    ): unknown;
  };
};
export function attachApiServer(server: ApiServer) {
  // A server that is closing admits no new API work (503), so nothing can
  // start a CLI call after its cleanup has begun. Push streams and daemon
  // subscriptions end first (an open stream would hold the server open), then
  // CLI process groups are stopped inside the server's own close, which Vite
  // awaits whether it's shutting down the dev or preview server (SIGTERM, a
  // Ctrl-C shortcut) or restarting for a config change. Closing the last
  // server ends the app: the whole process stops admitting CLI work and every
  // group is drained. The httpServer's close event backs that up; the process
  // handlers are installed once, and the exit safeguard stays until the
  // process ends.

  let closing = false;
  retainCleanup(server);
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () =>
    (shutdownPromise ??= (async () => {
      closing = true;
      const last = lastHost(server);
      if (last) closeAdmission();
      stopLive();
      unfollow();
      // Connections being made are abandoned and their waiters refused, so
      // nothing reaches a daemon once the server has closed.
      await Promise.all([withdrawAll(), stopAll({ drain: last })]);
    })());
  const close = server.close?.bind(server);
  if (close)
    server.close = async () => {
      await shutdown();
      await close();
    };
  server.httpServer?.once("close", () => {
    void shutdown().then(
      () => releaseCleanup(server),
      () => releaseCleanup(server),
    );
  });
  // The tab's WebSocket shares the server (Vite's own HMR socket uses a
  // different path and protocol).
  server.httpServer?.on?.("upgrade", (req, socket, head) => {
    if (!(req.url || "").startsWith("/api/ws")) return;
    if (closing || admissionClosed()) {
      socket.write(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return socket.destroy();
    }
    handleUpgrade(req, socket, head);
  });
  server.middlewares.use(
    (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      // Local: this server is closing (a config restart). Global: the
      // process is shutting down (a signal, or the last server closing),
      // which no server-local flag may miss. Either way, no route runs:
      // not cached reads, not streams, not SDK commands.
      if ((closing || admissionClosed()) && (req.url || "").startsWith("/api/"))
        return shuttingDown(res);
      void handleApi(req, res, next);
    },
  );
  return shutdown;
}
export function apiPlugin(): Plugin {
  return {
    name: "paseo-local-api",
    configureServer(server) {
      attachApiServer(server);
    },
    configurePreviewServer(server) {
      attachApiServer(server);
    },
  };
}
