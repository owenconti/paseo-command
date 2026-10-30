import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { placePopover } from "./popover";
import { previewSound, setSoundSettings, useSoundSettings } from "./sounds";
import { nativeEvents } from "./worldBridge";
import { api } from "./api";
import { onAppCommand } from "./appCommands";
import { LinearWorkspaceSetting } from "./HeaderLinks";
import { setMusicSettings, useMusic } from "./music";
import { openPresetEditor, usePresets } from "./presetsStore";

/**
 * The app's settings, behind the panel header's gear: interface sounds and
 * the lofi radio (on/off and volume), desktop notifications, and the Linear
 * workspace issue links open in. Sounds, radio and notifications are kept
 * in this browser (or the app); the Linear workspace and the preset prompts
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
  const id = useId();
  // The app's Settings… menu item (Cmd+,) opens these, the only settings,
  // with focus inside so Escape closes them again.
  // So does the command palette's Settings.
  useEffect(() => {
    const show = () => {
      setOpen(true);
      setFocusOnOpen(true);
    };
    const offMenu = nativeEvents((event) => {
      if (event.type === "menu" && event.action === "settings") show();
    });
    const offCommand = onAppCommand("show-settings", show);
    return () => {
      offMenu();
      offCommand();
    };
  }, []);
  useEffect(() => {
    if (!open || !focusOnOpen) return;
    // The sidebar and panel holding the control may still be appearing.
    // (Timers, not animation frames: a hidden native window draws none.)
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      toggle.current?.focus({ preventScroll: true });
      if (document.activeElement === toggle.current || ++tries > 20)
        setFocusOnOpen(false);
      else timer = setTimeout(attempt, 25);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [open, focusOnOpen]);
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
        data-tip="Settings — sounds, music, notifications"
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
          <LinearWorkspaceSetting />
          <PresetsSetting
            onEdit={() => {
              close(false);
              openPresetEditor();
            }}
          />
          <ReplyQuestionsStatus />
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

/** Whether replies' questions can be found (TypeSafe's Jev, server/asks.ts). */
function ReplyQuestionsStatus() {
  const [status, setStatus] = useState<{ available: boolean; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<{ available: boolean; error?: string }>("asks", undefined, controller.signal)
      .then(setStatus)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!status) return null;
  return (
    <div className="linear-setting">
      <span>
        <b>Questions in replies</b>
        <small>
          {status.available
            ? "Found by TypeSafe's Jev"
            : status.error || "Unavailable"}
        </small>
      </span>
    </div>
  );
}
