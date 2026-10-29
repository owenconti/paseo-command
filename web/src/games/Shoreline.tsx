import { useMemo, useState } from "react";
import {
  corners,
  disc,
  key,
  neighbours,
  pointy,
  propArt,
  ring,
  Sprite,
  treeArt,
  type Hex,
} from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";

const R = 3;
const SIZE = 25;
const CELLS = disc(R);
const W = Math.sqrt(3) * SIZE * (2 * R + 1) + 8;
const H = SIZE * (3 * R + 2) + 8;
const DRAWS = 20;

const TERRAIN = ["meadow", "forest", "sand", "pond"] as const;
type Terrain = (typeof TERRAIN)[number];

const pile = () => Array.from({ length: DRAWS }, () => TERRAIN[Math.floor(Math.random() * TERRAIN.length)]!);
type State = { placed: Record<string, Terrain>; draws: Terrain[]; score: number };
const fresh = (): State => ({ placed: { "0,0": "meadow" }, draws: pile(), score: 0 });

/** Edge matches a tile placed at `c` would make, plus a bonus for every tile
 * (it or a neighbour) it completes with at least four matching sides. */
function gain(placed: Map<string, Terrain>, c: Hex, t: Terrain): number {
  const next = new Map(placed).set(key(c), t);
  let points = neighbours(c).filter((n) => placed.get(key(n)) === t).length;
  for (const cell of [c, ...neighbours(c)]) {
    const kind = next.get(key(cell));
    if (!kind || ring(cell) > R) continue;
    const around = neighbours(cell).filter((n) => ring(n) <= R);
    if (around.length < 6 || around.some((n) => !next.has(key(n)))) continue;
    // Completed only now: `c` is one of its cells.
    if (cell !== c && !around.some((n) => key(n) === key(c))) continue;
    if (around.filter((n) => next.get(key(n)) === kind).length >= 4) points += 3;
  }
  return points;
}

function TerrainTile({ t, x, y }: { t: Terrain; x: number; y: number }) {
  return (
    <>
      <polygon className={`sh-${t}`} points={corners(x, y, SIZE - 0.8)} />
      {t === "forest" && <Sprite art={treeArt} x={x} y={y - 2} size={SIZE * 1.4} />}
      {t === "meadow" && <Sprite art={propArt("flowerbed")} x={x} y={y + 2} size={SIZE * 1.1} />}
      {t === "pond" && (
        <path className="sh-wave" d={`M${x - 9} ${y} q4.5 -4 9 0 t9 0 M${x - 6} ${y + 6} q3 -3 6 0 t6 0`} />
      )}
    </>
  );
}

/** Grow an island from a pile of terrain hexes, matching like with like. */
function Shoreline({ state, setState, finish, over }: GameProps<State>) {
  const { draws, score } = state;
  const placed = useMemo(() => new Map(Object.entries(state.placed)), [state.placed]);
  const [hover, setHover] = useState<string | null>(null);
  const current = over ? undefined : draws[0];
  const open = useMemo(
    () =>
      CELLS.filter((c) => !placed.has(key(c)) && neighbours(c).some((n) => placed.has(key(n)))),
    [placed],
  );
  const place = (c: Hex) => {
    if (!current) return;
    const next: State = {
      placed: { ...state.placed, [key(c)]: current },
      draws: draws.slice(1),
      score: score + gain(placed, c, current),
    };
    setHover(null);
    const room = CELLS.some(
      (o) => !(key(o) in next.placed) && neighbours(o).some((n) => key(n) in next.placed),
    );
    if (next.draws.length && room) setState(next);
    else finish(next.score, next);
  };
  const hovered = hover ? open.find((c) => key(c) === hover) : undefined;
  return (
    <div className="game">
      <GameBar>
        <span>
          Score <b>{score}</b>
        </span>
      </GameBar>
      <div className="sh-hand">
        <span>{over ? "Done" : `Next · ${draws.length} left`}</span>
        <svg viewBox={`${-SIZE * 4.6} ${-SIZE} ${SIZE * 6.4} ${SIZE * 2}`} width={SIZE * 6.4} height={SIZE * 2}>
          {draws.slice(0, 3).map((t, i) => (
            <g key={i} opacity={i ? 0.55 : 1}>
              <TerrainTile t={t} x={-SIZE * 3.6 + i * SIZE * 2} y={0} />
            </g>
          ))}
        </svg>
      </div>
      <svg className="game-board sea" viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} width={W} height={H}>
        {CELLS.map((c) => {
          const { x, y } = pointy(c, SIZE);
          const t = placed.get(key(c));
          if (t) return <TerrainTile key={key(c)} t={t} x={x} y={y} />;
          const can = !over && open.some((o) => key(o) === key(c));
          return (
            <polygon
              key={key(c)}
              className={`sh-empty${can ? " open" : ""}`}
              points={corners(x, y, SIZE - 0.8)}
              onMouseEnter={() => can && setHover(key(c))}
              onMouseLeave={() => setHover((h) => (h === key(c) ? null : h))}
              onClick={() => can && place(c)}
            />
          );
        })}
        {hovered && current && (
          <g className="sh-ghost" pointerEvents="none">
            <TerrainTile t={current} {...pointy(hovered, SIZE)} />
            <text {...pointy(hovered, SIZE)} dy={4} textAnchor="middle">
              +{gain(placed, hovered, current)}
            </text>
          </g>
        )}
      </svg>
      <p className="game-note">
        {over
          ? `Island finished: ${score} points.`
          : "Place each hex next to the island. Matching sides score; a completed hex with 4+ matches scores 3 more."}
      </p>
    </div>
  );
}

export const shoreline: GameDef<State> = { id: "shoreline", init: fresh, View: Shoreline };
