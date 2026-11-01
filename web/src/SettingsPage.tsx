import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * The app's settings, a page in the map's place (`settingsStore.ts`): interface
 * sounds and the lofi radio (on/off and volume), desktop notifications, the
 * optional integrations with their keys, and New agent's preset prompts and
 * agent profiles. Sounds, radio and notifications are kept in this browser (or
 * the app); integrations, the Linear workspace and the presets in
 * the data directory's settings.json, keys beside it in secrets.json.
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
  const first = useRef<HTMLInputElement>(null);
  const request = useSettingsRequest();
  // Opening (the gear, ⌘,, the palette, Manage … key) puts the keyboard in the
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
      className="settings-page sound-menu settings-menu"
      aria-label="Settings"
      // Keys pressed here are the page's (not J/K/N/D shortcuts); Escape closes it
      // unless a field took it first.
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          closeSettings();
        }
        if (e.key !== "Tab" && !e.metaKey) e.stopPropagation();
      }}
    >
      <header className="settings-page-head">
        <h2>Settings</h2>
        <button className="icon-btn" aria-label="Close settings" data-tip="Close settings (Esc)" onClick={closeSettings}>
          <X size={16} />
        </button>
      </header>
      <div className="settings-page-body">
        <section className="settings-group" aria-labelledby="settings-sound">
          <h3 id="settings-sound">Sound and music</h3>
          <label className="sound-toggle">
            <input
              ref={first}
              type="checkbox"
              role="switch"
              checked={settings.enabled}
              onChange={(e) => {
                setSoundSettings({ enabled: e.target.checked });
                if (e.target.checked) previewSound();
              }}
            />
            <span>
              <b>Interface sounds</b>
              <small>Selections, dispatches, finished agents, approvals</small>
            </span>
          </label>
          <label className="sound-volume">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={percent}
              disabled={!settings.enabled}
              aria-valuetext={`${percent}%`}
              onChange={(e) => setSoundSettings({ volume: Number(e.target.value) / 100 })}
              onPointerUp={previewSound}
              onKeyUp={(e) => {
                if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") previewSound();
              }}
            />
            <output>{percent}%</output>
          </label>
          <label className="sound-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={music.enabled}
              onChange={(e) => setMusicSettings({ enabled: e.target.checked })}
            />
            <span>
              <b>Lofi radio</b>
              <small aria-live="polite">{musicStatus}</small>
            </span>
          </label>
          <label className="sound-volume">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={musicPercent}
              disabled={!music.enabled}
              aria-label="Lofi radio volume"
              aria-valuetext={`${musicPercent}%`}
              onChange={(e) => setMusicSettings({ volume: Number(e.target.value) / 100 })}
            />
            <output>{musicPercent}%</output>
          </label>
        </section>
        {notifications !== "unsupported" && (
          <section className="settings-group" aria-labelledby="settings-notifications">
            <h3 id="settings-notifications">Notifications</h3>
            <label className="sound-toggle">
              <input
                type="checkbox"
                role="switch"
                checked={notifications === "granted"}
                disabled={notifications === "denied"}
                onChange={onNotifications}
              />
              <span>
                <b>Desktop notifications</b>
                <small>
                  {notifications === "denied" ? "Blocked in browser settings" : "Finished agents and approvals"}
                </small>
              </span>
            </label>
          </section>
        )}
        <section className="settings-group" aria-labelledby="settings-integrations">
          <h3 id="settings-integrations">Optional integrations</h3>
          <IntegrationSettings />
        </section>
        <section className="settings-group" aria-labelledby="settings-new-agent">
          <h3 id="settings-new-agent">New agent</h3>
          <PresetsSetting onEdit={openPresetEditor} />
          <div className="linear-setting presets-setting profiles-setting">
            <span>
              <b>Agent profiles</b>
              <small>Paseo’s named launch settings, in New agent</small>
            </span>
            <button className="secondary" onClick={() => openProfileEditor()}>
              Edit…
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

/** How many preset prompts New agent offers, and their editor. */
function PresetsSetting({ onEdit }: { onEdit: () => void }) {
  const { presets, error } = usePresets();
  return (
    <div className="linear-setting presets-setting">
      <span>
        <b>Preset prompts</b>
        <small>
          {error
            ? error
            : presets.length
              ? `${presets.length} in New agent`
              : "Prompts New agent starts with one click"}
        </small>
      </span>
      <button className="secondary" onClick={onEdit}>
        Edit…
      </button>
    </div>
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
        if (version === secretVersion.current)
          setSecretError(
            errorMessage(error) || "Couldn't check saved API keys.",
          );
      },
    );
  }, []);
  useEffect(() => {
    void refreshSecrets();
    window.addEventListener("focus", refreshSecrets);
    return () => window.removeEventListener("focus", refreshSecrets);
  }, [refreshSecrets]);
  return (
    <div className="integration-settings">
      {(
        [
          ["linear", "Linear", "Your assigned issues and links."],
          ["slack", "Slack", "Your channels, messages and threads, as you."],
          [
            "github",
            "GitHub",
            "Your GitHub notifications in Activity, through gh.",
          ],
          [
            "typesafe",
            "TypeSafe",
            "Find questions and suggest replies. Sends reply excerpts to TypeSafe.",
          ],
        ] as const
      ).map(([name, label, description]) => (
        <section
          className="integration-setting"
          data-integration={name}
          aria-label={`${label} integration`}
          key={name}
        >
          <label className="sound-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={
                pending?.name === name ? pending.enabled : integrations[name]
              }
              disabled={!loaded || saving}
              onChange={(event) =>
                void setIntegration(name, event.target.checked)
              }
            />
            <span>
              <b>{label}</b>
              <small>{description}</small>
            </span>
          </label>
          {integrations[name] && name !== "github" && (
            <div className="integration-fields">
              {(name === "slack"
                ? ([
                    ["slackUserToken", "User token", "xoxp-…"],
                    ["slackAppToken", "App token (Socket Mode)", "xapp-…"],
                  ] as const)
                : ([
                    [name === "linear" ? "linearApiKey" : "typesafeApiKey", "API key", "Enter API key"],
                  ] as const)
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
              {name === "slack" && <SlackAppSetup />}
              {name === "slack" && (
                <small className="integration-note">
                  From your own Slack app: its user OAuth token, and an app-level token with
                  connections:write for live messages (without it, Slack is checked every 20 s).
                </small>
              )}
            </div>
          )}
        </section>
      ))}
      {(error || secrets?.error || secretError) && (
        <p className="integration-error" role="alert">
          {error || secrets?.error || secretError}
          {secretError && (
            <button
              type="button"
              className="secondary"
              onClick={() => void refreshSecrets()}
            >
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
