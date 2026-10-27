/**
 * Interface sounds, played by the web layer (the browser, or the native app's
 * WKWebView) with the Web Audio API. The Unity player keeps its audio engine
 * disabled; it never plays these. See docs/unity/SOUND-DIRECTION.md.
 *
 * Nothing is fetched, decoded or played before the user's first gesture
 * (pointer or key), which also unlocks the audio context under autoplay
 * rules. Then both sets are decoded once and reused. Cues pass the CueGate
 * (src/soundCues.ts): no stacking, at most two voices, nothing queued.
 *
 * A context stays on the output device it opened, and WebKit's doesn't
 * reliably follow a later change of the macOS default output (AirPods
 * connecting, a choice in Control Center). So when the desktop app reports a
 * new default output (`audioOutputChanged`), or the browser reports a device
 * change, the context is closed and the next cue or gesture opens a new one
 * on the current default, reusing the decoded buffers.
 */
import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "./api";
import {
  CUE_FOR,
  CUES,
  CueGate,
  DURATION_MS,
  SOUND_SETS,
  isLive,
  setSoundPlayer,
  soundSetFor,
  validSoundSettings,
  type Cue,
  type SoundEvent,
  type SoundOptions,
  type SoundSet,
  type SoundSettings,
  type Voice,
} from "./soundCues";
import { currentTheme } from "./theme";

const files = import.meta.glob<string>("../art/audio/*/*.wav", {
  query: "?url",
  import: "default",
  eager: true,
});
const url = (set: SoundSet, cue: Cue) =>
  files[`../art/audio/${set}/${cue}.wav`];

const KEY = "sounds";
let settings = validSoundSettings(readStore<unknown>(KEY, null));
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function setSoundSettings(next: Partial<SoundSettings>) {
  settings = validSoundSettings({ ...settings, ...next });
  writeStore(KEY, settings);
  applyVolume();
  if (!settings.enabled) stopAll();
  changed();
}
window.addEventListener("storage", (e) => {
  if (e.key !== null && e.key !== `paseo-command:${KEY}`) return;
  settings = validSoundSettings(readStore<unknown>(KEY, null));
  applyVolume();
  if (!settings.enabled) stopAll();
  changed();
});
export function useSoundSettings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
  );
}

type Graph = { context: AudioContext; master: GainNode };
let graph: Graph | null = null;
/** The context was closed by an output change and opens again when needed. */
let reopen = false;
const buffers = new Map<string, AudioBuffer>();
let loading: Promise<void> | null = null;
/** Cues asked for while their buffers decode play if ready in time. */
let waiting: { cue: Cue; set: SoundSet; at: number }[] = [];
const WAIT_MS = 400;
const gate = new CueGate();
const voices = new Set<
  Voice & { source: AudioBufferSourceNode; gain: GainNode }
>();
const state = (value: string, decoded = buffers.size) => {
  document.documentElement.dataset.sounds = value;
  document.documentElement.dataset.soundsDecoded = String(decoded);
};

function applyVolume() {
  if (!graph) return;
  graph.master.gain.setTargetAtTime(
    settings.volume,
    graph.context.currentTime,
    0.015,
  );
}

function stopAll(fade = 0.04) {
  for (const v of voices) stop(v, fade);
}
function stop(
  v: Voice & { source: AudioBufferSourceNode; gain: GainNode },
  fade: number,
) {
  voices.delete(v);
  if (!graph) return;
  const t = graph.context.currentTime;
  try {
    v.gain.gain.setTargetAtTime(0, t, fade / 3);
    v.source.stop(t + fade);
  } catch {
    // Already stopped.
  }
}

