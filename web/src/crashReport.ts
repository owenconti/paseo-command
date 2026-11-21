/**
 * The page's crashes, kept where they can be read later: the console, and in the macOS app its own log
 * (`logs/native.log`, "page: …", through `postAppLog`). `CrashBoundary` reports what it catches; `installCrashReports`
 * reports errors nothing caught. At most `CRASH_REPORTS.perMinute` a minute, so a loop can't flood the log.
 */
import { postAppLog } from "./worldBridge";

export const CRASH_REPORTS = { perMinute: 20, lines: 12 };
let sent: number[] = [];

const lines = (text: string | undefined, n = CRASH_REPORTS.lines) =>
  (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, n).join("\n  ");

/** The report's text: where, the error's message and its first stack lines, and React's component stack. */
export function crashText(where: string, error: unknown, componentStack?: string) {
  const e = error instanceof Error ? error : undefined;
  const message = e ? `${e.name}: ${e.message}` : String(error);
  const stack = e?.stack ? `\n  ${lines(e.stack.replace(message, ""))}` : "";
  const components = componentStack ? `\n  components:\n  ${lines(componentStack, 8)}` : "";
  return `crash in ${where}: ${message}${stack}${components}`.slice(0, 4000);
}

export function reportCrash(where: string, error: unknown, componentStack?: string) {
  const text = crashText(where, error, componentStack);
  console.error(text);
  const now = Date.now();
  sent = sent.filter((t) => now - t < 60_000);
  if (sent.length >= CRASH_REPORTS.perMinute) return;
  sent.push(now);
  postAppLog(text);
}

/** What no boundary caught: errors thrown outside React and promises nobody handled. */
export function installCrashReports() {
  window.addEventListener("error", (e) => reportCrash("the page", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportCrash("the page (a promise)", e.reason));
}

/** A module that couldn't be loaded: most often the app was rebuilt under a page still running the old build. */
export const isChunkLoadError = (error: unknown) =>
  error instanceof Error &&
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(error.message);
