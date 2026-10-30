/** The map's Apple Music bar: the current track and its controls, read and
 * driven by the macOS app (`native/Sources/PaseoCommandNative/Music.swift`).
 * The page posts `paseoMusic` messages and hears `paseo:music` events; in a
 * plain browser there is no bar. */
import { useEffect, useState } from "react";
import { Music, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import "./music-bar.css";

type Reading = {
  state: "closed" | "launching" | "stopped" | "playing" | "paused" | "denied" | string;
  title?: string;
  artist?: string;
  art?: string;
};

type Channel = { postMessage(m: unknown): void };
const channel = () =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoMusic?: Channel } } }).webkit
    ?.messageHandlers?.paseoMusic;

const post = (message: Record<string, unknown>) => channel()?.postMessage(message);

/** Whether the app can drive Music (the command palette lists its controls). */
export const musicAvailable = () => !!channel();
/** Play or pause, next or previous track, as the bar's buttons do. */
export const musicCommand = (name: "playpause" | "next" | "previous") =>
  post({ type: "command", name });

export function MusicBar() {
  const [reading, setReading] = useState<Reading | null>(null);
  useEffect(() => {
    if (!channel()) return;
    const receive = (e: Event) => setReading((e as CustomEvent<Reading>).detail);
    window.addEventListener("paseo:music", receive);
    post({ type: "watch", on: true });
    return () => {
      window.removeEventListener("paseo:music", receive);
      post({ type: "watch", on: false });
    };
  }, []);
  if (!reading) return null;

  const command = (name: string) => post({ type: "command", name });
  const playing = reading.state === "playing";
  const track = !!reading.title;
  // Pressed play shows at once; the next reading confirms it.
  const toggle = () => {
    setReading({ ...reading, state: playing ? "paused" : "playing" });
    command(track ? "playpause" : "play");
  };

  if (reading.state === "denied") {
    return (
      <div className="music-bar music-bar-note" role="status">
        <Music size={14} />
        Allow Paseo Command to control Music in System Settings › Privacy &amp; Security › Automation.
      </div>
    );
  }
  return (
    <section className="music-bar" aria-label="Apple Music">
      <div className="music-art" aria-hidden>
        {reading.art ? <img src={reading.art} alt="" /> : <Music size={16} />}
      </div>
      <div className="music-track">
        {track ? (
          <>
            <b title={reading.title}>{reading.title}</b>
            <span title={reading.artist}>{reading.artist}</span>
          </>
        ) : (
          <>
            <b>Apple Music</b>
            <span>{reading.state === "launching" ? "Opening…" : "Not playing"}</span>
          </>
        )}
      </div>
      <div className="music-controls">
        {track && (
          <button aria-label="Previous track" onClick={() => command("previous")}>
            <SkipBack size={14} fill="currentColor" />
          </button>
        )}
        <button className="music-play" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        {track && (
          <button aria-label="Next track" onClick={() => command("next")}>
            <SkipForward size={14} fill="currentColor" />
          </button>
        )}
      </div>
    </section>
  );
}
