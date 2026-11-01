import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { ArrowDown, ArrowUp, Plus, Trash2, UserCog, X } from "lucide-react";
import { useFocusTrap } from "./focus";
import { api, errorMessage } from "./api";
import { hostOptions, providerModes } from "./Dispatch";
import {
  closeProfileEditor,
  profilesSaved,
  useProfileEditor,
} from "./profilesStore";
import type { Feature } from "./composer/types";
import type { Host, Model, Profile, Provider } from "./types";
import { hostQuery } from "./types";

/**
 * The host's Paseo agent profiles (its daemon config's agentProfiles, as in
 * Paseo's Settings → Profiles), opened from New agent's provider picker,
 * Settings or ⌘K: each profile's name, provider, model, thinking, mode,
 * provider features and notes, in order. Save writes the list to the daemon;
 * Cancel (or Esc) drops the edits. Rendered once, in the app's main.
 */
export function ProfilesEditorHost({
  hosts,
  providers,
}: {
  hosts: Host[];
  providers: Provider[];
}) {
  const editing = useProfileEditor();
  const host = document.querySelector("main.command-app") ?? document.body;
  return createPortal(
    <AnimatePresence>
      {editing && (
        <ProfilesEditor
          key="profiles"
          first={editing.host}
          hosts={hosts}
          localProviders={providers}
        />
      )}
    </AnimatePresence>,
    host,
  );
}

type Row = Omit<Profile, "id"> & { id?: string; key: number };
let keys = 0;
const LOCAL = "local";

/** Models and features, read once per editor for each choice. */
function useCached<T>() {
  const cache = useRef(new Map<string, Promise<T>>());
  return (path: string) => {
    let p = cache.current.get(path);
    if (!p) {
      p = api<T>(path);
      cache.current.set(path, p);
      // A failed read is asked again next time.
      p.catch(() => cache.current.delete(path));
    }
    return p;
  };
}

