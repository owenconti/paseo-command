/**
 * An obvious next reply a decision model found for the agent's last reply
 * (server/asks.ts), above the composer: one click sends it as it is.
 */
import { Sparkles, X } from "lucide-react";

export function SuggestStrip({
  suggestion,
  disabled,
  onSend,
  onDismiss,
}: {
  suggestion: string;
  disabled: boolean;
  onSend: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="suggest-strip" aria-label="Suggested reply">
      <Sparkles size={13} aria-hidden="true" />
      <span>You might say</span>
      <button
        type="button"
        className="suggest-send"
        title="Send this reply"
        disabled={disabled}
        onClick={onSend}
      >
        {suggestion}
      </button>
      <button
        type="button"
        className="ask-dismiss"
        aria-label="Dismiss this suggestion"
        onClick={onDismiss}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </section>
  );
}
