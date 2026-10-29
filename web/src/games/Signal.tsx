import { useEffect, useState } from "react";
import { corners, key, neighbours, pointy, propArt, robotArt, Sprite } from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";
import "./Signal.css";

const SIZE = 58;
const W = Math.sqrt(3) * SIZE * 3 + 8;
const H = SIZE * 5 + 8;
const CAP = 20;
/** The six robots round the landmark: their hex colour and robot art. */
const ROBOTS = [
  { tone: "orange", art: 0 },
  { tone: "white", art: 2 },
  { tone: "teal", art: 0 },
  { tone: "violet", art: 1 },
  { tone: "lime", art: 2 },
  { tone: "blue", art: 3 },
] as const;
const CELLS = neighbours({ q: 0, r: 0 });
/** Playback: a pause before it starts, each robot lit, then a gap. */
const LEAD_MS = 700;
const ON_MS = 550;
const GAP_MS = 150;

/** The sequence so far and how many of its steps were fully repeated. */
type State = { seq: number[]; done: number };
const pick = () => Math.floor(Math.random() * ROBOTS.length);
const fresh = (): State => ({ seq: [pick()], done: 0 });

/** Watch the robots signal in turn, then repeat the sequence. */
function Signal({ state: s, setState, finish, active, over }: GameProps<State>) {
  const { seq, done } = s;
  // Playback and progress within a round are the page's; a reload replays it.
  const [phase, setPhase] = useState<"watch" | "input">(over ? "input" : "watch");
  const [step, setStep] = useState(-1);
  const [on, setOn] = useState(false);
  const [progress, setProgress] = useState(0);
  const [flash, setFlash] = useState<{ i: number; ok: boolean } | null>(null);

  useEffect(() => {
    if (over) return;
    setPhase("watch");
    setStep(-1);
    setOn(false);
    setProgress(0);
  }, [seq.length, over]);

  useEffect(() => {
    if (phase !== "watch" || !active || over) return;
    const next = () => {
      if (step === -1 || (!on && step + 1 < seq.length)) {
        setStep(step + 1);
        setOn(true);
      } else if (on) setOn(false);
      else setPhase("input");
    };
    const ms = step === -1 ? LEAD_MS : on ? ON_MS : GAP_MS;
    const t = setTimeout(next, ms);
    return () => clearTimeout(t);
  }, [phase, step, on, active, over, seq.length]);

  useEffect(() => {
    if (!flash?.ok) return;
    const t = setTimeout(() => setFlash(null), 250);
    return () => clearTimeout(t);
  }, [flash]);

  const press = (i: number) => {
    if (over || phase !== "input") return;
    if (seq[progress] !== i) {
      setFlash({ i, ok: false });
      return finish(done, s);
    }
    setFlash({ i, ok: true });
    if (progress + 1 < seq.length) return setProgress(progress + 1);
    if (seq.length >= CAP) return finish(CAP, { seq, done: CAP });
    setPhase("watch");
    setState({ seq: [...seq, pick()], done: seq.length });
  };

  const lit = phase === "watch" && on ? seq[step] : flash?.i;
  const watching = phase === "watch" && !over;
  return (
    <div className="game">
      <GameBar>
        <span>
          Sequence <b>{seq.length}</b>
        </span>
        {!over && <span>{watching ? "Watch…" : "Your turn"}</span>}
      </GameBar>
      <svg className="game-board sea" viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} width={W} height={H}>
        <polygon className="sg-landmark" points={corners(0, 0, SIZE - 1)} />
        <Sprite art={propArt(watching ? "beacon-lit" : "beacon")} y={-4} size={SIZE * 1.3} />
        {CELLS.map((c, i) => {
          const { x, y } = pointy(c, SIZE);
          const robot = ROBOTS[i]!;
          const look = lit === i ? (flash && !flash.ok && flash.i === i ? " wrong" : " lit") : "";
          return (
            <g
              key={key(c)}
              className={`sg-robot ${robot.tone}${look}${phase === "input" && !over ? " open" : ""}`}
              onClick={() => press(i)}
            >
              <polygon points={corners(x, y, SIZE - 1.5)} />
              <Sprite art={robotArt(robot.art)} x={x} y={y - 3} size={SIZE * 1.5} />
            </g>
          );
        })}
      </svg>
      <p className="game-note">
        {over
          ? done >= CAP
            ? `All ${CAP} steps repeated!`
            : `You repeated ${done} step${done === 1 ? "" : "s"}.`
          : watching
            ? "Watch… the robots signal in turn."
            : `Your turn: click the robots in the same order (${progress} of ${seq.length}).`}
      </p>
    </div>
  );
}

export const signal: GameDef<State> = { id: "signal", init: fresh, View: Signal };