function ProfilesEditor({
  first,
  hosts,
  localProviders,
}: {
  first?: string;
  hosts: Host[];
  localProviders: Provider[];
}) {
  const choices = useMemo(() => hostOptions(hosts), [hosts]);
  const [hostKey, setHostKey] = useState(first || LOCAL);
  const host = hostKey === LOCAL ? undefined : hostKey;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [base, setBase] = useState<string[]>([]);
  const [supported, setSupported] = useState(true);
  const [hostProviders, setHostProviders] = useState<Provider[]>(localProviders);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const firstField = useRef<HTMLSelectElement>(null);
  const present = useIsPresent();
  useFocusTrap(dialog, firstField, present);
  useLayoutEffect(() => {
    if (!present && dialog.current?.contains(document.activeElement))
      (document.activeElement as HTMLElement | null)?.blur();
  }, [present]);
  const models = useCached<Model[]>();
  const features = useCached<Feature[]>();

  // The list starts from the host's daemon config as it is when chosen.
  useEffect(() => {
    let live = true;
    setRows(null);
    setLoadError("");
    setError("");
    setDirty(false);
    api<{ supported: boolean; profiles: Profile[] }>(
      `profiles/editor${hostQuery(host)}`,
    ).then(
      (r) => {
        if (!live) return;
        setRows(r.profiles.map((p) => ({ ...p, key: ++keys })));
        setBase(r.profiles.map((p) => p.id));
        setSupported(r.supported);
      },
      (e) => live && setLoadError(errorMessage(e) || "Couldn't read the profiles."),
    );
    if (host)
      api<Provider[]>(`providers${hostQuery(host)}`).then(
        (r) => live && setHostProviders(Array.isArray(r) ? r : []),
        () => live && setHostProviders([]),
      );
    else setHostProviders(localProviders);
    return () => {
      live = false;
    };
  }, [host]);

  const list = rows ?? [];
  const change = (next: Row[]) => {
    setRows(next);
    setDirty(true);
  };
  const edit = (key: number, patch: Partial<Row>) =>
    change(list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) => {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    change(next);
  };
  const add = () => {
    const key = ++keys;
    const provider =
      hostProviders.find((p) => p.status === "available")?.provider ||
      hostProviders[0]?.provider ||
      "";
    change([
      ...list,
      { key, name: "", provider, model: "", thinking: "", mode: "", features: {}, notes: "" },
    ]);
    setTimeout(() =>
      dialog.current
        ?.querySelector<HTMLInputElement>(`[data-profile="${key}"] input`)
        ?.focus(),
    );
  };
  const close = closeProfileEditor;
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api<Profile[]>("profiles", {
        ...(host ? { host } : {}),
        base,
        profiles: list.map(({ key: _key, ...p }) => p),
      });
      profilesSaved();
      closeProfileEditor();
    } catch (e) {
      setError(errorMessage(e) || "Couldn't save the profiles.");
    } finally {
      setSaving(false);
    }
  };
  const readOnly = !supported || !!loadError;

  return (
    <motion.div
      className="modal-backdrop"
      inert={!present}
      aria-hidden={!present || undefined}
      style={!present ? { pointerEvents: "none" } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onClick={close}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="profiles-title"
        aria-describedby="profiles-description"
        className="command-dialog presets-dialog profiles-dialog panel"
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 15, scale: 0.97, transition: { duration: 0.12 } }}
        onClick={(e) => e.stopPropagation()}
        // Keys typed here are the editor's (not the app's shortcuts).
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
          if (e.key !== "Tab") e.stopPropagation();
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="profiles-title">Agent profiles</h2>
            <p id="profiles-description">
              Named provider, model, thinking, mode and feature settings, offered in New agent’s
              provider picker. They’re kept in the host’s Paseo config, so the Paseo app shows them too.
            </p>
          </div>
          <button
            className="icon-btn"
            aria-label="Close without saving"
            data-tip="Close without saving (Esc)"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <label className="profiles-host">
          <span>Host</span>
          <select
            ref={firstField}
            value={hostKey}
            // Edits belong to one host: save or cancel them before another.
            disabled={dirty}
            title={dirty ? "Save or cancel these edits to choose another host" : undefined}
            onChange={(e) => setHostKey(e.target.value)}
          >
            {choices.map((h) => (
              <option key={h.key} value={h.key} disabled={h.unavailable}>
                {h.text}
              </option>
            ))}
          </select>
        </label>
        {loadError && (
          <p className="presets-error" role="alert">
            {loadError}
          </p>
        )}
        {!supported && (
          <p className="presets-error" role="alert">
            This host’s Paseo is too old to save profiles. Update it to edit them here.
          </p>
        )}
        <ol className="presets-list">
          {list.map((row, i) => (
            <ProfileRow
              key={row.key}
              row={row}
              host={host}
              providers={hostProviders}
              models={models}
              features={features}
              disabled={readOnly}
              first={i === 0}
              last={i === list.length - 1}
              onEdit={(patch) => edit(row.key, patch)}
              onMove={(by) => move(i, by)}
              onDelete={() => change(list.filter((r) => r.key !== row.key))}
            />
          ))}
        </ol>
        {rows?.length === 0 && (
          <p className="presets-empty">
            <UserCog size={14} aria-hidden="true" /> No profiles on this host yet.
          </p>
        )}
        <button
          className="secondary presets-add"
          onClick={add}
          disabled={!rows || readOnly}
        >
          <Plus size={14} />
          Add profile
        </button>
        <div className="dialog-actions">
          {error && (
            <p className="presets-error" role="alert">
              {error}
            </p>
          )}
          <button className="secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={save}
            disabled={saving || !rows || readOnly || !dirty}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}

