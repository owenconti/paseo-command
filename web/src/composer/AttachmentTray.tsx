import {
  CircleDot,
  File as FileIcon,
  GitPullRequest,
  LoaderCircle,
  X,
} from "lucide-react";
import type { Attachment, ImageAttachment } from "./types";
import { prettySize } from "./util";

export function AttachmentTray({
  attachments,
  onOpen,
  onRemove,
}: {
  attachments: Attachment[];
  onOpen: (image: ImageAttachment) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="attachment-tray">
      {attachments.map((a) =>
        a.kind === "image" ? (
          <span key={a.id} className="thumb">
            <button data-tip="Open image attachment" onClick={() => onOpen(a)}>
              <img src={a.dataUrl} alt={a.name} />
            </button>
            <button
              data-tip="Remove this image"
              className="remove"
              aria-label="Remove image attachment"
              onClick={() => onRemove(a.id)}
            >
              <X size={10} />
            </button>
          </span>
        ) : (
          <span
            key={a.id}
            className={`chip ${a.kind === "file" ? a.status : ""}`}
            aria-description={
              a.kind === "file" ? a.error || a.name : a.item.title
            }
          >
            {a.kind === "file" ? (
              a.status === "uploading" ? (
                <LoaderCircle size={12} className="spinning" />
              ) : (
                <FileIcon size={12} />
              )
            ) : a.item.kind === "pr" ? (
              <GitPullRequest size={12} />
            ) : (
              <CircleDot size={12} />
            )}
            <span>
              {a.kind === "file" ? a.name : `#${a.item.number} ${a.item.title}`}
            </span>
            {a.kind === "file" && (
              <small>
                {a.status === "error" ? "failed" : prettySize(a.size)}
              </small>
            )}
            <button
              data-tip={
                a.kind === "file"
                  ? `Remove ${a.name}`
                  : `Remove #${a.item.number}`
              }
              aria-label={
                a.kind === "file"
                  ? "Remove file attachment"
                  : `Remove ${a.item.kind} ${a.item.number}`
              }
              onClick={() => onRemove(a.id)}
            >
              <X size={10} />
            </button>
          </span>
        ),
      )}
    </div>
  );
}
