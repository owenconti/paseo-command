/**
 * Screen captures (the macOS app's ⌃⌥⇧S, `native/Sources/PaseoCommandNative/Capture*.swift`): the app records the
 * display while you draw on it, then writes a bundle into the data folder's `captures/<id>/`: `recording.mp4`, the
 * keyframes (`frames/frame-NN.png`, at each stroke's end and click), a numbered `contact-sheet.png` of them,
 * `capture.gif` once it's made, and `capture.json` (this module's `CaptureManifest`).
 *
 * `GET /api/captures` (the newest), `GET /api/captures/:id` (its manifest), `GET /api/captures/:id/sheet` (the
 * contact sheet's PNG), `GET /api/captures/:id/draft?host=` (a new agent's first message and image for it, on that
 * host), `POST /api/captures/:id/send {agent, message, behavior}` (to an agent). What an agent gets
 * (`captureMessage`): your message, a block naming the keyframes, and for an agent on this Mac the bundle's paths
 * (the video, the full-size frames, the GIF) with how to pull frames from the video with ffmpeg; the contact
 * sheet goes as an image. Agents elsewhere can't read this Mac's files, so they get the image and the text alone.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { agentIdParts } from "../src/agentIdentity";
import { dataDir } from "./subagentArchive";
import { LIMITS } from "./daemon";

export const capturesDir = () => join(dataDir(), "captures");

/** A capture's id, as the app names its folder: `cap-<yyyymmdd>-<hhmmss>`, maybe with a `-n` suffix. */
const CAPTURE_ID = /^cap-\d{8}-\d{6}(-\d{1,3})?$/;

export type CaptureFrame = {
  /** Its number on the contact sheet, from 1. */
  n: number;
  /** Seconds into the recording. */
  t: number;
  /** `frames/frame-NN.png`, inside the bundle. */
  file: string;
  /** What happened then: "marked" (a stroke ended), "clicked", "start", "end". */
  reasons: string[];
};
export type CaptureManifest = {
  id: string;
  /** ISO time the recording started. */
  created: string;
  /** Seconds. */
  duration: number;
  /** The app in front when it started, if known. */
  app?: string;
  /** The display recorded, in pixels. */
  width: number;
  height: number;
  frames: CaptureFrame[];
  strokes: number;
  clicks: number;
  video: string;
  sheet: string;
  gif?: string;
};

export function validCaptureId(raw: unknown): string {
  if (typeof raw !== "string" || !CAPTURE_ID.test(raw)) throw new Error("Unknown capture");
  return raw;
}

const num = (v: unknown, min = 0) => (typeof v === "number" && Number.isFinite(v) && v >= min ? v : undefined);
const str = (v: unknown, max = 200) => (typeof v === "string" && v.length <= max ? v : undefined);
/** Only names the app writes inside the bundle: never a path out of it. */
const inside = (v: unknown, pattern: RegExp) => (typeof v === "string" && pattern.test(v) ? v : undefined);

/** A bundle's `capture.json`, checked field by field (it's the app's, but read as untrusted). */
export function readManifest(id: string): CaptureManifest | undefined {
  const dir = join(capturesDir(), validCaptureId(id));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8"));
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  const frames = (Array.isArray(m.frames) ? m.frames : []).flatMap((f): CaptureFrame[] => {
    if (!f || typeof f !== "object") return [];
    const r = f as Record<string, unknown>;
    const n = num(r.n, 1);
    const t = num(r.t);
    const file = inside(r.file, /^frames\/frame-\d{2,3}\.png$/);
    if (n === undefined || t === undefined || !file) return [];
    const reasons = (Array.isArray(r.reasons) ? r.reasons : []).filter(
      (x): x is string => typeof x === "string" && /^(marked|clicked|start|end)$/.test(x),
    );
    return [{ n, t, file, reasons }];
  });
  const gif = inside(m.gif, /^capture\.gif$/);
  return {
    id,
    created: str(m.created, 40) ?? "",
    duration: num(m.duration) ?? 0,
    ...(str(m.app) ? { app: str(m.app) } : {}),
    width: num(m.width) ?? 0,
    height: num(m.height) ?? 0,
    frames,
    strokes: num(m.strokes) ?? 0,
    clicks: num(m.clicks) ?? 0,
    video: inside(m.video, /^recording\.mp4$/) ?? "recording.mp4",
    sheet: inside(m.sheet, /^contact-sheet\.png$/) ?? "contact-sheet.png",
    // Named only once the file is there (the app writes it after the panel opens).
    ...(gif && existsSync(join(dir, gif)) ? { gif } : {}),
  };
}

/** The newest captures first, at most `limit`. */
export function listCaptures(limit = 20): CaptureManifest[] {
  let names: string[];
  try {
    names = readdirSync(capturesDir()).filter((n) => CAPTURE_ID.test(n));
  } catch {
    return [];
  }
  return names
    .sort()
    .reverse()
    .slice(0, limit)
    .flatMap((n) => readManifest(n) ?? []);
}

