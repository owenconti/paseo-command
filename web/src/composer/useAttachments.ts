import {
  useCallback,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { agentApiPath } from "../agentIdentity";
import { errorMessage } from "../api";
import { hostQuery } from "../types";
import type { Attachment, UploadedFile } from "./types";
import { MAX_IMAGE, MAX_UPLOAD, RASTER, readDataUrl, uid } from "./util";

// Chat tabs mount only the active session. Keep attachment drafts in memory
// so switching tabs also retains images and uploads that finish in the meantime.
const attachmentDrafts = new Map<string, Attachment[]>();
const attachmentListeners = new Set<() => void>();
const emptyAttachments: Attachment[] = [];
const subscribeAttachments = (notify: () => void) => {
  attachmentListeners.add(notify);
  return () => {
    attachmentListeners.delete(notify);
  };
};
export function useAttachmentDraft(agentId: string) {
  const snapshot = useCallback(
    () => attachmentDrafts.get(agentId) ?? emptyAttachments,
    [agentId],
  );
  const attachments = useSyncExternalStore(subscribeAttachments, snapshot);
  const setAttachments = useCallback(
    (update: SetStateAction<Attachment[]>) => {
      const previous = attachmentDrafts.get(agentId) ?? emptyAttachments;
      const next = typeof update === "function" ? update(previous) : update;
      if (next === previous) return;
      if (next.length) attachmentDrafts.set(agentId, next);
      else attachmentDrafts.delete(agentId);
      attachmentListeners.forEach((notify) => notify());
    },
    [agentId],
  );
  return [attachments, setAttachments] as const;
}

/** Images are read inline; any other file is uploaded to the agent's host. */
export function useAddFiles(
  agentId: string,
  host: string | undefined,
  onNotice: (message: string) => void,
  setAttachments: Dispatch<SetStateAction<Attachment[]>>,
) {
  return useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (RASTER.test(file.type)) {
          if (file.size > MAX_IMAGE) {
            onNotice(`${file.name} is too large (max 20 MB)`);
            continue;
          }
          let dataUrl: string;
          try {
            dataUrl = await readDataUrl(file);
          } catch {
            onNotice(`Couldn't read ${file.name || "image"}`);
            continue;
          }
          setAttachments((a) => [
            ...a,
            {
              kind: "image",
              id: uid(),
              name: file.name || "image.png",
              mimeType: file.type,
              dataUrl,
            },
          ]);
          continue;
        }
        if (file.size > MAX_UPLOAD) {
          onNotice(`${file.name} is too large (max 50 MB)`);
          continue;
        }
        const id = uid();
        setAttachments((a) => [
          ...a,
          {
            kind: "file",
            id,
            name: file.name,
            size: file.size,
            status: "uploading",
          },
        ]);
        try {
          const res = await fetch(
            `/api/${agentApiPath(`agents/${agentId}/upload${hostQuery(host)}`).path}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                "X-File-Name": encodeURIComponent(file.name),
                "X-File-Type": file.type || "application/octet-stream",
              },
              body: file,
            },
          );
          const result: UploadedFile & { error?: string } = await res.json();
          if (!res.ok) throw new Error(result.error || "Upload failed");
          setAttachments((a) =>
            a.map((x) =>
              x.id === id && x.kind === "file"
                ? { ...x, status: "ready", uploaded: result }
                : x,
            ),
          );
        } catch (e) {
          setAttachments((a) =>
            a.map((x) =>
              x.id === id && x.kind === "file"
                ? {
                    ...x,
                    status: "error",
                    error: errorMessage(e) || "Upload failed",
                  }
                : x,
            ),
          );
          onNotice(`Failed to upload ${file.name}`);
        }
      }
    },
    [agentId, host, onNotice, setAttachments],
  );
}
