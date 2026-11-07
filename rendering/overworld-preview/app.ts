// The app's Overworld as the macOS app draws it: the page's OverworldMap message (painted tiles, robots,
// state lights and anything else it posts), composited here in depth order over the repeated sea tile.
// Pulses and frame cycling are left out: each streamer shows its first frame at full strength.
import type { AtlasData } from "../src/world.ts";
import type { Sheets } from "../src/overworld/atlas.ts";
import { OverworldMap, WORLD } from "../src/overworld/native.ts";

type Placed = { key: string; png?: string; x: number; y: number; width: number; height: number; depth?: number; alpha?: number };

export async function paintApp(sheets: Sheets, data: AtlasData, aspect: number, k: number): Promise<HTMLCanvasElement> {
  const made = new Map<string, HTMLCanvasElement>();
  const byKey = new Map<string, HTMLCanvasElement>();
  const png = (c: HTMLCanvasElement) => {
    const id = `c${made.size}`;
    made.set(id, c);
    return id;
  };
  let last = performance.now();
  const map = new OverworldMap(sheets, png, () => (last = performance.now()));
  let message = map.message(data, 1, aspect);
  // Wait for every host to be painted (each paints a few frames after the last).
  while (performance.now() - last < 600) await new Promise((r) => setTimeout(r, 100));
  const keep = (m: Record<string, unknown>) => {
    for (const list of ["pieces", "streamers", "images"] as const)
      for (const p of (m[list] as Placed[] | undefined) ?? []) if (p.png && made.has(p.png)) byKey.set(p.key, made.get(p.png)!);
  };
  keep(message);
  message = map.message(data, 2, aspect);
  keep(message);
  const bounds = message.bounds as { width: number; height: number };
  const s = k / WORLD;
  const c = document.createElement("canvas");
  c.width = Math.ceil(bounds.width * s);
  c.height = Math.ceil(bounds.height * s);
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  const sea = byKey.get("ow-sea");
  const tile = message.seaTile as { width: number } | undefined;
  if (sea && tile) {
    const pattern = g.createPattern(sea, "repeat")!;
    pattern.setTransform(new DOMMatrix().scale((tile.width * s) / sea.width));
    g.fillStyle = pattern;
    g.fillRect(0, 0, c.width, c.height);
  }
  const all = [...(message.pieces as Placed[]), ...(message.streamers as Placed[])].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  for (const p of all) {
    const img = byKey.get(p.key);
    if (!img) continue;
    g.globalAlpha = p.alpha ?? 1;
    g.drawImage(img, p.x * s, p.y * s, p.width * s, p.height * s);
  }
  g.globalAlpha = 1;
  return c;
}

const claude = "claude/claude-opus-5-5";
/** Shaped like the user's own fleet (two hosts, Claude agents across a few states). Illustrative. */
export const USER_LIKE: AtlasData = {
  hosts: [
    { key: "local", name: "local", online: true, local: true, stats: { cpu: 33, memory: 59, disk: 69 } },
    { key: "lab", name: "diagonal-lab-1", online: true, local: false, stats: { cpu: 22, memory: 32, disk: 25 } },
  ],
  projects: [
    { key: "local/diagonal", host: "local", name: "diagonal-hq/diagonal" },
    { key: "local/paseo-command", host: "local", name: "paseo-command" },
    { key: "lab/diagonal", host: "lab", name: "diagonal-hq/diagonal" },
  ],
  workspaces: [
    { key: "w1", host: "local", project: "local/diagonal", name: "lucky-meadow-c023", created: "2026-11-01" },
    { key: "w2", host: "local", project: "local/paseo-command", name: "proud-breeze-21f6", created: "2026-11-02" },
    { key: "w3", host: "local", project: "local/paseo-command", name: "jolly-beacon-fede", created: "2026-11-03" },
    { key: "w4", host: "lab", project: "lab/diagonal", name: "steady-beacon-58fb", created: "2026-11-01" },
    { key: "w5", host: "lab", project: "lab/diagonal", name: "de-8233-type-workflow", created: "2026-11-02", labels: ["CI green"] },
    { key: "w6", host: "lab", project: "lab/diagonal", name: "de-8237-declare-a-workflow", created: "2026-11-03", labels: ["CI green", "Approved"], autoMerge: true },
  ],
  agents: [
    { key: "a1", host: "local", project: "local/diagonal", workspace: "w1", name: "a1", model: claude, state: "asking" },
    { key: "a2", host: "local", project: "local/paseo-command", workspace: "w2", name: "a2", model: claude, state: "running" },
    { key: "a3", host: "local", project: "local/paseo-command", workspace: "w3", name: "a3", model: claude, state: "running" },
    { key: "a4", host: "lab", project: "lab/diagonal", workspace: "w4", name: "a4", model: claude, state: "idle" },
    { key: "a5", host: "lab", project: "lab/diagonal", workspace: "w5", name: "a5", model: "codex/gpt-6.1-sol", state: "done" },
    { key: "a6", host: "lab", project: "lab/diagonal", workspace: "w6", name: "a6", model: claude, state: "failed" },
  ],
};