function load(): Promise<void> {
  if (loading || !graph) return loading ?? Promise.resolve();
  const first = soundSetFor(currentTheme());
  const order = [first, ...SOUND_SETS.filter((s) => s !== first)];
  state("loading");
  let failed = 0;
  // Decoded buffers belong to no context, so a context replaced while they
  // load (an output change) only changes which one decodes the rest.
  let decoder = graph.context;
  loading = (async () => {
    for (const set of order)
      await Promise.all(
        CUES.map(async (cue) => {
          const href = url(set, cue);
          try {
            if (!href) throw new Error(`missing ${set}/${cue}`);
            const response = await fetch(href);
            if (!response.ok) throw new Error(String(response.status));
            const bytes = await response.arrayBuffer();
            if (!graph && reopen) reopenGraph();
            if (graph) decoder = graph.context;
            buffers.set(`${set}/${cue}`, await decoder.decodeAudioData(bytes));
            const due = waiting.find((w) => w.set === set && w.cue === cue);
            if (due) {
              waiting = waiting.filter((w) => w !== due);
              if (performance.now() - due.at < WAIT_MS) start(cue, set);
            }
          } catch (error) {
            failed++;
            console.warn(`Sound ${set}/${cue} could not load`, error);
          }
        }),
      );
    waiting = [];
    state(failed ? "partial" : "ready");
  })();
  return loading;
}

/** A context on the current default output, or null when unavailable. */
function open(): Graph | null {
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Context) {
    state("unsupported", 0);
    return null;
  }
  try {
    const context = new Context({ latencyHint: "interactive" });
    const master = context.createGain();
    master.connect(context.destination);
    master.gain.value = settings.volume;
    return { context, master };
  } catch {
    state("unsupported", 0);
    return null;
  }
}

/** The first gesture creates (and resumes) the context; later ones resume it. */
function unlock() {
  if (!settings.enabled) return;
  if (!graph) {
    reopenGraph();
    if (!graph) return;
    void load();
  }
  if (graph.context.state === "suspended")
    void graph.context.resume().catch(() => {});
}
for (const type of ["pointerdown", "keydown"] as const)
  window.addEventListener(type, unlock, { capture: true, passive: true });

/**
 * The default output changed: close the context bound to the old device. The
 * next cue (or gesture) opens one on the new default; buffers are kept.
 */
function reopenGraph() {
  graph = open();
  if (graph) reopen = false;
}
function outputChanged() {
  if (!graph) return;
  const old = graph;
  voices.clear();
  graph = null;
  reopen = true;
  void old.context.close().catch(() => {});
}
window.addEventListener("paseo:native", (event) => {
  const detail = (event as CustomEvent<unknown>).detail as {
    version?: unknown;
    type?: unknown;
  } | null;
  if (detail?.version === 1 && detail.type === "audioOutputChanged")
    outputChanged();
});
navigator.mediaDevices?.addEventListener?.("devicechange", outputChanged);

function start(cue: Cue, set: SoundSet, fadeOthers = false) {
  if (!graph) return;
  const buffer = buffers.get(`${set}/${cue}`);
  if (!buffer) return;
  const now = performance.now();
  const admission = gate.admit(cue, now, [...voices]);
  if (!admission.play) return;
  if (admission.replace)
    for (const v of voices) if (v === admission.replace) stop(v, 0.03);
  // A world change fades the old world's tails first.
  if (fadeOthers) stopAll(0.12);
  const source = graph.context.createBufferSource();
  const gain = graph.context.createGain();
  source.buffer = buffer;
  source.connect(gain).connect(graph.master);
  const voice = {
    cue,
    until: now + (buffer.duration * 1000 || DURATION_MS[cue]),
    source,
    gain,
  };
  voices.add(voice);
  source.onended = () => voices.delete(voice);
  source.start();
}

function play(
  cue: Cue,
  set: SoundSet = soundSetFor(currentTheme()),
  fadeOthers = false,
) {
  if (!settings.enabled) return;
  if (!graph && reopen) reopenGraph();
  if (!graph) return;
  // A hidden page says nothing about agents (another tab or the
  // notification speaks for it).
  if (isLive(cue) && document.visibilityState !== "visible") return;
  if (graph.context.state === "suspended")
    void graph.context.resume().catch(() => {});
  if (buffers.has(`${set}/${cue}`)) start(cue, set, fadeOthers);
  else if (loading && waiting.length < 4)
    waiting.push({ cue, set, at: performance.now() });
}

setSoundPlayer((event: SoundEvent, options?: SoundOptions) => {
  play(CUE_FOR[event], options?.set, event === "worldChanged");
});

/** A quiet sample after the user changes the setting. */
export function previewSound() {
  unlock();
  play("select");
}
