import { useEffect, useRef, useState } from "react";
import { corners, disc, key, pointy, propArt, Sprite } from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";
import "./Beacons.css";

const R = 2;
const SIZE = 40;
const CELLS = disc(R);
const W = Math.sqrt(3) * SIZE * (2 * R + 1) + 8;
const H = SIZE * (3 * R + 2) + 8;
const ROUND = 30_000;
/** How long a flare stays lit, from the first second to the last. */
const LIFE_START = 1600;
const LIFE_END = 800;
/** Halo colours: approval, question, failure (only for show). */
const TONES = ["approval", "question", "failure"] as const;

type State = { started: boolean; elapsedMs: number; answered: number };
const fresh = (): State => ({ started: false, elapsedMs: 0, answered: 0 });

/** A lit beacon: its cell, when it flared (round time) and for how long. */
type Flare = { cell: number; born: number; life: number; tone: number };

/** Answer beacons as they flare across the island, for thirty seconds. */
function Beacons({ state: s, setState, finish, active, over }: GameProps<State>) {
  // The clock and flares tick here; the round's time is saved about once a second.
  const clock = useRef(s.elapsedMs);
  const flares = useRef<Flare[]>([]);
  const nextAt = useRef(s.elapsedMs + 400);
  const saved = useRef(s.elapsedMs);
  const ended = useRef(false);
  const latest = useRef(s);
  latest.current = s;
  const [, setTick] = useState(0);
  const running = s.started && active && !over;

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let id = 0;
    const tick = () => {
      const now = performance.now();
      const t = Math.min(ROUND, clock.current + now - last);
      clock.current = t;
      last = now;
      if (t >= ROUND) {
        clearInterval(id);
        flares.current = [];
        if (!ended.current) finish(latest.current.answered, { ...latest.current, elapsedMs: ROUND });
        ended.current = true;
        return;
      }
      flares.current = flares.current.filter((f) => t < f.born + f.life);
      // One at a time to begin with, then up to two, staggered.
      const want = t < 8000 ? 1 : 2;
      if (flares.current.length < want && t >= nextAt.current) {
        const lit = new Set(flares.current.map((f) => f.cell));
        const free = CELLS.map((_, i) => i).filter((i) => !lit.has(i));
        const cell = free[Math.floor(Math.random() * free.length)]!;
        const life = LIFE_START - ((LIFE_START - LIFE_END) * t) / ROUND;
        flares.current.push({ cell, born: t, life, tone: Math.floor(Math.random() * TONES.length) });
        nextAt.current = t + 250 + Math.random() * 350;
      }
      if (t - saved.current >= 1000) {
        saved.current = t;
        setState({ ...latest.current, elapsedMs: t });
      }
      setTick((n) => n + 1);
    };
    id = window.setInterval(tick, 100);
    return () => clearInterval(id);
  }, [running, finish, setState]);

  const start = () => {
    if (over || s.started) return;
    nextAt.current = clock.current + 400;
    setState({ ...s, started: true });
  };
  const answer = (cell: number) => {
    if (!running) return;
    const hit = flares.current.find((f) => f.cell === cell);
    if (!hit) return;
    flares.current = flares.current.filter((f) => f !== hit);
    nextAt.current = Math.min(nextAt.current, clock.current + 200);
    saved.current = clock.current;
    setState({ ...s, answered: s.answered + 1, elapsedMs: clock.current });
  };

  const t = over ? ROUND : clock.current;
  const left = Math.ceil((ROUND - t) / 1000);
  const shown = over ? [] : flares.current;
  return (
    <div className="game">
      <GameBar>
        <span>
          Answered <b>{s.answered}</b>
        </span>
        <span>
          <b>{left}</b>s left
        </span>
      </GameBar>
      <svg className="game-board sea" viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} width={W} height={H}>
        {CELLS.map((c, i) => {
          const { x, y } = pointy(c, SIZE);
          const f = shown.find((g) => g.cell === i);
          const rest = f ? Math.max(0, 1 - (t - f.born) / f.life) : 0;
          return (
            <g key={key(c)} className={`bc-cell${f ? ` lit ${TONES[f.tone]}` : ""}`} onClick={() => answer(i)}>
              <polygon points={corners(x, y, SIZE - 0.8)} />
              {f && (
                <>
                  <circle className="bc-halo" cx={x} cy={y} r={SIZE * 0.72} />
                  <circle
                    className="bc-timer"
                    cx={x}
                    cy={y}
                    r={SIZE * 0.78}
                    pathLength={1}
                    strokeDasharray={`${rest} 1`}
                    transform={`rotate(-90 ${x} ${y})`}
                  />
                </>
              )}
              <Sprite art={propArt(f ? "beacon-lit" : "beacon")} x={x} y={y - 3} size={SIZE * 1.45} />
            </g>
          );
        })}
        {!s.started && !over && (
          <g className="bc-start" onClick={start}>
            <rect x={-W / 2} y={-H / 2} width={W} height={H} />
            <rect className="bc-start-btn" x={-44} y={-18} width={88} height={36} rx={8} />
            <text y={6} textAnchor="middle">
              Start
            </text>
          </g>
        )}
      </svg>
      <p className="game-note">
        {over
          ? `Answered ${s.answered} beacon${s.answered === 1 ? "" : "s"} in 30 seconds.`
          : "Beacons flare across the island. Click each one before it fades; they fade faster as the 30 seconds run out."}
      </p>
    </div>
  );
}

export const beacons: GameDef<State> = { id: "beacons", init: fresh, View: Beacons };
