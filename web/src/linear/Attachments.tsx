import { useRef, useState } from "react";
import { FileText, GitPullRequest, Image as ImageIcon, Link2, LoaderCircle, Paperclip, Plus, Trash2 } from "lucide-react";
import { ago } from "../api";
import { Lightbox } from "../Images";
import { openExternal } from "../links";
import { plainText } from "../ui";
import { attachmentKind, uploadHref } from "./files";
import { linearStore, useLinear } from "./store";
import type { LinearAttachment, LinearIssue } from "./types";

const ICON = {
  image: ImageIcon,
  file: FileText,
  github: GitPullRequest,
  link: Link2,
};

/** Files dragged in (not text or a link): what a drop would upload. */
const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");

/**
 * Opens an attachment: an uploaded image in the lightbox, another uploaded
 * file as a download in the browser (through the app server, which holds the
 * key), a link in the browser.
 */
function useOpen() {
  const [shown, setShown] = useState<{ url: string; name: string }>();
  const open = (a: LinearAttachment) => {
    const kind = attachmentKind(a);
    if (kind === "image") return setShown({ url: uploadHref(a.url, location.origin, true), name: a.title });
    // A new window: the browser (the macOS app's default one) downloads it.
    if (kind === "file") return void window.open(uploadHref(a.url, location.origin, false), "_blank", "noopener");
    openExternal(a.url);
  };
  const lightbox = shown && (
    <Lightbox shown={{ url: shown.url, alt: shown.name, name: shown.name }} onClose={() => setShown(undefined)} />
  );
  return { open, lightbox };
}

/** One attachment: its kind's icon (an image's thumbnail), title, what it is and who added it, and Remove (after confirming). */
function Row({ issue, attachment, onOpen }: { issue: LinearIssue; attachment: LinearAttachment; onOpen: () => void }) {
  const users = useLinear((d) => d.workspace?.users);
  const [confirming, setConfirming] = useState(false);
  const kind = attachmentKind(attachment);
  const Icon = ICON[kind];
  const creator = users?.find((u) => u.id === attachment.creatorId);
  const meta = [attachment.subtitle, creator?.name, attachment.createdAt && ago(attachment.createdAt)].filter(Boolean).join(" · ");
  return (
    <li className="linear-attachment">
      <button type="button" className="linear-attachment-open" onClick={onOpen} aria-label={`Open ${attachment.title || attachment.url}`}>
        {kind === "image" ? (
          <img
            className="linear-attachment-thumb"
            src={uploadHref(attachment.url, location.origin, true)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="linear-attachment-icon" aria-hidden="true">
            <Icon size={14} />
          </span>
        )}
        <span className="linear-attachment-text">
          <span className="linear-attachment-title">{attachment.title || attachment.url}</span>
          {meta && <span className="linear-attachment-meta">{meta}</span>}
        </span>
      </button>
      {confirming ? (
        <span className="linear-confirm" role="group" aria-label={`Remove ${attachment.title}?`}>
          <span>Remove?</span>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setConfirming(false);
              void linearStore.detach(issue.id, attachment.id);
            }}
          >
            Remove
          </button>
          <button type="button" className="secondary" autoFocus onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="icon-btn linear-attachment-remove"
          aria-label={`Remove ${attachment.title || "the attachment"}`}
          data-tip="Remove"
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

/**
 * An issue's attachments, as Linear's: files uploaded to it and links (pull
 * requests, docs…). Upload (or files dropped on the section) sends files to
 * Linear and attaches them; Add link attaches an address, Linear naming it if
 * no title is given. Each opens (an image in the lightbox, a file as a
 * download, a link in the browser) and can be removed.
 */
export function Attachments({ issue }: { issue: LinearIssue }) {
  const list = issue.attachments ?? [];
  const { open, lightbox } = useOpen();
  const [uploading, setUploading] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: File[]) => {
    for (const file of files) {
      setUploading((u) => [...u, file.name]);
      await linearStore.attachFile(issue.id, file, file.name || "file");
      setUploading((u) => {
        const at = u.indexOf(file.name);
        return at < 0 ? u : [...u.slice(0, at), ...u.slice(at + 1)];
      });
    }
  };
  const link = async () => {
    if (!url.trim() || saving) return;
    setSaving(true);
    const done = await linearStore.attachLink(issue.id, url.trim(), title);
    setSaving(false);
    if (!done) return;
    setUrl("");
    setTitle("");
    setLinking(false);
  };

  return (
    <section
      className={`linear-section linear-attachments${over ? " drop" : ""}`}
      aria-label="Attachments"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="linear-section-head">
        <h3>Attachments {list.length > 0 && <span className="linear-count">{list.length}</span>}</h3>
        <span className="linear-section-actions">
          <button type="button" className="ghost-btn" onClick={() => setLinking(true)}>
            <Plus size={12} aria-hidden="true" />
            Add link
          </button>
          <button type="button" className="ghost-btn" onClick={() => input.current?.click()}>
            <Paperclip size={12} aria-hidden="true" />
            Upload
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            aria-label="Files to attach"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              void upload(files);
            }}
          />
        </span>
      </div>
      {linking && (
        <form
          className="linear-attach-link"
          onSubmit={(e) => {
            e.preventDefault();
            void link();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            setLinking(false);
          }}
        >
          <input
            {...plainText}
            type="url"
            aria-label="Link to attach"
            placeholder="https://…"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            {...plainText}
            aria-label="Title (optional)"
            placeholder="Title (optional)"
            value={title}
            maxLength={255}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="primary" disabled={!url.trim() || saving}>
            Attach
          </button>
          <button type="button" className="secondary" onClick={() => setLinking(false)}>
            Cancel
          </button>
        </form>
      )}
      {(list.length > 0 || uploading.length > 0) && (
        <ul className="linear-attachment-list">
          {list.map((a) => (
            <Row key={a.id} issue={issue} attachment={a} onOpen={() => open(a)} />
          ))}
          {uploading.map((name, n) => (
            <li key={`${name}-${n}`} className="linear-attachment uploading" role="status">
              <span className="linear-attachment-icon" aria-hidden="true">
                <LoaderCircle size={14} className="spinning" />
              </span>
              <span className="linear-attachment-text">
                <span className="linear-attachment-title">{name}</span>
                <span className="linear-attachment-meta">Uploading…</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!list.length && !uploading.length && !linking && (
        <p className="linear-attachments-empty">Drop files here, or add a link.</p>
      )}
      {lightbox}
    </section>
  );
}