/** `0:07`, `1:02:03`. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const REASON: Record<string, string> = { marked: "marked", clicked: "clicked", start: "start", end: "end" };

/**
 * What an agent reads with the contact sheet: your message, then the capture's block. `local`: the agent runs on
 * this Mac, so it can open the bundle's files (named by absolute path) and cut frames from the video.
 */
export function captureMessage(m: CaptureManifest, message: string, dir: string, local: boolean): string {
  const head = `[Screen capture ${clock(m.duration)}${m.app ? ` · ${m.app}` : ""}${local ? ` · ${dir}` : ""}]`;
  const lines = [
    head,
    "The attached contact sheet shows the capture's keyframes in time order (left to right, top to bottom), each numbered in a white chip in a top corner. Red strokes are marks the user drew while recording; a red ring is a click.",
    ...m.frames.map((f) => {
      const what = f.reasons.filter((r) => r !== "start" && r !== "end").map((r) => REASON[r]);
      return `- #${f.n} (${clock(f.t)})${what.length ? ` ${what.join(", ")}` : f.reasons.includes("end") ? " last frame" : ""}`;
    }),
  ];
  if (local) {
    const video = join(dir, m.video);
    lines.push(
      `Full-size frames: ${join(dir, "frames")}/frame-NN.png (frame-03.png is #3). Video: ${video}${m.gif ? ` · GIF: ${join(dir, m.gif)}` : ""}`,
      `For motion or a moment between keyframes, pull frames from the video and look at them, e.g. \`ffmpeg -loglevel error -ss 6 -t 2 -i "${video}" -vf "fps=6,scale=960:-1,tile=4x3" /tmp/capture-0-06.png\` (2 s from 0:06 as one sheet).`,
    );
  } else lines.push("The full-size frames and the video stay on the Mac that recorded them.");
  const text = message.trim();
  return text ? `${text}\n\n${lines.join("\n")}` : lines.join("\n");
}

function sheetImage(id: string, m: CaptureManifest) {
  const bytes = readFileSync(join(capturesDir(), id, m.sheet));
  if (bytes.length > LIMITS.imageBytes) throw new Error("The contact sheet is too large to send");
  return { data: bytes.toString("base64"), mimeType: "image/png" };
}

const MAX_MESSAGE = 100_000;

/** A capture's text and image for an agent on `host` (undefined: this Mac). */
export function captureDraft(id: string, message: unknown, local: boolean) {
  const m = readManifest(validCaptureId(id));
  if (!m) throw new Error("Unknown capture");
  const text = typeof message === "string" ? message : "";
  if (text.length > MAX_MESSAGE || text.includes("\0")) throw new Error("Invalid message");
  return { manifest: m, prompt: captureMessage(m, text, join(capturesDir(), id), local), image: sheetImage(id, m) };
}

/**
 * `POST /api/captures/:id/send {agent, message, behavior?}`: the capture to an agent, through the composer's own
 * send (`send`, `agentCommand("send", …)`), on the agent's host.
 */
export async function sendCapture(
  id: string,
  body: Record<string, unknown>,
  send: (agentId: string, body: Record<string, unknown>) => Promise<unknown>,
) {
  if (typeof body.agent !== "string" || !body.agent) throw new Error("Choose an agent");
  const { id: agentId, host } = agentIdParts(body.agent);
  const draft = captureDraft(id, body.message, !host);
  return send(agentId, {
    prompt: draft.prompt,
    images: [draft.image],
    ...(host ? { host } : {}),
    ...(body.behavior === "steer" || body.behavior === "interrupt" ? { behavior: body.behavior } : {}),
  });
}

/** The GETs (before the daemon is involved: these are this Mac's files). */
export function capturesGet(url: URL, res: ServerResponse, reply: (status: number, body: unknown) => void) {
  const parts = url.pathname.split("/").filter(Boolean).slice(2);
  try {
    if (parts.length === 0) return reply(200, { captures: listCaptures() });
    const id = validCaptureId(parts[0]);
    const m = readManifest(id);
    if (!m) return reply(404, { error: "Unknown capture" });
    if (parts.length === 1) return reply(200, m);
    if (parts.length === 2 && parts[1] === "sheet") {
      const file = join(capturesDir(), id, m.sheet);
      if (!existsSync(file) || statSync(file).size > LIMITS.imageBytes) return reply(404, { error: "Not found" });
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.end(readFileSync(file));
    }
    if (parts.length === 2 && parts[1] === "draft") {
      const local = !url.searchParams.get("host");
      const { prompt, image } = captureDraft(id, url.searchParams.get("message") ?? "", local);
      return reply(200, { prompt, image: { name: "contact-sheet.png", ...image } });
    }
    return reply(404, { error: "Unknown endpoint" });
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : "Invalid request" });
  }
}

export function isCapturesPath(path: string) {
  return path === "/api/captures" || path.startsWith("/api/captures/");
}
