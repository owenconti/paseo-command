/**
 * What the macOS app's screen capture send panel asks of the app's window (`paseo:capture`, from `Capture.swift`'s
 * `toApp`): open an agent's conversation it sent to (`open`), or New agent on a project with the capture as its
 * first message (`newAgent`): its text and contact sheet put into New agent's draft (`draft:dispatch`, the
 * composer's attachments) before it opens.
 */
import { api, writeStore } from "../api";
import { setAttachmentDraft } from "../composer/useAttachments";
import { uid } from "../composer/util";

export type AppCapture =
  | { open: string; capture: string }
  | { newAgent: { projectId: string; host?: string }; message?: string; capture: string };

export function readAppCapture(detail: unknown): AppCapture | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const d = detail as Record<string, unknown>;
  if (typeof d.capture !== "string") return undefined;
  if (typeof d.open === "string" && d.open) return { open: d.open, capture: d.capture };
  const n = d.newAgent as Record<string, unknown> | undefined;
  if (n && typeof n === "object" && typeof n.projectId === "string" && n.projectId)
    return {
      newAgent: { projectId: n.projectId, ...(typeof n.host === "string" && n.host ? { host: n.host } : {}) },
      ...(typeof d.message === "string" ? { message: d.message } : {}),
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

/** New agent's first message and image for the capture, for an agent on `host` (none: this Mac). */
export async function prepareCaptureDraft(capture: string, message: string, host?: string) {
  const query = new URLSearchParams({ message, ...(host ? { host } : {}) });
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
  ]);
}

/** The macOS app's screen capture hotkey (`CaptureController.hotkeyLabel`, put on the page by the app), as keys; none in a browser. */
export function captureHotkey(): string[] | undefined {
  const label = (window as unknown as { __PASEO_CAPTURE_HOTKEY__?: unknown }).__PASEO_CAPTURE_HOTKEY__;
  return typeof label === "string" && label ? [...label] : undefined;
}
