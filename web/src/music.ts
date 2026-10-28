/**
 * Background music: the laut.fm "lofi" station, streamed into an <audio>
 * element. Off by default; on/off and volume are kept in this browser (or
 * the app). While it is on, it starts with the first gesture (autoplay rules)
 * and reconnects after a dropped stream. Turning it off drops the stream, so
 * turning it on again joins the live broadcast rather than a stale buffer.
 */
import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "./api";

export const MUSIC_STREAM = "https://lofi.stream.laut.fm/lofi";
const RETRY_MS = 5000;

export type MusicSettings = { enabled: boolean; volume: number };
export type MusicState = "off" | "connecting" | "playing" | "waiting";

const KEY = "music";
function valid(value: unknown): MusicSettings {
  const v = (value ?? {}) as Partial<Record<keyof MusicSettings, unknown>>;
  return {
    enabled: v.enabled === true,
    volume:
      typeof v.volume === "number" && Number.isFinite(v.volume)
        ? Math.min(1, Math.max(0, v.volume))
        : 0.4,
  };
}

let settings = valid(readStore<unknown>(KEY, null));
let state: MusicState = "off";
let audio: HTMLAudioElement | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const setState = (next: MusicState) => {
  if (next === state) return;
  state = next;
  changed();
};

function element() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "none";
  audio.addEventListener("playing", () => setState("playing"));
  audio.addEventListener("waiting", () => setState("connecting"));
  const dropped = () => {
    if (!settings.enabled) return;
    setState("connecting");
    clearTimeout(retry);
    retry = setTimeout(start, RETRY_MS);
  };
  audio.addEventListener("error", dropped);
  audio.addEventListener("ended", dropped);
  return audio;
}

function start() {
  clearTimeout(retry);
  if (!settings.enabled) return;
  const a = element();
  a.volume = settings.volume;
  a.src = MUSIC_STREAM;
  setState("connecting");
  a.play().catch((e: unknown) => {
    // Refused before a gesture: wait for one. Otherwise the error event retries.
    if (e instanceof DOMException && e.name === "NotAllowedError")
      setState("waiting");
  });
}

function stop() {
  clearTimeout(retry);
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  setState("off");
}

function apply() {
  if (audio) audio.volume = settings.volume;
  if (!settings.enabled) stop();
  else if (state === "off" || state === "waiting") start();
}

export function setMusicSettings(next: Partial<MusicSettings>) {
  settings = valid({ ...settings, ...next });
  writeStore(KEY, settings);
  apply();
  changed();
}

window.addEventListener("storage", (e) => {
  if (e.key !== null && e.key !== `paseo-command:${KEY}`) return;
  settings = valid(readStore<unknown>(KEY, null));
  apply();
  changed();
});

// Remembered as on: start with the first gesture after a load.
const gesture = () => {
  if (settings.enabled && (state === "off" || state === "waiting")) start();
};
window.addEventListener("pointerdown", gesture, true);
window.addEventListener("keydown", gesture, true);

let snapshot: MusicSettings & { state: MusicState } = { ...settings, state };
export function useMusic() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      if (
        snapshot.enabled !== settings.enabled ||
        snapshot.volume !== settings.volume ||
        snapshot.state !== state
      )
        snapshot = { ...settings, state };
      return snapshot;
    },
  );
}
