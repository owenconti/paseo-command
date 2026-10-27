import {
  ChevronDown,
  ListPlus,
  LoaderCircle,
  SendHorizontal,
  Square,
  Zap,
} from "lucide-react";
import { Menu } from "./Menu";
import type { Behavior } from "./types";
import { MOD } from "./util";

const behaviorLabel = (b: Behavior) =>
  b === "queue" ? "Queue" : b === "steer" ? "Steer" : "Interrupt";

/**
 * The send split button and its options menu, or the interrupt button while
 * the agent runs and there is nothing to send.
 */
export function SendControls({
  running,
  disabled,
  sending,
  cancelling,
  hasContent,
  ready,
  defaultBehavior,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onChooseBehavior,
  onSubmit,
  onCancel,
}: {
  running: boolean;
  disabled: boolean;
  sending: boolean;
  cancelling: boolean;
  hasContent: boolean;
  /** Every upload has finished. */
  ready: boolean;
  defaultBehavior: Behavior;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onChooseBehavior: (b: Behavior) => void;
  onSubmit: (how?: Behavior) => void;
  onCancel: () => void;
}) {
  if (running && !hasContent)
    return (
      <button
        className="send stop"
        data-tip="Interrupt agent"
        aria-label="Interrupt agent"
        disabled={cancelling || disabled}
        onClick={onCancel}
      >
        {cancelling ? (
          <LoaderCircle size={14} className="spinning" />
        ) : (
          <Square size={12} fill="currentColor" />
        )}
      </button>
    );
  return (
    <span className="send-group menu-anchor">
      <button
        className="send"
        // Labelled while the agent runs; only an icon otherwise.
        data-tip={running ? undefined : "Send message (↵)"}
        aria-description={
          running
            ? `${behaviorLabel(defaultBehavior)} message (↵) · ${MOD}↵ send and interrupt · ⌥↵ send and steer`
            : undefined
        }
        aria-label={
          running ? `${behaviorLabel(defaultBehavior)} message` : "Send message"
        }
        disabled={disabled || sending || !hasContent || !ready}
        onClick={() => onSubmit()}
      >
        {sending ? (
          <LoaderCircle size={14} className="spinning" />
        ) : running && defaultBehavior === "queue" ? (
          <ListPlus size={15} />
        ) : (
          <SendHorizontal size={15} />
        )}
        {running && <span>{behaviorLabel(defaultBehavior)}</span>}
      </button>
      <button
        className="send caret"
        aria-label="Send options"
        data-tip="Send options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={disabled}
        onClick={onToggleMenu}
      >
        <ChevronDown size={13} />
      </button>
      {menuOpen && (
        <Menu onClose={onCloseMenu} align="right" label="Send options">
          <p className="menu-label">While the agent is running</p>
          {(["queue", "steer", "interrupt"] as const).map((b) => (
            <button
              aria-description={`While the agent runs, Enter will ${b === "queue" ? "queue the message for after this turn" : b === "steer" ? "add it to the current turn" : "stop the turn and send it"}`}
              key={b}
              role="menuitemradio"
              aria-checked={defaultBehavior === b}
              className={defaultBehavior === b ? "checked" : ""}
              onClick={() => onChooseBehavior(b)}
            >
              <span>
                <b>{behaviorLabel(b)}</b>
                <small>
                  {b === "queue"
                    ? "Send after the current turn finishes"
                    : b === "steer"
                      ? "Add guidance to the current turn"
                      : "Stop the current turn and send now"}
                </small>
              </span>
              {defaultBehavior === b && (
                <span className="default-tag">default</span>
              )}
            </button>
          ))}
          {running && hasContent && (
            <>
              <hr />
              <button
                aria-description="Send now, as guidance for the current turn (⌥↵)"
                role="menuitem"
                onClick={() => (onCloseMenu(), onSubmit("steer"))}
              >
                <SendHorizontal size={13} /> Send and steer now <kbd>⌥↵</kbd>
              </button>
              <button
                aria-description={`Stop the current turn and send this now (${MOD}↵)`}
                role="menuitem"
                onClick={() => (onCloseMenu(), onSubmit("interrupt"))}
              >
                <Zap size={13} /> Send and interrupt <kbd>{MOD}↵</kbd>
              </button>
            </>
          )}
        </Menu>
      )}
    </span>
  );
}
