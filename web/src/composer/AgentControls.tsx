import { useEffect, useState } from "react";
import { ChevronDown, Zap } from "lucide-react";
import { api, errorMessage } from "../api";
import type { Agent, Mode, Model } from "../types";
import { hostQuery, providerName } from "../types";
import type { Config, Feature } from "./types";

const thinkingLabel = (t: string) =>
  t === "xhigh"
    ? "Extra high"
    : t
      ? t[0].toUpperCase() + t.slice(1)
      : "Thinking";

/**
 * Model, thinking, mode and provider features. Before an agent's first turn
 * they are controls, changed on the daemon. Once its conversation has
 * started (`readOnly`) they are one muted line instead: Paseo would still
 * accept changes, but keeping them fixed is a deliberate UI choice
 * (README, "Agent settings").
 */
export function AgentControls({
  agent,
  modes,
  mode,
  onSetMode,
  disabled,
  readOnly,
  onNotice,
}: {
  agent: Agent;
  modes: Mode[];
  mode?: string;
  onSetMode: (id: string) => void;
  disabled: boolean;
  readOnly: boolean;
  onNotice: (m: string) => void;
}) {
  const host = agent.host;
  const [config, setConfig] = useState<Config | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [reload, setReload] = useState(0);
  const provider = config?.provider || providerName(agent.provider);
  useEffect(() => {
    const controller = new AbortController();
    api<Config>(
      `agents/${agent.id}/config${hostQuery(host)}`,
      undefined,
      controller.signal,
    )
      .then(setConfig)
      .catch(() => {});
    return () => controller.abort();
  }, [agent.id, host, reload]);
  useEffect(() => {
    const controller = new AbortController();
    api<Model[]>(
      `providers/${provider}/models${hostQuery(host)}`,
      undefined,
      controller.signal,
    )
      .then((rows) => setModels(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    return () => controller.abort();
  }, [provider, host]);
  const post = async (
    action: string,
    body: Record<string, unknown>,
    label: string,
  ) => {
    try {
      await api(
        `agents/${agent.id}/${action}`,
        host ? { ...body, host } : body,
      );
      onNotice(label);
      setReload((n) => n + 1);
    } catch (e) {
      onNotice(errorMessage(e));
    }
  };
  const model = models.find((m) => m.id === config?.model);
  const thinkingOptions =
    model?.thinkingOptionIds || (config?.thinking ? [config.thinking] : []);
  if (readOnly)
    return (
      <SettingsLine
        parts={settingParts({
          model: config ? model?.model || config.model : null,
          thinking: config?.thinking ? thinkingLabel(config.thinking) : null,
          mode: modes.find((m) => m.id === mode)?.label || mode || null,
          features: config?.features ?? [],
        })}
      />
    );
  return (
    <div className="agent-controls">
      {models.length > 0 && config && (
        <label
          className={`control ${disabled ? "disabled" : ""}`}
          aria-description="Change model"
        >
          <span>{model?.model || config.model}</span>
          <ChevronDown size={11} />
          <select
            value={config.model || ""}
            disabled={disabled}
            onChange={(e) =>
              void post(
                "model",
                { model: e.target.value },
                `Model set to ${models.find((m) => m.id === e.target.value)?.model || e.target.value}`,
              )
            }
          >
            {!model && config.model && (
              <option value={config.model}>{config.model}</option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.model}
              </option>
            ))}
          </select>
        </label>
      )}
      {thinkingOptions.length > 0 && config && (
        <label
          className={`control ${disabled ? "disabled" : ""}`}
          aria-description="Thinking mode"
        >
          <span>{thinkingLabel(config.thinking || "")}</span>
          <ChevronDown size={11} />
          <select
            value={config.thinking || ""}
            disabled={disabled}
            onChange={(e) =>
              void post(
                "thinking",
                { thinking: e.target.value },
                `Thinking set to ${e.target.value}`,
              )
            }
          >
            {thinkingOptions.map((t) => (
              <option key={t} value={t}>
                {thinkingLabel(t)}
              </option>
            ))}
          </select>
        </label>
      )}
      {modes.length > 0 && (
        <label
          className={`control ${disabled ? "disabled" : ""}`}
          aria-description="Change mode"
        >
          <span>{modes.find((m) => m.id === mode)?.label || "Mode"}</span>
          <ChevronDown size={11} />
          <select
            value={mode || ""}
            disabled={disabled}
            onChange={(e) => onSetMode(e.target.value)}
          >
            {!mode && <option value="">Mode…</option>}
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {config?.features
        .filter((f) => f.type === "toggle")
        .map((f) => (
          <button
            key={f.id}
            className={`feature ${f.value ? "on" : ""}`}
            aria-description={
              [f.tooltip, f.description].filter(Boolean).join(" — ") ||
              undefined
            }
            aria-pressed={Boolean(f.value)}
            disabled={disabled}
            onClick={() =>
              void post(
                "feature",
                { featureId: f.id, value: !f.value },
                `${f.label} ${f.value ? "off" : "on"}`,
              )
            }
          >
            {f.id.includes("fast") ? <Zap size={12} /> : null}
            {f.label}
          </button>
        ))}
      {config?.features
        .filter((f) => f.type === "select" && f.options?.length)
        .map((f) => (
          <label
            key={f.id}
            className={`control ${disabled ? "disabled" : ""}`}
            aria-description={f.tooltip}
          >
            <span>
              {f.label}:{" "}
              {f.options!.find((o) => o.id === String(f.value))?.label ??
                String(f.value ?? "")}
            </span>
            <ChevronDown size={11} />
            <select
              value={String(f.value ?? "")}
              disabled={disabled}
              onChange={(e) =>
                void post(
                  "feature",
                  { featureId: f.id, value: e.target.value },
                  `${f.label} updated`,
                )
              }
            >
              {f.options!.map((o) => (
                <option key={o.id} value={o.id}>
                  {f.label}: {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
    </div>
  );
}

type Part = { name: string; value: string; shown: boolean };

/** Each setting's full name and value; `shown` ones make up the line. */
export function settingParts({
  model,
  thinking,
  mode,
  features,
}: {
  model: string | null;
  thinking: string | null;
  mode: string | null;
  features: Feature[];
}): Part[] {
  const parts: Part[] = [];
  if (model) parts.push({ name: "Model", value: model, shown: true });
  if (thinking) parts.push({ name: "Thinking", value: thinking, shown: true });
  if (mode) parts.push({ name: "Mode", value: mode, shown: true });
  for (const f of features) {
    if (f.type === "toggle")
      // A toggle reads as its label when on, and is left out when off.
      parts.push({
        name: f.label,
        value: f.value ? "on" : "off",
        shown: Boolean(f.value),
      });
    else if (f.type === "select" && f.options?.length) {
      const value =
        f.options.find((o) => o.id === String(f.value))?.label ??
        String(f.value ?? "");
      if (value) parts.push({ name: f.label, value, shown: true });
    }
  }
  return parts;
}

/** The started conversation's settings: one muted row, nothing to press. */
function SettingsLine({ parts }: { parts: Part[] }) {
  const shown = parts.filter((p) => p.shown);
  if (!shown.length) return <div className="agent-controls" />;
  const full = parts.map((p) => `${p.name}: ${p.value}`).join(" · ");
  return (
    <div className="agent-controls">
      {/* A summary, not a control: its tooltip spells out what it shortens. */}
      <span
        className="agent-settings"
        data-summary
        data-tip={full}
        tabIndex={0}
      >
        {shown.map((p) => (p.value === "on" ? p.name : p.value)).join(" · ")}
      </span>
    </div>
  );
}
