import { useLayoutEffect, useRef } from "react";
import { motion, useIsPresent } from "framer-motion";
import { RotateCcw, Server, X } from "lucide-react";
import type { Agent } from "./types";
import { isRunning } from "./types";
import { useFocusTrap } from "./focus";
import { agentName } from "./names";
import type { PoolBox } from "./pool";

/**
 * Confirms releasing a claimed pool box (`release.sh`): the box goes back to
 * its seeded checkpoint, so everything on it since the claim is gone.
 */
export function ReleasePoolDialog({
  box,
  agents,
  warning,
  onCancel,
  onConfirm,
}: {
  box: PoolBox;
  /** The box's host's active agents, lost with it. */
  agents: Agent[];
  /** Asked after its last workspace was archived: what releasing it would lose (src/poolArchive.ts). */
  warning?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const present = useIsPresent();
  useFocusTrap(dialog, cancel, present);
  useLayoutEffect(() => {
    if (!present && dialog.current?.contains(document.activeElement))
      (document.activeElement as HTMLElement | null)?.blur();
  }, [present]);
  const running = agents.filter((a) => isRunning(a.status)).length;
  return (
    <motion.div
      className="modal-backdrop"
      inert={!present}
      aria-hidden={!present || undefined}
      style={!present ? { pointerEvents: "none" } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onClick={onCancel}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="release-pool-title"
        aria-describedby="release-pool-description"
        className="command-dialog archive-dialog panel"
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 15, scale: 0.97, transition: { duration: 0.12 } }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <span className="archive-symbol">
            <RotateCcw size={22} />
          </span>
          <h2 id="release-pool-title">Release {box.label}?</h2>
          <button
            data-tip="Close without releasing (Esc)"
            className="icon-btn"
            aria-label="Close release dialog"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <div className="archive-content">
          <div className="archive-target">
            <b>{box.label}</b>
            <span>
              <Server size={13} />
              Pool box{box.claimedAt ? ` · claimed ${new Date(box.claimedAt).toLocaleString()}` : ""}
            </span>
          </div>
          <p id="release-pool-description">
            {warning
              ? `Its last workspace was archived. ${warning}`
              : "release.sh takes the box's secrets off, restores its seeded checkpoint and returns it to the pool. Its Paseo host goes offline until the box is claimed again."}
          </p>
          <div className="archive-impact">
            <b>Work on the box is lost</b>
            <p>
              Everything changed on the box since it was claimed (commits not pushed, worktrees, the database, its agents'
              conversations) goes with the restore. Push anything you want to keep first{warning ? ", or keep the box claimed and release it from the Hosts tab later" : ""}.
            </p>
          </div>
          {agents.length > 0 && (
            <div className="archive-activity">
              <span className="section-label">Agents on it</span>
              <p>
                {agents.length} active {agents.length === 1 ? "agent" : "agents"}
                {running > 0 ? ` · ${running} running` : ""}
              </p>
              <ul>
                {agents.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <span>{agentName(a)}</span>
                    <small>{a.status}</small>
                  </li>
                ))}
              </ul>
              {agents.length > 4 && <small>And {agents.length - 4} more.</small>}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button ref={cancel} className="secondary" onClick={onCancel}>
            Keep it
          </button>
          <button className="danger" onClick={onConfirm}>
            <RotateCcw size={14} />
            Release {box.label}
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
