import { robotArt, shuffle, Sprite } from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";
import "./Bays.css";

const BAYS = 5;
const DEPTH = 4;
const COLOURS = 3;
const LIMIT = 80;
const BW = 56;
const GAP = 12;
const SLOT = 46;
const W = BAYS * BW + (BAYS - 1) * GAP + 28;
const TOP = 62;
const BOTTOM = TOP + DEPTH * SLOT + 12;
const H = BOTTOM + 14;
/** Where a lifted robot hovers, above its bay. */
const LIFT = 32;

type State = {
  /** Robots in each bay, bottom first. A robot is an id; its colour is id / DEPTH. */
  bays: number[][];
  /** The bay whose top robot is lifted, if any. */
  lifted: number | null;
  moves: number;
};

const colour = (robot: number) => Math.floor(robot / DEPTH);
const top = (bay: number[]) => bay[bay.length - 1];

/** Whether the top robot of bay `a` may be set down on bay `b`. */
const fits = (bays: number[][], a: number, b: number) => {
  const from = top(bays[a]!);
  const to = bays[b]!;
  if (a === b || from == null || to.length >= DEPTH) return false;
  return !to.length || colour(top(to)!) === colour(from);
};

const sorted = (bays: number[][]) =>
  bays.every((b) => !b.length || (b.length === DEPTH && b.every((r) => colour(r) === colour(b[0]!))));

/** Any move that changes something: a lone robot hopping to an empty bay doesn't. */
const canMove = (bays: number[][]) =>
  bays.some((from, a) =>
    bays.some((to, b) => fits(bays, a, b) && !(from.length === 1 && !to.length)),
  );

function fresh(): State {
  let robots: number[];
  do robots = shuffle(Array.from({ length: COLOURS * DEPTH }, (_, i) => i));
  while (sorted([0, 1, 2].map((b) => robots.slice(b * DEPTH, (b + 1) * DEPTH))));
  const bays = Array.from({ length: BAYS }, (_, b) =>
    b < COLOURS ? robots.slice(b * DEPTH, (b + 1) * DEPTH) : [],
  );
  return { bays, lifted: null, moves: 0 };
}

const bayX = (b: number) => -W / 2 + 14 + b * (BW + GAP);

/** Sort the robots into bays of one colour each, moving one at a time. */
function Bays({ state: s, setState, finish, over }: GameProps<State>) {
  const left = LIMIT - s.moves;
  const click = (b: number) => {
    if (over) return;
    if (s.lifted == null) {
      if (s.bays[b]!.length) setState({ ...s, lifted: b });
      return;
    }
    if (!fits(s.bays, s.lifted, b)) return setState({ ...s, lifted: null });
    const robot = top(s.bays[s.lifted]!)!;
    const bays = s.bays.map((bay, i) =>
      i === s.lifted ? bay.slice(0, -1) : i === b ? [...bay, robot] : bay,
    );
    const next: State = { bays, lifted: null, moves: s.moves + 1 };
    if (sorted(bays)) finish(next.moves, next);
    else if (next.moves >= LIMIT || !canMove(bays)) finish(null, next);
    else setState(next);
  };
  const robots = s.bays.flatMap((bay, b) =>
    bay.map((robot, i) => {
      const up = s.lifted === b && i === bay.length - 1;
      return { robot, x: bayX(b) + BW / 2, y: up ? LIFT : BOTTOM - 6 - (i + 0.5) * SLOT, up };
    }),
  );
  return (
    <div className="game">
      <GameBar>
        <span>
          Moves <b>{s.moves}</b>
        </span>
        {!over && left <= 15 && <span className="by-left">{left} left</span>}
      </GameBar>
      <svg className="game-board sea" viewBox={`${-W / 2} 0 ${W} ${H}`} width={W} height={H}>
        {s.bays.map((bay, b) => {
          const full = bay.length === DEPTH && bay.every((r) => colour(r) === colour(bay[0]!));
          const open = s.lifted != null && fits(s.bays, s.lifted, b);
          return (
            <g
              key={b}
              className={`by-bay${open ? " open" : ""}${full ? " full" : ""}`}
              onClick={() => click(b)}
            >
              <rect className="by-hit" x={bayX(b) - GAP / 2} y={0} width={BW + GAP} height={H} />
              <rect className="by-frame" x={bayX(b)} y={TOP} width={BW} height={BOTTOM - TOP} rx={14} />
              {Array.from({ length: DEPTH - 1 }, (_, i) => (
                <line
                  key={i}
                  className="by-rung"
                  x1={bayX(b) + 8}
                  x2={bayX(b) + BW - 8}
                  y1={BOTTOM - 6 - (i + 1) * SLOT}
                  y2={BOTTOM - 6 - (i + 1) * SLOT}
                />
              ))}
            </g>
          );
        })}
        {robots.map(({ robot, x, y, up }) => (
          <g
            key={robot}
            className={`by-robot${up ? " up" : ""}`}
            style={{ transform: `translate(${x}px, ${y}px)` }}
          >
            <Sprite art={robotArt(colour(robot))} size={SLOT + 4} />
          </g>
        ))}
      </svg>
      <p className="game-note">
        {over
          ? sorted(s.bays)
            ? `Sorted in ${s.moves} moves!`
            : s.moves >= LIMIT
              ? "Out of moves."
              : "No moves left."
          : s.lifted != null
            ? "Set it down on an empty bay or a robot of its colour."
            : "Sort the robots so each bay holds four of one colour. Click a bay to lift its top robot."}
      </p>
    </div>
  );
}

export const bays: GameDef<State> = { id: "bays", init: fresh, View: Bays };
