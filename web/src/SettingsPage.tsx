import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, Bot, Plug, Volume2, X } from "lucide-react";
import { ResizeEdge } from "./ResizeEdge";
import { readStore, writeStore } from "./api";
import { previewSound, setSoundSettings, useSoundSettings } from "./sounds";
import { setIntegration, useIntegrations } from "./integrationSettings";
import { LinearWorkspaceSetting } from "./HeaderLinks";
import { setMusicSettings, useMusic } from "./music";
import { openPresetEditor, usePresets } from "./presetsStore";
import { openProfileEditor } from "./profilesStore";
import { api, errorMessage } from "./api";
import { SlackAppSetup } from "./slack/SlackAppSetup";
import { ApiKeySetting, type SecretStatus } from "./ApiKeySetting";
import { closeSettings, useSettingsRequest } from "./settingsStore";
import { macApp } from "./worldBridge";

/** The page's sections, in its sidebar's order; one shows at a time, as the other pages' places do. */
const SECTIONS = [
  { id: "sound", label: "Sound and music", icon: <Volume2 size={14} aria-hidden="true" /> },
  { id: "notifications", label: "Notifications", icon: <Bell size={14} aria-hidden="true" /> },
  { id: "integrations", label: "Integrations", icon: <Plug size={14} aria-hidden="true" /> },
  { id: "new-agent", label: "New agent", icon: <Bot size={14} aria-hidden="true" /> },
] as const;
type Section = (typeof SECTIONS)[number]["id"];
/** The sidebar's width: as Activity's, it resizes and is kept. */
const SIDEBAR = { default: 220, min: 180, max: 360 };

/**
 * The app's settings, a page in the map's place (`settingsStore.ts`; in the
 * macOS app its mode bar's Settings tab): interface sounds and the lofi radio,
 * desktop notifications, the optional integrations with their keys, and New
 * agent's preset prompts and agent profiles. Sounds, radio and notifications
 * are kept in this browser (or the app); integrations, the Linear workspace and
 * the presets in the data directory's settings.json, keys beside it in
 * secrets.json. Laid out as the other pages are: a sidebar of its sections
 * (Sound and music, Notifications, Integrations, New agent), and the chosen one
 * beside it under its own heading.
 */
