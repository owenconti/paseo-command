/**
 * What the macOS app's screen capture send panel asks of the app's window (`paseo:capture`, from `Capture.swift`'s
 * `toApp`): open an agent's conversation it sent to (`open`), or New agent with the capture as its first message
 * (`newAgent`: in a workspace, or in a new workspace, a worktree, of a project): its text and contact sheet put into New agent's draft (`draft:dispatch`, the
 * composer's attachments) before it opens.
 */
import { api, writeStore } from "../api";
import { setAttachmentDraft } from "../composer/useAttachments";
import { uid } from "../composer/util";

export type AppCapture =
  | { open: string; capture: string }
  | { newAgent: NewAgentPlace; message?: string; images?: string[]; transcript?: false; capture: string };

/** Where the capture's new agent starts: a workspace as it is, or a project (`isolation: "worktree"`: a new workspace). */
export type NewAgentPlace =
  | { workspaceId: string; host?: string }
  | { projectId: string; host?: string; isolation?: "worktree" | "local" };

/** An image the panel's composer had, as a data: URL of a raster type (nothing else is taken). */
const IMAGE_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function readAppCapture(detail: unknown): AppCapture | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const d = detail as Record<string, unknown>;
  if (typeof d.capture !== "string") return undefined;
  if (typeof d.open === "string" && d.open) return { open: d.open, capture: d.capture };
  const n = d.newAgent as Record<string, unknown> | undefined;
  const host = n && typeof n.host === "string" && n.host ? { host: n.host } : {};
  const place: NewAgentPlace | undefined =
    !n || typeof n !== "object"
      ? undefined
      : typeof n.workspaceId === "string" && n.workspaceId
        ? { workspaceId: n.workspaceId, ...host }
        : typeof n.projectId === "string" && n.projectId
          ? { projectId: n.projectId, ...host, ...(n.isolation === "worktree" || n.isolation === "local" ? { isolation: n.isolation } : {}) }
          : undefined;
  if (place)
    return {
      newAgent: place,
      ...(typeof d.message === "string" ? { message: d.message } : {}),
      ...(Array.isArray(d.images) ? { images: d.images.filter((i): i is string => typeof i === "string" && IMAGE_URL.test(i)).slice(0, 9) } : {}),
      ...(d.transcript === false ? { transcript: false as const } : {}),
      capture: d.capture,
    };
  return undefined;
}

export function onAppCapture(handle: (capture: AppCapture) => void) {
  const receive = (event: Event) => {
    const capture = readAppCapture((event as CustomEvent).detail);
    if (capture) handle(capture);
  };
  window.addEventListener("paseo:capture", receive);
  return () => window.removeEventListener("paseo:capture", receive);
}

/** New agent's first message and image for the capture, for an agent on `host` (none: this Mac); `transcript` false
 * leaves out what you said. */
export async function prepareCaptureDraft(capture: string, message: string, host?: string, images: string[] = [], transcript = true) {
  const query = new URLSearchParams({ message, ...(host ? { host } : {}), ...(transcript ? {} : { transcript: "0" }) });
  const draft = await api<{ prompt: string; image: { name: string; data: string; mimeType: string } }>(
    `captures/${encodeURIComponent(capture)}/draft?${query}`,
  );
  writeStore("draft:dispatch", draft.prompt);
  setAttachmentDraft("dispatch", [
    {
      kind: "image",
      id: uid(),
      name: draft.image.name,
      mimeType: draft.image.mimeType,
      dataUrl: `data:${draft.image.mimeType};base64,${draft.image.data}`,
    },
    // What the panel's composer had: pasted or dropped images.
    ...images.map((dataUrl, i) => ({ kind: "image" as const, id: uid(), name: `image-${i + 1}`, mimeType: dataUrl.slice(5, dataUrl.indexOf(";")), dataUrl })),
  ]);
}

/** The macOS app's screen capture hotkey (`CaptureController.hotkeyLabel`, put on the page by the app), as keys; none in a browser. */
export function captureHotkey(): string[] | undefined {
  const label = (window as unknown as { __PASEO_CAPTURE_HOTKEY__?: unknown }).__PASEO_CAPTURE_HOTKEY__;
  return typeof label === "string" && label ? [...label] : undefined;
}
