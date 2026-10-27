import { useLayoutEffect, useRef } from "react";
import { motion, useIsPresent } from "framer-motion";
import { Archive, GitBranch, X } from "lucide-react";
import type { Agent, Workspace } from "./types";
import { isRunning } from "./types";
import { useFocusTrap } from "./focus";
import { agentName, pathText, placeText } from "./names";

export function ArchiveWorkspaceDialog({
  workspace,
  agents,
  onCancel,
  onConfirm,
}: {
  workspace: Workspace;
  agents: Agent[];
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
        aria-labelledby="archive-title"
        aria-describedby="archive-description"
        className="command-dialog archive-dialog panel"
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{
          opacity: 0,
          y: 15,
          scale: 0.97,
          transition: { duration: 0.12 },
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <span className="archive-symbol">
            <Archive size={22} />
          </span>
          <h2 id="archive-title">Archive this workspace?</h2>
          <button
            data-tip="Close without archiving (Esc)"
            className="icon-btn"
            aria-label="Close archive dialog"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <div className="archive-content">
          <div className="archive-target">
            <b>{placeText(workspace.name, "Workspace")}</b>
            <span>
              <GitBranch size={13} />
              {placeText(workspace.branch, "") || workspace.isolation} ·{" "}
              {placeText(workspace.project, "Project")}
            </span>
            <code>{pathText(workspace.cwd, [workspace.workspaceId])}</code>
          </div>
          <p id="archive-description">
            Paseo will archive this workspace and its agents and terminals. Any
            running agents it owns will be interrupted.
          </p>
          <div className="archive-impact">
            <b>
              {workspace.isolation === "worktree"
                ? "Worktree cleanup"
                : "Local directory preserved"}
            </b>
            <p>
              {workspace.isolation === "worktree"
                ? "Paseo may remove an owned worktree directory when no other active workspace uses it. Save or commit any work you want to keep before archiving."
                : "The project directory and its files will remain on disk."}
            </p>
          </div>
          <div className="archive-activity">
            <span className="section-label">Current activity at this path</span>
            <p>
              {agents.length} active {agents.length === 1 ? "agent" : "agents"}
              {running > 0 ? ` · ${running} running` : ""}
            </p>
            {agents.length > 0 && (
              <ul>
                {agents.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <span>{agentName(a)}</span>
                    <small>{a.status}</small>
                  </li>
                ))}
              </ul>
            )}
            {agents.length > 4 && (
              <small>And {agents.length - 4} more at this path.</small>
            )}
            <small>
              Paseo archives only the items owned by this workspace.
            </small>
          </div>
        </div>
        <div className="dialog-actions">
          <button
            aria-description="Close without archiving (Esc)"
            ref={cancel}
            className="secondary"
            onClick={onCancel}
          >
            Keep workspace
          </button>
          <button
            aria-description="Archive this workspace in the background and remove its worktree checkout"
            className="danger"
            onClick={onConfirm}
          >
            <Archive size={15} />
            Archive workspace
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
