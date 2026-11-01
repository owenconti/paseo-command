import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
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

/** The page's sections, in order: the side list jumps to each. */
const SECTIONS = [
  { id: "settings-sound", label: "Sound and music" },
  { id: "settings-notifications", label: "Notifications" },
  { id: "settings-integrations", label: "Integrations" },
  { id: "settings-new-agent", label: "New agent" },
] as const;

/**
 * The app's settings, a page in the map's place (`settingsStore.ts`; in the
 * macOS app its mode bar's Settings tab): interface sounds and the lofi radio,
 * desktop notifications, the optional integrations with their keys, and New
 * agent's preset prompts and agent profiles. Sounds, radio and notifications
 * are kept in this browser (or the app); integrations, the Linear workspace and
 * the presets in the data directory's settings.json, keys beside it in
 * secrets.json. A list of its sections stands beside them on wide windows.
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
  const body = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const request = useSettingsRequest();
  // In the macOS app Settings is a tab; in a browser the page closes back to the map.
  const closable = !macApp();
  const sections = SECTIONS.filter((s) => s.id !== "settings-notifications" || notifications !== "unsupported");
  const [current, setCurrent] = useState<string>(SECTIONS[0].id);
  // Opening (the tab, ⌘,, the palette, Manage … key) puts the keyboard in the
  // page: on its first switch, or on the asked integration's key editor.
  useEffect(() => {
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
  // The side list marks the section at the top of the view as it scrolls.
  useEffect(() => {
    const scroller = body.current;
    if (!scroller) return;
    const mark = () => {
      const top = scroller.getBoundingClientRect().top + 24;
      let shown: string = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= top) shown = s.id;
      }
      // At the end, the last section is the one being read.
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) shown = SECTIONS[SECTIONS.length - 1].id;
      setCurrent(shown);
    };
    mark();
    scroller.addEventListener("scroll", mark, { passive: true });
    return () => scroller.removeEventListener("scroll", mark);
  }, []);
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
      <header className="settings-page-head">
        <div>
          <h2>Settings</h2>
          <p>Kept for this copy of the app.</p>
        </div>
        {closable && (
          <button className="icon-btn" aria-label="Close settings" data-tip="Close settings (Esc)" onClick={closeSettings}>
            <X size={18} />
          </button>
        )}
      </header>
      <div ref={body} className="settings-page-body">
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map((s) => (
              <button
                key={s.id}
                aria-current={current === s.id ? "true" : undefined}
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ block: "start", behavior: "smooth" })}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-sections">
            <SettingsGroup id="settings-sound" title="Sound and music">
              <SwitchRow
                inputRef={first}
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
            {notifications !== "unsupported" && (
              <SettingsGroup id="settings-notifications" title="Notifications">
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
            <SettingsGroup
              id="settings-integrations"
              title="Integrations"
              note="Optional, and off until you turn them on. Keys are saved on this Mac and never shown again."
            >
              <IntegrationSettings />
            </SettingsGroup>
            <SettingsGroup id="settings-new-agent" title="New agent">
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
          </div>
        </div>
      </div>
    </section>
  );
}

function SettingsGroup({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="settings-group" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{title}</h3>
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
  inputRef,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  /** Its description changes as it works (the radio connecting). */
  live?: boolean;
  badge?: ReactNode;
  inputRef?: React.Ref<HTMLInputElement>;
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
        ref={inputRef}
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