export function SettingsPage({
  notifications,
  onNotifications,
}: {
  notifications: string;
  onNotifications: () => void;
}) {
  const settings = useSoundSettings();
  const music = useMusic();
  const musicPercent = Math.round(music.volume * 100);
  const page = useRef<HTMLElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const request = useSettingsRequest();
  // In the macOS app Settings is a tab; in a browser the page closes back to the map.
  const closable = !macApp();
  const sections = SECTIONS.filter((s) => s.id !== "notifications" || notifications !== "unsupported");
  const [section, setSectionState] = useState<Section>(() => {
    const kept = readStore<string>("settings:section", "sound");
    return sections.some((s) => s.id === kept) ? (kept as Section) : "sound";
  });
  const setSection = (next: Section) => {
    setSectionState(next);
    writeStore("settings:section", next);
  };
  const [sidebarW, setSidebarW] = useState(() => {
    const kept = readStore<number | null>("settings:sidebarWidth", null);
    return typeof kept === "number" ? Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, kept)) : SIDEBAR.default;
  });
  const resizeSidebar = (w: number | null) => {
    const next = w === null ? SIDEBAR.default : Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, w)));
    setSidebarW(next);
    if (w === null) writeStore("settings:sidebarWidth", null);
    else writeStore("settings:sidebarWidth", next);
  };
  // Opening (the tab, ⌘,, the palette, Manage … key) puts the keyboard in the
  // page: on its section in the sidebar, or on the asked integration's key editor.
  useEffect(() => {
    if (request.target) setSectionState("integrations");
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    // The page may still be appearing. (Timers, not animation frames: a hidden native window draws none.)
    const attempt = () => {
      const target = request.target
        ? page.current?.querySelector<HTMLElement>(
            `[data-integration="${request.target}"] input[type=password], [data-integration="${request.target}"] .api-key-actions button`,
          )
        : first.current;
      target?.focus({ preventScroll: true });
      if (target && document.activeElement === target) target.scrollIntoView({ block: "nearest" });
      if (document.activeElement !== target && ++tries <= 20) timer = setTimeout(attempt, 25);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [request]);
  const shown = sections.find((s) => s.id === section) ?? sections[0]!;
  const percent = Math.round(settings.volume * 100);
  const musicStatus = !music.enabled
    ? "Streams laut.fm's lofi station"
    : music.state === "playing"
      ? "Playing laut.fm's lofi station"
      : music.state === "waiting"
        ? "Starts with your next click"
        : "Connecting…";
  return (
    <section
      ref={page}
      className="settings-page settings-menu"
      aria-label="Settings"
      style={{ gridTemplateColumns: `${sidebarW}px minmax(0, 1fr)` }}
      // Keys pressed here are the page's (not J/K/N/D shortcuts); in a browser Escape
      // closes it unless a field took it first.
      onKeyDown={(e) => {
        if (closable && e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          closeSettings();
        }
        if (e.key !== "Tab" && !e.metaKey) e.stopPropagation();
      }}
    >
      <nav className="settings-sidebar" id="settings-sidebar" aria-label="Settings sections">
        <div className="settings-sidebar-head">
          <h2>Settings</h2>
          {closable && (
            <button className="icon-btn" aria-label="Close settings" data-tip="Close settings (Esc)" onClick={closeSettings}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <div
          className="settings-nav"
          // ↑/↓ step through the sections, as a list.
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const at = sections.findIndex((s) => s.id === shown.id);
            const next = sections[(at + (e.key === "ArrowDown" ? 1 : sections.length - 1)) % sections.length]!;
            setSection(next.id);
            page.current?.querySelector<HTMLElement>(`[data-section="${next.id}"]`)?.focus();
          }}
        >
          {sections.map((s) => (
            <button
              key={s.id}
              ref={s.id === shown.id ? first : undefined}
              data-section={s.id}
              className={`settings-nav-item${s.id === shown.id ? " selected" : ""}`}
              aria-current={s.id === shown.id ? "page" : undefined}
              onClick={() => setSection(s.id)}
            >
              {s.icon}
              <span className="settings-nav-label">{s.label}</span>
            </button>
          ))}
        </div>
        <ResizeEdge
          label="Resize the settings sidebar"
          controls="settings-sidebar"
          value={sidebarW}
          min={SIDEBAR.min}
          max={SIDEBAR.max}
          grows="right"
          onResize={resizeSidebar}
          onReset={() => resizeSidebar(null)}
        />
      </nav>
      <div className="settings-main">
        <header className="settings-head">
          <h2>{shown.label}</h2>
          <small>Kept for this copy of the app</small>
        </header>
        <div className="settings-page-body">
          {shown.id === "sound" && (
            <SettingsGroup>
              <SwitchRow
                title="Interface sounds"
                description="Selections, dispatches, finished agents, approvals"
                checked={settings.enabled}
                onChange={(on) => {
                  setSoundSettings({ enabled: on });
                  if (on) previewSound();
                }}
              />
              {settings.enabled && (
                <VolumeRow
                  label="Interface sounds volume"
                  value={percent}
                  onChange={(v) => setSoundSettings({ volume: v / 100 })}
                  onSettle={previewSound}
                />
              )}
              <SwitchRow
                title="Lofi radio"
                description={musicStatus}
                live
                checked={music.enabled}
                onChange={(on) => setMusicSettings({ enabled: on })}
              />
              {music.enabled && (
                <VolumeRow
                  label="Lofi radio volume"
                  value={musicPercent}
                  onChange={(v) => setMusicSettings({ volume: v / 100 })}
                />
              )}
            </SettingsGroup>
          )}
          {shown.id === "notifications" && (
            <SettingsGroup>
              <SwitchRow
                title="Desktop notifications"
                description={
                  notifications === "denied" ? "Blocked in browser settings" : "When an agent finishes or needs your approval"
                }
                checked={notifications === "granted"}
                disabled={notifications === "denied"}
                onChange={onNotifications}
              />
            </SettingsGroup>
          )}
          {shown.id === "integrations" && (
            <SettingsGroup note="Optional, and off until you turn them on. Keys are saved on this Mac and never shown again.">
              <IntegrationSettings />
            </SettingsGroup>
          )}
          {shown.id === "new-agent" && (
            <SettingsGroup>
              <PresetsSetting />
              <div className="settings-row presets-setting profiles-setting">
                <span className="settings-row-text">
                  <b>Agent profiles</b>
                  <small>Paseo’s named launch settings: provider, model, thinking and mode</small>
                </span>
                <button className="secondary" onClick={() => openProfileEditor()}>
                  Edit profiles…
                </button>
              </div>
            </SettingsGroup>
          )}
        </div>
      </div>
    </section>
  );
}

function SettingsGroup({ note, children }: { note?: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      {note && <p className="settings-group-note">{note}</p>}
      <div className="settings-card">{children}</div>
    </section>
  );
}

/** A setting turned on or off: what it is on the left, its switch on the right. */
function SwitchRow({
  title,
  description,
  checked,
  disabled,
  live,
  badge,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  /** Its description changes as it works (the radio connecting). */
  live?: boolean;
  badge?: ReactNode;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="settings-row settings-switch">
      <span className="settings-row-text">
        <span className="settings-row-title">
          <b>{title}</b>
          {badge}
        </span>
        <small aria-live={live ? "polite" : undefined}>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** A volume, under the sound it sets, while that sound is on. */
function VolumeRow({
  label,
  value,
  onChange,
  onSettle,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** After a change settles (a preview of the sound). */
  onSettle?: () => void;
}) {
  return (
    <label className="settings-row settings-volume">
      <span>Volume</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-label={label}
        aria-valuetext={`${value}%`}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onSettle}
        onKeyUp={(e) => {
          if (onSettle && (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End")) onSettle();
        }}
      />
      <output>{value}%</output>
    </label>
  );
}

/** How many preset prompts New agent offers, and their editor. */
function PresetsSetting() {
  const { presets, error } = usePresets();
  return (
    <div className="settings-row presets-setting">
      <span className="settings-row-text">
        <b>Preset prompts</b>
        <small>
          {error
            ? error
            : presets.length
              ? `${presets.length} ${presets.length === 1 ? "prompt" : "prompts"} New agent starts with one click`
              : "Prompts New agent starts with one click"}
        </small>
      </span>
      <button className="secondary" onClick={openPresetEditor}>
        Edit presets…
      </button>
    </div>
  );
}

type Tone = "ready" | "needs" | "info";
/** A switched-on integration's state, beside its name. */
function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="settings-badge" data-tone={tone}>
      {children}
    </span>
  );
}

/** Optional services stay off until their choice has been saved to settings.json. */
function IntegrationSettings() {
  const { integrations, loaded, saving, pending, error } = useIntegrations();
  const [secrets, setSecrets] = useState<SecretStatus | null>(null);
  const [secretError, setSecretError] = useState("");
  const secretVersion = useRef(0);
  const refreshSecrets = useCallback(() => {
    const version = ++secretVersion.current;
    return api<SecretStatus>("secrets").then(
      (status) => {
        if (version === secretVersion.current) {
          setSecrets(status);
          setSecretError("");
        }
      },
      (error) => {
        if (version === secretVersion.current) setSecretError(errorMessage(error) || "Couldn't check saved API keys.");
      },
    );
  }, []);
  useEffect(() => {
    void refreshSecrets();
    window.addEventListener("focus", refreshSecrets);
    return () => window.removeEventListener("focus", refreshSecrets);
  }, [refreshSecrets]);
  const has = (key: keyof SecretStatus["configured"]) => secrets?.configured[key] === true;
  const badge = (name: "linear" | "slack" | "github" | "typesafe") => {
    if (!secrets) return null;
    if (name === "github") return <Badge tone="info">Uses your gh sign-in</Badge>;
    if (name === "slack")
      return !has("slackUserToken") ? (
        <Badge tone="needs">Needs a user token</Badge>
      ) : has("slackAppToken") ? (
        <Badge tone="ready">Live</Badge>
      ) : (
        <Badge tone="ready">Ready · checks every 20 s</Badge>
      );
    return has(name === "linear" ? "linearApiKey" : "typesafeApiKey") ? (
      <Badge tone="ready">Ready</Badge>
    ) : (
      <Badge tone="needs">Needs an API key</Badge>
    );
  };
  return (
    <div className="integration-settings">
      {(
        [
          ["linear", "Linear", "Your assigned issues and links."],
          ["slack", "Slack", "Your channels, messages and threads, as you."],
          ["github", "GitHub", "Your GitHub notifications in Activity, through gh."],
          ["typesafe", "TypeSafe", "Find questions and suggest replies. Sends reply excerpts to TypeSafe."],
        ] as const
      ).map(([name, label, description]) => (
        <section className="integration-setting" data-integration={name} aria-label={`${label} integration`} key={name}>
          <SwitchRow
            title={label}
            description={description}
            checked={pending?.name === name ? pending.enabled : integrations[name]}
            disabled={!loaded || saving}
            badge={integrations[name] ? badge(name) : null}
            onChange={(on) => void setIntegration(name, on)}
          />
          {integrations[name] && name !== "github" && (
            <div className="integration-fields">
              {(name === "slack"
                ? ([
                    ["slackUserToken", "User token", "xoxp-…"],
                    ["slackAppToken", "App token (Socket Mode)", "xapp-…"],
                  ] as const)
                : ([[name === "linear" ? "linearApiKey" : "typesafeApiKey", "API key", "Enter API key"]] as const)
              ).map(([key, title, placeholder]) => (
                <ApiKeySetting
                  key={key}
                  name={key}
                  label={label}
                  title={title}
                  placeholder={placeholder}
                  status={secrets}
                  onSaved={(status) => {
                    secretVersion.current++;
                    setSecrets(status);
                  }}
                />
              ))}
              {name === "linear" && <LinearWorkspaceSetting />}
              {name === "slack" && (
                <small className="integration-note">
                  From your own Slack app: its user OAuth token, and an app-level token with connections:write for live
                  messages (without it, Slack is checked every 20 s).
                </small>
              )}
              {name === "slack" && <SlackAppSetup />}
            </div>
          )}
        </section>
      ))}
      {(error || secrets?.error || secretError) && (
        <p className="integration-error" role="alert">
          {error || secrets?.error || secretError}
          {secretError && (
            <button type="button" className="secondary" onClick={() => void refreshSecrets()}>
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
