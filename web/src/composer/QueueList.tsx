import { AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  CircleAlert,
  ImageOff,
  ImagePlus,
  ListPlus,
  LoaderCircle,
  Paperclip,
  Pencil,
  SendHorizontal,
  Trash2,
} from "lucide-react";
import { errorMessage } from "../api";
import { agentName, placeText } from "../names";
import { PresenceList } from "../PresenceSurface";
import {
  dedupes,
  missingImages,
  sendQueuedNow,
  takeQueued,
  useQueue,
  type Queued,
} from "../queue";
import type { Agent } from "../types";
import type { Attachment } from "./types";

/** The agent's queued messages, above the composer. */
export function QueueList({
  agent,
  running,
  disabled,
  onNotice,
  onEdit,
}: {
  agent: Agent;
  running: boolean;
  disabled: boolean;
  onNotice: (message: string) => void;
  /** The message, taken out of the queue, goes back into the draft. */
  onEdit: (taken: { item: Queued; attachments: Attachment[] }) => void;
}) {
  const queue = useQueue(agent.id);

  // Queued messages are sent by the app's queue runner (see queue.ts), so
  // they go out whether or not this composer is open.
  const sendNow = async (item: Queued, asNew = false) => {
    try {
      await sendQueuedNow(agent, item.id, running ? "steer" : undefined, {
        asNew,
      });
    } catch (e) {
      onNotice(errorMessage(e) || "Couldn't send the queued message.");
    }
  };
  const take = async (item: Queued) => {
    try {
      return await takeQueued(agent.id, item.id);
    } catch (e) {
      onNotice(errorMessage(e) || "Couldn't change the queue.");
    }
  };
  const editQueued = async (item: Queued) => {
    const taken = await take(item);
    if (taken) onEdit(taken);
  };

  return (
    <AnimatePresence initial={false}>
      {queue.length > 0 && (
        <PresenceList
          className="queue"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
        >
          {queue.map((q, i) => {
            const files = q.attachments.length;
            const pictures = q.images ?? 0;
            // Its images aren't in this tab: in the tab that queued it, or
            // gone with it. It is never repeated without them.
            const missing = missingImages(q);
            const elsewhere = missing && !q.imagesLost;
            const busy = !!q.sending;
            const bare = !q.text.trim() && !files;
            const state = busy
              ? "sending"
              : q.uncertain
                ? "may have been sent"
                : q.error
                  ? "waiting for you"
                  : "";
            const there =
              "Its images are in the tab that queued it: edit or send it from there";
            return (
              <li
                key={q.id}
                className={busy ? "sending" : q.error ? "stalled" : ""}
                aria-busy={busy || undefined}
              >
                {busy ? (
                  <LoaderCircle size={13} className="spinning" />
                ) : q.error ? (
                  <CircleAlert size={13} />
                ) : (
                  <ListPlus size={13} />
                )}
                <span className="queue-text">
                  <small>
                    {state ? `Queued ${i + 1} · ${state}` : `Queued ${i + 1}`}
                  </small>
                  {q.text ||
                    `${files + pictures} attachment${files + pictures === 1 ? "" : "s"}`}
                  {q.error && (
                    <em>{placeText(q.error, "It couldn't be sent.")}</em>
                  )}
                </span>
                {files > 0 && (
                  <span
                    className="queue-count"
                    aria-description={`${files} file${files === 1 ? "" : "s"} attached`}
                  >
                    <Paperclip size={11} aria-hidden="true" />
                    {files}
                  </span>
                )}
                {pictures > 0 && (
                  <span
                    className={`queue-count ${missing ? "missing" : ""}`}
                    aria-description={
                      missing
                        ? elsewhere
                          ? `${pictures === 1 ? "Its image is" : `Its ${pictures} images are`} in the tab that queued it`
                          : `${pictures === 1 ? "Its image is" : `Its ${pictures} images are`} no longer available`
                        : `${pictures} image${pictures === 1 ? "" : "s"} attached`
                    }
                  >
                    {missing ? (
                      <ImageOff size={11} aria-hidden="true" />
                    ) : (
                      <ImagePlus size={11} aria-hidden="true" />
                    )}
                    {pictures}
                    {missing && <span className="sr-only"> unavailable</span>}
                  </span>
                )}
                <button
                  data-tip={
                    busy
                      ? "Being sent"
                      : elsewhere
                        ? there
                        : missing
                          ? "Edit it, to attach the image again"
                          : q.uncertain
                            ? "Edit it (it may already have been sent: check the conversation first)"
                            : "Edit queued message"
                  }
                  aria-label="Edit queued message"
                  disabled={busy || elsewhere}
                  onClick={() => void editQueued(q)}
                >
                  <Pencil size={12} />
                </button>
                {/* The same message again (same ID): only whole, and only if
                    the daemon can still take that ID. */}
                {!missing && !q.pendingReceipt && !q.destinationUnknown && (
                  <button
                    data-tip={
                      busy
                        ? "Being sent"
                        : q.uncertain
                          ? dedupes(agent)
                            ? "Send it again: this host recognises a repeat, so if it did arrive, the agent won't get it twice"
                            : "Send it again: this host may not recognise a repeat, so if it did arrive, the agent may run it twice"
                          : q.error
                            ? "Try sending it again"
                            : "Send queued message now"
                    }
                    aria-label={
                      q.uncertain || q.error
                        ? "Send queued message again"
                        : "Send queued message now"
                    }
                    disabled={busy || disabled}
                    onClick={() => void sendNow(q)}
                  >
                    <ArrowUp size={12} />
                  </button>
                )}
                {/* A new message (new ID), by explicit choice: without the
                    lost images, or when the daemon can't take the old ID. */}
                {(q.destinationUnknown ||
                  q.pendingReceipt ||
                  (missing && !elsewhere)) && (
                  <button
                    data-tip={
                      q.destinationUnknown
                        ? `Send this as a new message to ${agentName(agent)} after checking its host`
                        : missing
                          ? "Send it without the image, as a new message (if the original arrived, the agent gets this too)"
                          : "Send it as a new message (if the original arrived, the agent gets it twice)"
                    }
                    aria-label={
                      missing
                        ? "Send without the image, as a new message"
                        : "Send as a new message"
                    }
                    disabled={busy || disabled || bare}
                    onClick={() => void sendNow(q, true)}
                  >
                    <SendHorizontal size={12} />
                  </button>
                )}
                <button
                  data-tip={busy ? "Being sent" : "Remove from queue"}
                  aria-label="Remove from queue"
                  disabled={busy}
                  onClick={() => void take(q)}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </PresenceList>
      )}
    </AnimatePresence>
  );
}
