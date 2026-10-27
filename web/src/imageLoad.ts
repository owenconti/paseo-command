/**
 * Bounded image loading for Markdown thumbnails.
 *
 * Bytes are fetched with credentials omitted (no cookies, also across
 * redirects and for same-origin URLs) and no referrer, under a byte budget
 * and a timeout. The format and dimensions are read from the file header
 * before anything is decoded, so an oversized or disguised file is refused
 * instead of handed to the browser's decoder. The result is a Blob of a
 * known raster type, shown through an internal blob: URL.
 */
export type ImageType = "png" | "jpeg" | "gif" | "webp";
export type ImageHeader = { type: ImageType; width: number; height: number };
export type Budget = {
  bytes: number;
  pixels: number;
  side: number;
  timeoutMs: number;
};

export const REMOTE_BUDGET: Budget = {
  bytes: 10 * 1024 * 1024,
  pixels: 40_000_000,
  side: 16384,
  timeoutMs: 15000,
};
/** The attachment route already caps files at 20 MB. */
export const LOCAL_BUDGET: Budget = {
  ...REMOTE_BUDGET,
  bytes: 20 * 1024 * 1024,
};

export type FailReason =
  | "network"
  | "status"
  | "too-large"
  | "too-many-pixels"
  | "not-an-image"
  | "timeout";

export class ImageLoadError extends Error {
  constructor(readonly reason: FailReason) {
    super(reason);
  }
}

export const FAIL_TEXT: Record<FailReason, string> = {
  network: "Couldn't load image",
  status: "Couldn't load image",
  "too-large": "Image is too large to show",
  "too-many-pixels": "Image dimensions are too large to show",
  "not-an-image": "Not a supported image",
  timeout: "Image took too long to load",
};

const MIME: Record<ImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function loadImage(
  url: string,
  budget: Budget,
  signal: AbortSignal,
  doFetch: typeof fetch = fetch,
): Promise<{ blob: Blob; header: ImageHeader }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, budget.timeoutMs);
  const forward = () => controller.abort();
  signal.addEventListener("abort", forward);
  if (signal.aborted) controller.abort();
  let done = false;
  try {
    let res: Response;
    try {
      res = await doFetch(url, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        mode: "cors",
        redirect: "follow",
        signal: controller.signal,
      });
    } catch {
      throw new ImageLoadError(timedOut ? "timeout" : "network");
    }
    if (!res.ok) throw new ImageLoadError("status");
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > budget.bytes)
      throw new ImageLoadError("too-large");
    const bytes = await readCapped(res, budget.bytes, () => timedOut);
    const header = sniffImage(bytes);
    if (!header) throw new ImageLoadError("not-an-image");
    if (
      header.width > budget.side ||
      header.height > budget.side ||
      header.width * header.height > budget.pixels
    )
      throw new ImageLoadError("too-many-pixels");
    done = true;
    return { blob: new Blob([bytes], { type: MIME[header.type] }), header };
  } finally {
    // Every rejection (status, declared size, overflow, format, pixels)
    // stops the transfer: aborting cancels the request and its body stream.
    if (!done) controller.abort();
    clearTimeout(timer);
    signal.removeEventListener("abort", forward);
  }
}

async function readCapped(
  res: Response,
  limit: number,
  timedOut: () => boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = res.body?.getReader();
  if (!reader) throw new ImageLoadError("network");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => {});
        throw new ImageLoadError("too-large");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ImageLoadError) throw e;
    throw new ImageLoadError(timedOut() ? "timeout" : "network");
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Type and pixel size from a raster file's header; null if unrecognised. */
export function sniffImage(b: Uint8Array): ImageHeader | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) =>
    ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const ascii = (i: number, s: string) =>
    [...s].every((c, j) => b[i + j] === c.charCodeAt(0));
  const ok = (type: ImageType, width: number, height: number) =>
    width > 0 && height > 0 ? { type, width, height } : null;
  if (b.length >= 24 && ascii(0, "\x89PNG\r\n\x1a\n") && ascii(12, "IHDR"))
    return ok("png", u32be(16), u32be(20));
  if (b.length >= 10 && (ascii(0, "GIF87a") || ascii(0, "GIF89a")))
    return ok("gif", u16le(6), u16le(8));
  if (b.length >= 30 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    if (ascii(12, "VP8X")) return ok("webp", u24le(24) + 1, u24le(27) + 1);
    if (ascii(12, "VP8L") && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return ok("webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (ascii(12, "VP8 ") && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)
      return ok("webp", u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the markers to the first start-of-frame.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = u16be(i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      )
        return ok("jpeg", u16be(i + 7), u16be(i + 5));
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}
