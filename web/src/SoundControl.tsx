import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { placePopover } from "./popover";
import { previewSound, setSoundSettings, useSoundSettings } from "./sounds";
import { nativeEvents } from "./worldBridge";
import { LinearWorkspaceSetting } from "./HeaderLinks";

/**
 * The app's settings, kept in this browser (or the app): interface sounds
 * (on/off and volume) and the Linear workspace issue links open in.
 */
export function SoundControl() {
  const settings = useSoundSettings();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const toggle = useRef<HTMLInputElement>(null);
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const id = useId();
  // The app's Settings… menu item (Cmd+,) opens these, the only settings,
  // with focus inside so Escape closes them again.
  useEffect(
    () =>
      nativeEvents((event) => {
        if (event.type !== "menu" || event.action !== "settings") return;
        setOpen(true);
        setFocusOnOpen(true);
      }),
    [],
  );
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
  const label = settings.enabled ? `Sounds on, ${percent}%` : "Sounds off";
  const Icon = !settings.enabled
    ? VolumeX
    : settings.volume < 0.5
      ? Volume1
      : Volume2;
  return (
    <span
      ref={anchor}
      className="menu-anchor sound-anchor"
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
        aria-label={`Interface sounds: ${label}`}
        data-tip={`Interface sounds — ${label.toLowerCase().replace("sounds ", "")}`}
        onClick={() => setOpen(!open)}
      >
        <Icon size={14} />
      </button>
      {open && (
        <div
          ref={placePopover}
          id={id}
          role="dialog"
          aria-label="Settings"
          className="popover-menu right sound-menu"
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
          <LinearWorkspaceSetting />
        </div>
      )}
    </span>
  );
}