function ProfileRow({
  row,
  host,
  providers,
  models: readModels,
  features: readFeatures,
  disabled,
  first,
  last,
  onEdit,
  onMove,
  onDelete,
}: {
  row: Row;
  host?: string;
  providers: Provider[];
  models: (path: string) => Promise<Model[]>;
  features: (path: string) => Promise<Feature[]>;
  disabled: boolean;
  first: boolean;
  last: boolean;
  onEdit: (patch: Partial<Row>) => void;
  onMove: (by: number) => void;
  onDelete: () => void;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [offered, setOffered] = useState<Feature[]>([]);
  useEffect(() => {
    let live = true;
    setModels([]);
    if (row.provider)
      readModels(`providers/${row.provider}/models${hostQuery(host)}`).then(
        (r) => live && setModels(Array.isArray(r) ? r : []),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [row.provider, host]);
  useEffect(() => {
    let live = true;
    if (!row.provider) return setOffered([]);
    const q = new URLSearchParams({ provider: row.provider });
    if (host) q.set("host", host);
    if (row.model) q.set("model", row.model);
    if (row.mode) q.set("mode", row.mode);
    if (row.thinking) q.set("thinking", row.thinking);
    readFeatures(`profiles/features?${q}`).then(
      (r) => live && setOffered(Array.isArray(r) ? r : []),
      () => live && setOffered([]),
    );
    return () => {
      live = false;
    };
  }, [row.provider, row.model, row.mode, row.thinking, host]);

  const name = row.name || "profile";
  const chosenModel = models.find((m) => m.id === row.model);
  const thinkingOptions = chosenModel?.thinkingOptionIds ?? [];
  const modes = providerModes(row.provider);
  // Values the editor can't offer stay listed, so nothing is saved unseen.
  const others = Object.entries(row.features).filter(
    ([id]) => !offered.some((f) => f.id === id),
  );
  const setFeature = (id: string, value: string | boolean | undefined) => {
    const next = { ...row.features };
    if (value === undefined) delete next[id];
    else next[id] = value;
    onEdit({ features: next });
  };

  return (
    <li data-profile={row.key}>
      <fieldset className="profiles-row" disabled={disabled}>
        <div className="presets-row-head">
          <label>
            <span>Name</span>
            <input
              value={row.name}
              maxLength={60}
              placeholder="Shipper"
              autoComplete="off"
              onChange={(e) => onEdit({ name: e.target.value })}
            />
          </label>
          <div className="presets-row-actions">
            <button
              className="icon-btn"
              aria-label={`Move “${name}” up`}
              disabled={first}
              onClick={() => onMove(-1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="icon-btn"
              aria-label={`Move “${name}” down`}
              disabled={last}
              onClick={() => onMove(1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              className="icon-btn"
              aria-label={`Delete “${name}”`}
              onClick={onDelete}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="profiles-settings">
          <label>
            <span>Provider</span>
            <select
              value={row.provider}
              onChange={(e) =>
                // Another provider's model, mode and features don't carry over.
                onEdit({ provider: e.target.value, model: "", thinking: "", mode: "", features: {} })
              }
            >
              {!providers.some((p) => p.provider === row.provider) && (
                <option value={row.provider}>{row.provider || "Choose…"}</option>
              )}
              {providers.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {p.label}
                  {p.status === "available" ? "" : ` (${p.status})`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <select
              value={row.model}
              onChange={(e) => onEdit({ model: e.target.value, thinking: "" })}
            >
              <option value="">Default model</option>
              {row.model && !chosenModel && <option value={row.model}>{row.model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.model}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Thinking</span>
            <select
              value={row.thinking}
              disabled={!thinkingOptions.length && !row.thinking}
              onChange={(e) => onEdit({ thinking: e.target.value })}
            >
              <option value="">
                {chosenModel?.defaultThinkingOptionId
                  ? `Default (${chosenModel.defaultThinkingOptionId})`
                  : "Default thinking"}
              </option>
              {row.thinking && !thinkingOptions.includes(row.thinking) && (
                <option value={row.thinking}>{row.thinking}</option>
              )}
              {thinkingOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Mode</span>
            <select value={row.mode} onChange={(e) => onEdit({ mode: e.target.value })}>
              <option value="">Default mode</option>
              {row.mode && !modes.some((m) => m.id === row.mode) && (
                <option value={row.mode}>{row.mode}</option>
              )}
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(offered.length > 0 || others.length > 0) && (
          <div className="profiles-features" role="group" aria-label="Features">
            {offered.map((f) =>
              f.type === "toggle" ? (
                <label key={f.id} className="profiles-feature" title={f.tooltip || f.description}>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={Boolean(row.features[f.id] ?? f.value)}
                    onChange={(e) => setFeature(f.id, e.target.checked)}
                  />
                  <span>{f.label}</span>
                </label>
              ) : f.type === "select" ? (
                <label key={f.id} className="profiles-feature" title={f.tooltip || f.description}>
                  <span>{f.label}</span>
                  <select
                    value={String(row.features[f.id] ?? "")}
                    onChange={(e) => setFeature(f.id, e.target.value || undefined)}
                  >
                    <option value="">Default</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null,
            )}
            {others.map(([id, value]) => (
              <span key={id} className="profiles-feature other">
                {id}: {String(value)}
                <button
                  className="icon-btn"
                  aria-label={`Remove the ${id} feature setting`}
                  onClick={() => setFeature(id, undefined)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <label>
          <span>Notes</span>
          <textarea
            className="profiles-notes"
            value={row.notes}
            rows={2}
            maxLength={2000}
            placeholder="When to use it (shown to agents choosing a profile)"
            onChange={(e) => onEdit({ notes: e.target.value })}
          />
        </label>
      </fieldset>
    </li>
  );
}
