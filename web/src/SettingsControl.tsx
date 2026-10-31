import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { placePopover } from "./popover";
import { previewSound, setSoundSettings, useSoundSettings } from "./sounds";
import { nativeEvents } from "./worldBridge";
import { setIntegration, useIntegrations } from "./integrationSettings";
import { onAppCommand } from "./appCommands";
import { LinearWorkspaceSetting } from "./HeaderLinks";
import { setMusicSettings, useMusic } from "./music";
import { openPresetEditor, usePresets } from "./presetsStore";
import { api, errorMessage } from "./api";
import { ApiKeySetting, type SecretStatus } from "./ApiKeySetting";

/**
 * The app's settings, behind the panel header's gear: interface sounds and
 * the lofi radio (on/off and volume), desktop notifications, and the Linear
 * workspace issue links open in. Sounds, radio and notifications are kept
 * in this browser (or the app); optional integrations, the Linear workspace and the preset prompts
 * (which open their own editor) in ~/.paseo-command/settings.json.
 */
export function SettingsControl({
  notifications,
  onNotifications,
}: {
  notifications: string;
  onNotifications: () => void;
}) {
  const settings = useSoundSettings();
  const music = useMusic();
  const musicPercent = Math.round(music.volume * 100);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const toggle = useRef<HTMLInputElement>(null);
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const [keyTarget, setKeyTarget] = useState<"linear" | "typesafe" | null>(
    null,
  );
  const id = useId();
  // The app's Settings… menu item (Cmd+,) opens these, the only settings,
  // with focus inside so Escape closes them again.
  // So does the command palette's Settings.
  useEffect(() => {
    const show = (target: "linear" | "typesafe" | null = null) => {
      setKeyTarget(target);
      setOpen(true);
      setFocusOnOpen(true);
    };
    const offMenu = nativeEvents((event) => {
      if (event.type === "menu" && event.action === "settings") show();
    });
    const offCommand = onAppCommand("show-settings", () => show());
    const offLinear = onAppCommand("manage-linear-key", () => show("linear"));
    const offTypesafe = onAppCommand("manage-typesafe-key", () =>
      show("typesafe"),
    );
    return () => {
      offMenu();
      offCommand();
      offLinear();
      offTypesafe();
    };
  }, []);
  useEffect(() => {
    if (!open || !focusOnOpen) return;
    // The sidebar and panel holding the control may still be appearing.
    // (Timers, not animation frames: a hidden native window draws none.)
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const target = keyTarget
        ? anchor.current?.querySelector<HTMLElement>(
            `[data-integration="${keyTarget}"] input[type=password], [data-integration="${keyTarget}"] .api-key-actions button`,
          )
        : toggle.current;
      target?.focus({ preventScroll: true });
      if (target && document.activeElement === target)
        target.scrollIntoView({ block: "nearest" });
      if (document.activeElement === target || ++tries > 20)
        setFocusOnOpen(false);
      else timer = setTimeout(attempt, 25);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [open, focusOnOpen, keyTarget]);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close(true);
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, close]);
  const percent = Math.round(settings.volume * 100);
  const musicStatus = !music.enabled
    ? "Streams laut.fm's lofi station"
    : music.state === "playing"
      ? "Playing laut.fm's lofi station"
      : music.state === "waiting"
        ? "Starts with your next click"
        : "Connecting…";
  return (
    <span
      ref={anchor}
      className="menu-anchor settings-anchor"
      onBlur={(e) => {
        if (
          open &&
          e.relatedTarget &&
          !anchor.current?.contains(e.relatedTarget as Node)
        )
          close(false);
      }}
    >
      <button
        ref={trigger}
        className="icon-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label="Settings"
        data-tip="Settings — integrations, sounds, music, notifications"
        data-music={music.enabled ? music.state : "off"}
        onClick={() => setOpen(!open)}
      >
        <Settings size={14} />
      </button>
      {open && (
        <div
          ref={placePopover}
          id={id}
          role="dialog"
          aria-label="Settings"
          className="popover-menu right sound-menu settings-menu"
          // Keys pressed here are the control's (not J/K/N/D shortcuts).
          onKeyDown={(e) => {
            if (e.key !== "Tab" && e.key !== "Escape") e.stopPropagation();
          }}
        >
          <label className="sound-toggle">
            <input
              ref={toggle}
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
              onChange={(e) =>
                setSoundSettings({ volume: Number(e.target.value) / 100 })
              }
              onPointerUp={previewSound}
              onKeyUp={(e) => {
                if (
                  e.key.startsWith("Arrow") ||
                  e.key === "Home" ||
                  e.key === "End"
                )
                  previewSound();
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
              onChange={(e) =>
                setMusicSettings({ volume: Number(e.target.value) / 100 })
              }
            />
            <output>{musicPercent}%</output>
          </label>
          {notifications !== "unsupported" && (
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
                  {notifications === "denied"
                    ? "Blocked in browser settings"
                    : "Finished agents and approvals"}
                </small>
              </span>
            </label>
          )}
          <IntegrationSettings />
          <PresetsSetting
            onEdit={() => {
              close(false);
              openPresetEditor();
            }}
          />
        </div>
      )}
    </span>
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
      <h3>Optional integrations</h3>
      {(
        [
          ["linear", "Linear", "Your assigned issues and links."],
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
          {integrations[name] && (
            <div className="integration-fields">
              <ApiKeySetting
                name={name === "linear" ? "linearApiKey" : "typesafeApiKey"}
                label={label}
                status={secrets}
                onSaved={(status) => {
                  secretVersion.current++;
                  setSecrets(status);
                }}
              />
              {name === "linear" && <LinearWorkspaceSetting />}
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
