import { useId, useState } from "react";
import { api, errorMessage } from "./api";

export type ApiKeyName = "linearApiKey" | "typesafeApiKey" | "slackUserToken" | "slackAppToken";
export type SecretStatus = {
  configured: Record<ApiKeyName, boolean>;
  error: string | null;
};

/** Saved credentials never enter component state; only the new draft and presence do. */
export function ApiKeySetting({
  name,
  label,
  status,
  onSaved,
  title = "API key",
  placeholder = "Enter API key",
}: {
  name: ApiKeyName;
  label: string;
  /** The field's heading ("API key", or a token's name). */
  title?: string;
  placeholder?: string;
  status: SecretStatus | null;
  onSaved: (status: SecretStatus) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const configured = status?.configured[name] === true;
  const disabled = !status || !!status.error || saving;
  const save = async (value: string | null) => {
    setSaving(true);
    setError("");
    try {
      const next = await api<SecretStatus>("secrets", { name, value });
      if (next.error) throw new Error(next.error);
      setDraft("");
      setEditing(false);
      onSaved(next);
      window.dispatchEvent(new CustomEvent("paseo:secrets", { detail: name }));
    } catch (e) {
      setError(errorMessage(e) || "Couldn't save the API key. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="api-key-setting">
      <div className="api-key-heading">
        <b>{title}</b>
        <small role="status">
          {!status
            ? "Checking…"
            : saving
              ? "Saving…"
              : configured
                ? "Saved"
                : "Not set"}
        </small>
      </div>
      {configured && !editing ? (
        <div className="api-key-actions">
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            aria-label={`Replace ${label} ${title}`}
            onClick={() => {
              setEditing(true);
              setError("");
            }}
          >
            Replace…
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            aria-label={`Remove ${label} ${title}`}
            onClick={() => void save(null)}
          >
            Remove
          </button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && draft.trim()) void save(draft.trim());
          }}
        >
          <input
            id={id}
            type="password"
            name={name}
            value={draft}
            autoFocus={editing}
            aria-label={`${label} ${title}`}
            autoComplete="new-password"
            maxLength={8192}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={configured ? "Enter replacement key" : placeholder}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="api-key-actions">
            <button
              type="submit"
              className="secondary"
              aria-label={`Save ${label} ${title}`}
              disabled={disabled || !draft.trim()}
            >
              Save key
            </button>
            {configured && (
              <button
                type="button"
                className="secondary"
                disabled={saving}
                aria-label={`Cancel replacing ${label} ${title}`}
                onClick={() => {
                  setDraft("");
                  setEditing(false);
                  setError("");
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p className="integration-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
