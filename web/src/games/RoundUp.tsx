import {
  corners,
  disc,
  key,
  neighbours,
  pointy,
  propArt,
  ring,
  robotArt,
  shuffle,
  Sprite,
  type Hex,
} from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";

/** Land runs out to ring LAND; the ring beyond it is the sea the robot wants. */
const LAND = 4;
const R = LAND + 1;
const SIZE = 17;
const CELLS = disc(R);
const W = Math.sqrt(3) * SIZE * (2 * R + 1) + 8;
const H = SIZE * (3 * R + 2) + 8;
/** Crates you drop for each step the robot takes. */
const PER_STEP = 2;

type State = {
  robot: Hex;
  colour: number;
  /** Hedges the island starts with; crates are the ones you drop (cell keys). */
  hedges: string[];
  crates: string[];
  outcome: "playing" | "won" | "lost";
};

/** A shortest open route from `from` into the sea, or [] when it is fenced in. */
function route(from: Hex, blocked: (k: string) => boolean): Hex[] {
  const prev = new Map<string, Hex | null>([[key(from), null]]);
  let frontier = [from];
  while (frontier.length) {
    const next: Hex[] = [];
    for (const cell of frontier)
      for (const n of shuffle(neighbours(cell))) {
        const k = key(n);
        if (ring(n) > R || blocked(k) || prev.has(k)) continue;
        prev.set(k, cell);
        if (ring(n) === R) {
          const path = [n];
          while (key(prev.get(key(path[0]!))!) !== key(from)) path.unshift(prev.get(key(path[0]!))!);
          return path;
        }
        next.push(n);
      }
    frontier = next;
  }
  return [];
}

function fresh(): State {
  const hedges = shuffle(CELLS.filter((c) => ring(c) > 1 && ring(c) <= LAND))
    .slice(0, 9 + Math.floor(Math.random() * 3))
    .map(key);
  const robot = { q: 0, r: 0 };
  return {
    robot,
    colour: Math.floor(Math.random() * 4),
    hedges,
    crates: [],
    outcome: "playing",
  };
}

/** Fence the robot in with crates before it walks into the sea. */
function RoundUp({ state: s, setState, finish, over }: GameProps<State>) {
  const hedges = new Set(s.hedges);
  const placed = new Set(s.crates);
  const play = (c: Hex) => {
    const k = key(c);
    if (over || ring(c) > LAND || hedges.has(k) || placed.has(k) || k === key(s.robot)) return;
    const crates = [...s.crates, k];
    const blocked = (b: string) => hedges.has(b) || b === k || placed.has(b);
    const path = route(s.robot, blocked);
    if (!path.length) return finish(crates.length, { ...s, crates, outcome: "won" });
    if (crates.length % PER_STEP) return setState({ ...s, crates });
    const robot = path[0]!;
    if (ring(robot) === R) return finish(null, { ...s, crates, robot, outcome: "lost" });
    setState({ ...s, crates, robot });
  };
  const at = pointy(s.robot, SIZE);
  return (
    <div className="game">
      <GameBar>
        <span>
          Crates <b>{s.crates.length}</b>
        </span>
        {s.outcome === "playing" && (
          <span className="rc-moves">
            {PER_STEP - (s.crates.length % PER_STEP) === 1 ? "Robot moves next" : `${PER_STEP} crates per step`}
          </span>
        )}
      </GameBar>
      <svg className="game-board sea" viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} width={W} height={H}>
        {CELLS.map((c) => {
          const { x, y } = pointy(c, SIZE);
          const k = key(c);
          if (ring(c) > LAND) return <polygon key={k} className="rc-sea" points={corners(x, y, SIZE - 0.6)} />;
          const hedge = hedges.has(k);
          const crate = placed.has(k);
          return (
            <g key={k} className={`rc-cell${hedge || crate ? " blocked" : ""}`} data-hex={k} onClick={() => play(c)}>
              <polygon points={corners(x, y, SIZE - 0.6)} />
              {hedge && <Sprite art={propArt("topiary")} x={x} y={y - 2} size={SIZE * 1.7} />}
              {crate && <Sprite art={propArt("crates")} x={x} y={y - 1} size={SIZE * 1.7} />}
            </g>
          );
        })}
        <g className={`rc-robot ${s.outcome}`} style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
          <Sprite art={robotArt(s.colour)} y={-4} size={SIZE * 2.5} />
        </g>
      </svg>
      <p className="game-note">
        {s.outcome === "won"
          ? `Fenced in with ${s.crates.length} crate${s.crates.length === 1 ? "" : "s"}!`
          : s.outcome === "lost"
            ? "It swam off."
            : s.crates.length === 0
              ? "Fence the robot in before it reaches the sea. It takes one step toward the nearest water for every two crates you drop."
              : "Click a tile to drop a crate."}
      </p>
    </div>
  );
}

export const roundUp: GameDef<State> = { id: "roundup", init: fresh, View: RoundUp };
