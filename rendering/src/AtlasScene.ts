import Phaser from "phaser";
import { renderDensity } from "./display";
import { registerFrames, sprite } from "./textures";
import { drawTerrain, paintGround, paintClouds, paintWater, paintGlints, WATER } from "./terrain";
import {
  point,
  HEX_RADIUS,
  type AtlasLayout,
  type AtlasData,
  layoutAtlas,
  type Entity,
  footprint,
  insideFootprint,
  fittedWidth,
  landBounds,
  footprintEdges,
  cellBounds,
  ROBOT_SIZE,
  structureCentre,
  STATE_TILE,
  random,
  seedOf,
  type Axial,
  type State,
} from "./world";
import buildingsUrl from "./assets/buildings.png";
import robotsUrl from "./assets/robots.png";
import foliageUrl from "./assets/tree-v2.png";
import sandUrl from "./assets/sand.png";
const MAX_ZOOM = 2.4;
/** Landmark art as a share of the largest size that fits its cells. */
const LANDMARK_SCALE: Record<string, number> = {
  manor: 0.78,
  observatory: 0.8,
  conservatory: 0.92,
};
/** How far a cottage sits above its cell's centre. */
/** Widest a cottage is drawn, across its workspace's three cells. */
const COTTAGE_SIZE = 220;
/** How far a cottage stands above the middle of its three cells. */
const COTTAGE_LIFT = 12;
/** How far a garden plant sits beyond its cell's centre, away from the cottage
 * (as a share of the distance between them). */
const GARDEN_OUT = 0.32;
/** How far landmark art sits above the middle of its cells. */
const LANDMARK_LIFT = 30;
/** Screen room (CSS pixels) kept for the map's toolbar and help line. */
const OVERLAY_TOP = 76;
const OVERLAY_BOTTOM = 72;
const LABEL_FONT = "Georgia, serif";
/** A subagent's drone, and how long it takes to circle its agent (ms). */
const DRONE_SIZE = 24;
const DRONE_ORBIT = 7000;
/** How far a working robot wanders from its cell's centre, and how fast (px/s). */
const WANDER_X = 13;
const WANDER_Y = 10;
const WALK_SPEED = 8;
/** How fast a walking robot turns toward its next spot (radians/s). */
const TURN_SPEED = 1.3;
/** Each kind's hover border, so what the pointer is over reads at a glance. */
const HOVER_COLOR: Record<Entity["kind"], number> = {
  host: 0xffffff,
  project: 0xffc83d,
  workspace: 0xff7f32,
  agent: 0x4fe6dc,
};
const vectors = (points: { x: number; y: number }[]) =>
  points.map((p) => new Phaser.Math.Vector2(p.x, p.y));
type Box = { x: number; y: number; width: number; height: number };
/** Screen position in CSS pixels relative to the canvas. */
export type ScreenPoint = { x: number; y: number };
export class AtlasScene extends Phaser.Scene {
  private water!: Phaser.GameObjects.TileSprite;
  private glints!: Phaser.GameObjects.TileSprite;
  private clouds!: Phaser.GameObjects.TileSprite;
  private drift = 0;
  private selected!: Phaser.GameObjects.Graphics;
  private selectGlow!: Phaser.GameObjects.Graphics;
  private halo?: Phaser.Filters.Glow;
  private hover!: Phaser.GameObjects.Graphics;
  private locations = new Map<string, Box>();
  private controls?: Phaser.Cameras.Controls.FixedKeyControl;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private down?: { x: number; y: number; scrollX: number; scrollY: number };
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private layout: AtlasLayout | null = null;
  private pending: AtlasLayout | null = null;
  private world: Phaser.GameObjects.GameObject[] = [];
  private agentLayer: Phaser.GameObjects.GameObject[] = [];
  private terrainKeys: string[] = [];
  private builds = 0;
  /** Agent tiles whose borders move, driven by the clock (not tweens) so a
   * redraw carries on where it was, each at its own seeded phase. */
  private moving: {
    graphics: Phaser.GameObjects.Graphics;
    period: number;
    phase: number;
    corners?: { x: number; y: number }[];
  }[] = [];
  private clock = 0;
  private drones: {
    drone: Phaser.GameObjects.Image;
    shadow: Phaser.GameObjects.Ellipse;
    robot: Phaser.GameObjects.Container;
    phase: number;
  }[] = [];
  private robots: {
    id: string;
    image: Phaser.GameObjects.Container;
    hands: { image: Phaser.GameObjects.Image; x: number; y: number }[];
    x: number;
    y: number;
    busy: boolean;
  }[] = [];
  /** Where each working robot has walked to in its cell, kept across redraws. */
  private walkers = new Map<
    string,
    {
      x: number;
      y: number;
      heading: number;
      tx: number;
      ty: number;
      pause: number;
      look: number;
      rng: () => number;
      stride: number;
      phase: number;
    }
  >();
  /** The state each workspace tile shows. */
  private tiles = new Map<string, State>();
  private created = false;
  private fitted = false;
  constructor() {
    super("atlas");
  }
  preload(): void {
    this.load.image("buildings", buildingsUrl);
    this.load.image("robots", robotsUrl);
    this.load.image("foliage", foliageUrl);
    this.load.image("sand", sandUrl);
    this.load.on("loaderror", (file: Phaser.Loader.File) =>
      this.game.events.emit(
        "atlas:error",
        `Could not load ${file.key}. Reload the world to retry.`,
      ),
    );
  }
  create(): void {
    registerFrames(this);
    paintGround(this);
    paintWater(this);
    paintGlints(this);
    paintClouds(this);
    // The tiled layers wrap in the shader; mipmapped, each wrap line samples
    // a blurred level and shows as a seam. Their soft noise needs no mipmaps.
    for (const key of ["water", "glints", "clouds"])
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.water = this.add
      .tileSprite(0, 0, 16, 16, "water")
      .setOrigin(0)
      .setDepth(-10);
    this.glints = this.add
      .tileSprite(0, 0, 16, 16, "glints")
      .setOrigin(0)
      .setDepth(-9.5)
      .setTileScale(1.6)
      .setAlpha(0.7);
    // Cloud shadows pass over the land and buildings but never over labels or robots.
    this.clouds = this.add
      .tileSprite(0, 0, 16, 16, "clouds")
      .setOrigin(0)
      .setDepth(20)
      .setTileScale(6)
      .setAlpha(0.2);
    this.cameras.main.setBackgroundColor(WATER);
    this.hover = this.add.graphics().setDepth(7);
    this.selected = this.add.graphics().setDepth(8);
    this.selectGlow = this.add.graphics().setDepth(7.9);
    this.halo = this.selected.enableFilters().filters?.external.addGlow(0xffc72e, 4, 0, 1, false, 10, 18);
    this.configureInput();
    const resize = () => this.fit();
    this.scale.on("resize", resize);
    this.events.once("shutdown", () => this.scale.off("resize", resize));
    this.created = true;
    if (this.pending) this.setLayout(this.pending);
    this.game.events.emit("atlas:ready");
    this.reportCamera();
  }
  /** Draw a fleet, laid out for a viewport of the given width over height. */
  setData(data: AtlasData, aspect: number): void {
    this.setLayout(layoutAtlas(data, aspect));
  }
  /** Replace the drawn fleet. Unchanged cell assignments only redraw the robots. */
  setLayout(layout: AtlasLayout): void {
    if (!this.created) {
      this.pending = layout;
      return;
    }
    this.pending = null;
    const structural = this.layout?.signature !== layout.signature;
    this.layout = layout;
    if (structural) this.rebuild();
    else {
      for (const o of this.agentLayer.splice(0)) o.destroy();
      this.agentLayer = this.capture(() => {
        this.agentTiles(layout);
        for (const a of layout.agents) this.agent(a);
      });
    }
    // A vanished selection clears quietly; the app decides what is selected.
    if (this.selectedId && !this.entity(this.selectedId)) this.selectedId = null;
    this.drawSelection();
    if (this.hoveredId && !this.entity(this.hoveredId)) this.setHover(null);
    if (!this.fitted) {
      this.fitted = true;
      this.fit();
    }
  }
  private capture(build: () => void): Phaser.GameObjects.GameObject[] {
    const before = new Set(this.children.list);
    build();
    return this.children.list.filter((o) => !before.has(o));
  }
  private rebuild(): void {
    const layout = this.layout!;
    this.tweens.killAll();
    for (const o of [...this.world, ...this.agentLayer]) o.destroy();
    for (const key of this.terrainKeys) this.textures.remove(key);
    this.locations.clear();
    this.hover.clear();
    const build = ++this.builds;
    this.world = this.capture(() => {
      this.terrainKeys = drawTerrain(this, layout, build);
      for (const p of layout.projects) this.landmark(p);
      for (const ws of layout.workspaces) this.workspace(ws);
      for (const h of layout.hosts) this.host(h);
    });
    this.agentLayer = this.capture(() => {
      this.agentTiles(layout);
      for (const a of layout.agents) this.agent(a);
    });
  }
  private entity(id: string): Entity | undefined {
    return this.layout?.entities.find((e) => e.id === id);
  }
  private polygon(
    x: number,
    y: number,
    r: number,
    color: number,
    alpha: number,
    line = 0x9d895f,
    width = 0.9,
  ): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    const points = Array.from({ length: 6 }, (_, i) => ({
      x: x + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * r,
      y: y + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * r,
    }));
    g.fillStyle(color, alpha).fillPoints(vectors(points), true);
    g.lineStyle(width, line, 0.65).strokePoints(vectors(points), true);
    return g;
  }
  /** World-scale text, shortened with an ellipsis to a fixed world width. */
  private caption(
    text: string,
    size: number,
    maxWidth: number,
    style: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {},
  ): Phaser.GameObjects.Text {
    const caption = this.add
      .text(0, 0, text, {
        fontFamily: LABEL_FONT,
        fontSize: `${size}px`,
        color: "#3e3322",
        ...style,
      })
      .setOrigin(0.5)
      .setResolution(3 * renderDensity());
    let shown = text;
    while (caption.width > maxWidth && shown.length > 1) {
      shown = shown.slice(0, -1);
      caption.setText(shown.trimEnd() + "…");
    }
    return caption;
  }
  private ribbon(
    x: number,
    y: number,
    text: string,
    kind: "host" | "project",
    maxWidth: number,
    faded = false,
  ): Phaser.GameObjects.Container {
    const host = kind === "host";
    const group = this.add.container(x, y).setDepth(23);
    const caption = this.caption(text, host ? 29 : 21, maxWidth, {
      fontStyle: host ? "normal" : "bold",
      letterSpacing: host ? 5 : 0,
      color: faded ? "#6d6656" : "#3e3322",
    });
    const width = Math.max(host ? 150 : 90, caption.width + (host ? 56 : 34)),
      height = host ? 38 : 26;
    const g = this.add.graphics();
    group.add(g);
    group.setData("labelKind", kind);
    const l = -width / 2,
      r = width / 2,
      t = -height / 2,
      b = height / 2;
    const tails = [
      [
        { x: l - 17, y: t + 5 },
        { x: l + 10, y: t + 7 },
        { x: l + 10, y: b + 10 },
        { x: l - 19, y: b + 8 },
        { x: l - 11, y: 3 },
      ],
      [
        { x: r + 17, y: t + 5 },
        { x: r - 10, y: t + 7 },
        { x: r - 10, y: b + 10 },
        { x: r + 19, y: b + 8 },
        { x: r + 11, y: 3 },
      ],
    ];
    g.fillStyle(0x6e5936, 0.13).fillRoundedRect(l + 3, t + 5, width, height, 2);
    g.fillStyle(faded ? 0xc9c1a8 : 0xdcc995).lineStyle(1.2, 0x8c7447);
    for (const tail of tails) {
      g.fillPoints(vectors(tail), true);
      g.strokePoints(vectors(tail), true);
    }
    g.fillStyle(faded ? 0xe2dccb : 0xf5e8bd).fillRoundedRect(l, t, width, height, 3);
    g.lineStyle(1.4, 0x8c7447).strokeRoundedRect(l, t, width, height, 3);
    g.lineStyle(0.7, 0xfff7d9, 0.8).lineBetween(l + 4, t + 4, r - 4, t + 4);
    group.add(caption);
    return group;
  }
  private hit(
    entity: Entity,
    x: number,
    y: number,
    width: number,
    height: number,
    depth = 30,
    /** Anywhere in the rectangle, rather than only on the entity's cells. */
    anywhere = entity.kind === "agent",
  ): void {
    this.locations.set(entity.id, { x, y, width, height });
    const zone = this.add
      .zone(x, y, width, height)
      .setDepth(depth)
      .setInteractive({
        useHandCursor: true,
        hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
        // A custom callback replaces Phaser's own bounds test, so it checks both.
        hitAreaCallback: (
          area: Phaser.Geom.Rectangle,
          localX: number,
          localY: number,
        ) =>
          Phaser.Geom.Rectangle.Contains(area, localX, localY) &&
          (anywhere ||
            insideFootprint(
              x + localX - width / 2,
              y + localY - height / 2,
              this.cellsOf(entity),
            )),
      });
    zone.on("pointerover", () => this.setHover(entity.id));
    zone.on("pointerout", () => {
      if (this.hoveredId === entity.id) this.setHover(null);
    });
    zone.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (Phaser.Math.Distance.Between(p.downX, p.downY, p.x, p.y) < 7)
        this.pick(entity.id);
    });
  }
  private setHover(id: string | null): void {
    this.hoveredId = id;
    this.hover.clear();
    const entity = id ? this.entity(id) : undefined;
    if (entity) this.outlineCells(this.hover, entity, 4, HOVER_COLOR[entity.kind]);
    this.game.events.emit(
      "atlas:hover",
      entity ?? null,
      entity ? this.screenOf(entity.id) : null,
    );
  }
  /** A user's choice on the map. Hosts frame their island instead. */
  private pick(id: string): void {
    const entity = this.entity(id);
    if (!entity) return;
    this.game.events.emit("atlas:pick", entity);
  }
  /**
   * Trace an entity's outer perimeter. `inset` keeps the stroke wholly inside
   * its cells, so painted kerbs and banks beside them never cut into it; each
   * side is pulled in toward its own cell, and the steps where two cells meet
   * are bridged.
   */
  private outlineCells(
    graphics: Phaser.GameObjects.Graphics,
    entity: Entity,
    width: number,
    color: number,
    alpha = 0.95,
    inset = true,
  ): void {
    const cells = this.cellsOf(entity);
    const key = (p: { x: number; y: number }) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
    const shrink = inset ? width / 2 / Math.cos(Math.PI / 6) : 0;
    const sides = new Map<string, { a: { x: number; y: number }; b: { x: number; y: number }; ia: { x: number; y: number }; ib: { x: number; y: number } }>();
    for (const cell of cells) {
      const c = point(cell);
      const corner = (i: number, r: number) => ({
        x: c.x + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * r,
        y: c.y + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * r,
      });
      for (let i = 0; i < 6; i++) {
        const a = corner(i, HEX_RADIUS),
          b = corner(i + 1, HEX_RADIUS),
          id = [key(a), key(b)].sort().join(":");
        if (sides.has(id)) sides.delete(id);
        else sides.set(id, { a, b, ia: corner(i, HEX_RADIUS - shrink), ib: corner(i + 1, HEX_RADIUS - shrink) });
      }
    }
    graphics.setData("edgeCount", sides.size);
    graphics.lineStyle(width, color, alpha).fillStyle(color, alpha);
    // Each perimeter corner, with the inset ends that meet there.
    const ends = new Map<string, { x: number; y: number }[]>();
    for (const { a, b, ia, ib } of sides.values()) {
      graphics.lineBetween(ia.x, ia.y, ib.x, ib.y);
      for (const [p, q] of [[a, ia], [b, ib]] as const) {
        const list = ends.get(key(p)) ?? [];
        list.push(q);
        ends.set(key(p), list);
      }
    }
    for (const list of ends.values()) {
      for (const p of list) graphics.fillCircle(p.x, p.y, width / 2);
      if (list.length === 2 && key(list[0]!) !== key(list[1]!))
        graphics.lineBetween(list[0]!.x, list[0]!.y, list[1]!.x, list[1]!.y);
    }
  }
  /** The cells an entity covers; a host covers its whole landmass. */
  private cellsOf(entity: Entity): Axial[] {
    if (entity.kind !== "host") return footprint(entity);
    return this.layout!.land
      .filter((mass) => mass.host === entity.id)
      .flatMap((mass) => mass.cells);
  }
  private host(h: Entity): void {
    const islands = this.layout!.islands.filter((i) => i.host === h.id);
    const island = { online: islands.every((i) => i.online) };
    const bounds = cellBounds(islands.flatMap((i) => i.cells));
    // The banner stands on the landmass's northern shore.
    const x = bounds.x + bounds.width / 2,
      y = bounds.y - HEX_RADIUS * 0.75;
    const name = h.name.toUpperCase() + (island.online ? "" : " · OFFLINE");
    this.ribbon(x, y, name, "host", Math.max(260, bounds.width - 80), !island.online);
    // Neither the banner nor the land is interactive; the Hosts tab picks a host.
    this.locations.set(h.id, {
      x,
      y: bounds.y + bounds.height / 2 - 20,
      width: bounds.width,
      height: bounds.height + 80,
    });
  }
  private landmark(p: Entity): void {
    const at = structureCentre(p),
      cells = footprint(p);
    // Size the building for the courtyard's middle, then lift it toward the
    // top as far as that size still fits inside its cells.
    const image = sprite(this, at.x, at.y, p.art!, 420).setDepth(15);
    const aspect = image.width / image.height;
    const size = fittedWidth(at.x, at.y, aspect, 420, cells) * (LANDMARK_SCALE[p.art!] ?? 0.9);
    let lift = LANDMARK_LIFT;
    while (lift > 0 && fittedWidth(at.x, at.y - lift, aspect, 420, cells) < size) lift -= 2;
    image.setY(at.y - lift).setScale(size / image.width);
    image.setData("footprint", cells);
    if (p.stale) image.setAlpha(0.6);
    this.ribbon(at.x, at.y + 112, p.name, "project", 250, p.stale);
    this.hit(p, at.x, at.y, HEX_RADIUS * Math.sqrt(3) * 4, HEX_RADIUS * 5, 25);
  }
  private workspace(ws: Entity): void {
    const cells = footprint(ws);
    // The cottage stands in the middle of its three cells.
    const at = structureCentre(ws);
    if (ws.camp) {
      // No cottage: the daemon reports these agents without a workspace.
      const g = this.add.graphics().setDepth(16);
      g.lineStyle(2, 0x7b6340).lineBetween(at.x - 6, at.y + 6, at.x - 6, at.y - 30);
      g.fillStyle(0xc75136).fillTriangle(
        at.x - 5,
        at.y - 30,
        at.x + 18,
        at.y - 23,
        at.x - 5,
        at.y - 16,
      );
      g.fillStyle(0x7b6340, 0.35).fillEllipse(at.x - 6, at.y + 7, 18, 6);
    } else {
      // Raised a little, so its porch and shrubs don't read as sitting low.
      const y = at.y - COTTAGE_LIFT;
      const image = sprite(this, at.x, y, ws.art!, COTTAGE_SIZE).setDepth(16);
      image.setScale(
        fittedWidth(at.x, y, image.width / image.height, COTTAGE_SIZE, cells) /
          image.width,
      );
      image.setData("footprint", cells);
      this.garden(ws, cells, at);
      if (ws.stale) image.setAlpha(0.6);
    }
    // No name plate: the workspace's name shows on hover.
    const area = cellBounds(cells);
    this.hit(ws, area.x + area.width / 2, area.y + area.height / 2, area.width, area.height, 29);
  }
  /** A tree and shrubs around a cottage: one in each of its workspace's
   * cells, toward the cell's outer side, each kept inside its own cell. */
  private garden(ws: Entity, cells: Axial[], middle: { x: number; y: number }): void {
    const rng = random(seedOf(ws.id + "garden"));
    const tree = Math.floor(rng() * cells.length);
    cells.forEach((cell, i) => {
      const c = point(cell);
      const x = c.x + (c.x - middle.x) * GARDEN_OUT,
        y = c.y + (c.y - middle.y) * GARDEN_OUT;
      const frame = i === tree ? "trees" : "shrub";
      const plant = sprite(this, x, y, frame, i === tree ? 56 : 38).setDepth(15.5);
      plant.setScale(
        Math.min(plant.displayWidth, fittedWidth(x, y, plant.width / plant.height, 60, [cell])) /
          plant.width,
      );
      // Mirrored at random for variety; never rotated, so it stays inside its cell.
      plant.setFlipX(rng() < 0.5);
      if (ws.stale) plant.setAlpha(0.6);
    });
  }
  /** An agent's state shows only on its sand tile: the tile's colour, its
   * border's colour, and how the border moves. Running borders carry a light
   * round them; states that need you pulse (failures fastest). Idle tiles stay
   * plain sand. */
  private agentTiles(layout: AtlasLayout): void {
    this.tiles.clear();
    this.moving = [];
    this.drones = [];
    this.robots = [];
    for (const a of layout.agents) {
      const state = a.state!;
      const color = STATE_TILE[state];
      if (color === undefined) continue;
      this.tiles.set(a.id, state);
      const at = point(a.position);
      const hex = (r: number) =>
        Array.from({ length: 6 }, (_, i) => ({
          x: at.x + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * r,
          y: at.y + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * r,
        }));
      const offline = state === "offline";
      const fill = this.add.graphics().setDepth(4);
      fill.fillStyle(color, offline ? 0.25 : 0.42).fillPoints(vectors(hex(HEX_RADIUS - 1)), true);
      fill.lineStyle(1.5, 0xfff8e6, 0.7).strokePoints(vectors(hex(HEX_RADIUS - 10.5)), true);
      const border = this.add.graphics().setDepth(4.1);
      border.lineStyle(9, color, offline ? 0.6 : 0.95).strokePoints(vectors(hex(HEX_RADIUS - 5.5)), true);
      // Each tile starts at its own point in the cycle, so they never move together.
      const phase = random(seedOf(a.id + "pulse"))();
      const pulse = { failed: 1200, approval: 1800, question: 1800, done: 3200 }[
        state as "failed"
      ];
      if (pulse) this.moving.push({ graphics: border, period: pulse, phase });
      else if (state === "running")
        this.moving.push({
          graphics: this.add.graphics().setDepth(4.2),
          period: 2200,
          phase,
          corners: hex(HEX_RADIUS - 5.5),
        });
    }
    this.animateTiles();
  }
  /** The selection's wash brightens and fades; steady with reduced motion. */
  private breathe(): void {
    const t = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin((this.clock / 1600) * Math.PI * 2);
    this.selectGlow.setAlpha(0.1 + 0.16 * t);
    if (this.halo) this.halo.outerStrength = 2.5 + 2.5 * t;
  }
  /** Pulsing borders fade in and out; running borders carry a light round
   * them, a sixth of their length. Still, with reduced motion. */
  private animateTiles(): void {
    for (const tile of this.moving) {
      const t = (this.reduced ? 0 : this.clock / tile.period) + tile.phase;
      if (!tile.corners) {
        tile.graphics.setAlpha(this.reduced ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2)));
        continue;
      }
      const corners = tile.corners;
      const at = (u: number) => {
        const f = (((u % 1) + 1) % 1) * 6,
          i = Math.floor(f),
          a = corners[i]!,
          b = corners[(i + 1) % 6]!;
        return { x: a.x + (b.x - a.x) * (f - i), y: a.y + (b.y - a.y) * (f - i) };
      };
      const light = tile.graphics.clear();
      // Brightest at its head, fading toward its tail.
      for (let k = 0; k < 12; k++) {
        const p = at(t - k / 72),
          q = at(t - (k + 1) / 72);
        light.lineStyle(7, 0xeafff2, 0.95 * (1 - k / 12)).lineBetween(p.x, p.y, q.x, q.y);
      }
    }
  }
  private agent(a: Entity): void {
    // Centred on its own cell.
    const { x, y } = point(a.position);
    const offline = a.state === "offline";
    // A body and two hands, so its arms can move.
    // Each hand's frame is the whole robot's, so all three share one origin.
    const body = sprite(this, 0, 0, `${a.art!}-body`, ROBOT_SIZE);
    const hands = ["l", "r"].map((side) => sprite(this, 0, 0, `${a.art!}-hand-${side}`, ROBOT_SIZE));
    const image = this.add.container(x, y, [body, ...hands]).setDepth(35);
    image.setData("agent", a.id);
    if (offline) for (const part of [body, ...hands]) part.setTint(0x9c9a92).setAlpha(0.7);
    // The whole cell answers the pointer; the robot is where it's pointed out.
    const cell = cellBounds([a.position]);
    this.hit(a, x, y, cell.width, cell.height, 40, false);
    this.locations.set(a.id, { x, y, width: ROBOT_SIZE + 10, height: ROBOT_SIZE + 10 });
    // A working robot potters about its cell; the rest stand still.
    const robot = {
      id: a.id,
      image,
      hands: hands.map((h) => ({ image: h, x: h.x, y: h.y })),
      x,
      y,
      busy: a.state === "running",
    };
    this.robots.push(robot);
    this.marker(a, robot);
  }
  /** Working robots potter about their cell: turn to face a spot, walk to it,
   * pause and look about, then pick another. Each keeps its place and heading
   * across redraws. Still, with reduced motion. */
  private walkRobots(delta: number): void {
    const step = Math.min(delta, 100) / 1000;
    for (const r of this.robots) {
      if (!r.busy || this.reduced) {
        r.image.setPosition(r.x, r.y).setRotation(0);
        for (const h of r.hands) h.image.setPosition(h.x, h.y);
        continue;
      }
      let w = this.walkers.get(r.id);
      if (!w) {
        const rng = random(seedOf(r.id + "walk"));
        w = { x: 0, y: 0, heading: Math.PI / 2, tx: 0, ty: 0, pause: rng() * 2000, look: Math.PI / 2, rng, stride: 0, phase: rng() * 10 };
        this.walkers.set(r.id, w);
      }
      const turn = (to: number, rate: number) => {
        const diff = Phaser.Math.Angle.Wrap(to - w!.heading);
        w!.heading += Phaser.Math.Clamp(diff, -rate * step, rate * step);
        return Math.abs(diff);
      };
      if (w.pause > 0) {
        w.pause -= step * 1000;
        turn(w.look, 0.7);
        if (w.pause <= 0) {
          // Somewhere else in the cell, a fair step away.
          for (let i = 0; i < 6; i++) {
            const a = w.rng() * Math.PI * 2,
              d = 0.45 + 0.55 * Math.sqrt(w.rng());
            w.tx = Math.cos(a) * WANDER_X * d;
            w.ty = Math.sin(a) * WANDER_Y * d;
            if (Math.hypot(w.tx - w.x, w.ty - w.y) > 7) break;
          }
        }
      } else {
        const dx = w.tx - w.x,
          dy = w.ty - w.y,
          dist = Math.hypot(dx, dy);
        const off = turn(Math.atan2(dy, dx), TURN_SPEED);
        // Walks once it roughly faces its spot, slowing as it arrives.
        if (off < 0.3) {
          const move = Math.min(dist, WALK_SPEED * step * Math.min(1, dist / 4 + 0.3));
          w.x += Math.cos(w.heading) * move;
          w.y += Math.sin(w.heading) * move;
          w.stride += move;
        }
        if (dist < 0.8) {
          w.pause = 1200 + w.rng() * 2400;
          w.look = w.heading + (w.rng() - 0.5) * 1.6;
        }
      }
      const walking = w.pause <= 0;
      const bob = walking ? Math.abs(Math.sin(w.stride * 0.55)) * 1.8 : 0;
      // Arms swing opposite each other in stride; at rest they tinker.
      const swing = walking
        ? Math.sin(w.stride * 0.55) * 3
        : Math.sin(this.clock / 260 + w.phase) * 1.6;
      r.hands.forEach((h, i) => {
        const side = i ? 1 : -1;
        h.image.setPosition(
          h.x + (walking ? 0 : side * Math.max(0, Math.sin(this.clock / 410 + w!.phase + i)) * 1.5),
          h.y + (i ? swing : -swing),
        );
      });
      // The robot's visor faces down its sprite (+y), so heading π/2 is no turn.
      r.image.setPosition(r.x + w.x, r.y + w.y - bob).setRotation(w.heading - Math.PI / 2);
    }
  }

  /** Lights for running helpers. State itself shows on the agent's tile. */
  /** Running subagents fly as small drones of the agent's own model, circling
   * it inside its cell, up to four. */
  private marker(a: Entity, robot: AtlasScene["robots"][number]): void {
    const { x, y } = robot;
    if (!a.subagents || a.state === "offline") return;
    const count = Math.min(4, a.subagents),
      phase = random(seedOf(a.id + "drones"))();
    for (let i = 0; i < count; i++) {
      const shadow = this.add.ellipse(x, y, 16, 6, 0x1d2a14, 0.28).setDepth(34);
      const drone = sprite(this, x, y, a.art!, DRONE_SIZE);
      this.drones.push({ drone, shadow, robot: robot.image, phase: phase + i / count });
    }
    this.flyDrones();
  }
  private flyDrones(): void {
    for (const d of this.drones) {
      const turn = ((this.reduced ? 0 : this.clock / DRONE_ORBIT) + d.phase) * Math.PI * 2;
      // Around the robot wherever it has wandered.
      const { x, y } = d.robot;
      const dx = Math.cos(turn) * 40,
        dy = Math.sin(turn) * 28,
        lift = 18 + (this.reduced ? 0 : Math.sin(turn * 3) * 2);
      d.shadow.setPosition(x + dx, y + dy + 10);
      // Behind the robot on the far side of its circle, in front on the near side.
      d.drone.setPosition(x + dx, y + dy + 10 - lift).setDepth(dy < 0 ? 34.5 : 35.5);
    }
  }

  private configureInput(): void {
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const cam = this.cameras.main;
      this.down = {
        x: p.x,
        y: p.y,
        scrollX: cam.scrollX,
        scrollY: cam.scrollY,
      };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.down) return;
      const cam = this.cameras.main;
      cam.scrollX = this.down.scrollX - (p.x - this.down.x) / cam.zoom;
      cam.scrollY = this.down.scrollY - (p.y - this.down.y) / cam.zoom;
      if (this.hoveredId) this.setHover(null);
    });
    this.input.on("pointerup", () => {
      this.down = undefined;
    });
    this.input.on("gameout", () => {
      if (this.hoveredId) this.setHover(null);
    });
    this.input.on(
      "wheel",
      (
        pointer: Phaser.Input.Pointer,
        _over: unknown,
        _dx: number,
        dy: number,
      ) => {
        const cam = this.cameras.main;
        const before = cam.getWorldPoint(pointer.x, pointer.y);
        cam.setZoom(
          Phaser.Math.Clamp(
            cam.zoom * Math.exp(-dy * 0.001),
            this.minimumZoom(),
            MAX_ZOOM * renderDensity(),
          ),
        );
        cam.preRender();
        const after = cam.getWorldPoint(pointer.x, pointer.y);
        cam.scrollX += before.x - after.x;
        cam.scrollY += before.y - after.y;
        if (this.hoveredId) this.setHover(null);
        this.reportCamera();
      },
    );
    const keyboard = this.input.keyboard;
    if (keyboard) {
      const cursors = keyboard.createCursorKeys();
      this.controls = new Phaser.Cameras.Controls.FixedKeyControl({
        camera: this.cameras.main,
        left: cursors.left,
        right: cursors.right,
        up: cursors.up,
        down: cursors.down,
        speed: 0.65,
      });
      keyboard.on("keydown-HOME", () => this.fit());
      keyboard.on("keydown-F", () => this.fit());
      keyboard.on("keydown-ESC", () => this.game.events.emit("atlas:pick", null));
    }
  }
  private mapExtent() {
    const bounds = this.layout
      ? landBounds(this.layout)
      : { x: -400, y: -300, width: 800, height: 600 };
    // Host banners stand on the open ground above their islands.
    // Room for each host's shores all round and its banner above (in world
    // units), and for the map's own floating controls (toolbar above, help
    // line below), which keep their screen size at any zoom.
    const marginX = HEX_RADIUS * 1.6,
      top = HEX_RADIUS * 1.6,
      bottom = HEX_RADIUS * 0.9;
    const density = renderDensity(),
      padTop = OVERLAY_TOP * density,
      padBottom = OVERLAY_BOTTOM * density;
    // The zoom at which land, world margins and overlays just fit; the
    // overlays' room is fixed at that zoom so the extent stays put.
    const zoom = Math.max(
      0.01,
      Math.min(
        this.scale.width / (bounds.width + marginX * 2),
        (this.scale.height - padTop - padBottom) /
          (bounds.height + top + bottom),
      ),
    );
    return {
      x: bounds.x - marginX,
      y: bounds.y - top - padTop / zoom,
      width: bounds.width + marginX * 2,
      height:
        bounds.height + top + bottom + (padTop + padBottom) / zoom,
    };
  }
  private minimumZoom(): number {
    const extent = this.mapExtent();
    return Math.min(
      this.scale.width / extent.width,
      this.scale.height / extent.height,
    );
  }
  fit(): void {
    const cam = this.cameras.main,
      extent = this.mapExtent();
    cam.setZoom(this.minimumZoom());
    cam.centerOn(extent.x + extent.width / 2, extent.y + extent.height / 2);
    this.reportCamera();
  }
  private constrainCamera(): void {
    const cam = this.cameras.main,
      extent = this.mapExtent();
    cam.setZoom(
      Phaser.Math.Clamp(
        cam.zoom,
        this.minimumZoom(),
        MAX_ZOOM * renderDensity(),
      ),
    );
    const w = cam.width / cam.zoom,
      h = cam.height / cam.zoom;
    const centerX = cam.scrollX + cam.width / 2,
      centerY = cam.scrollY + cam.height / 2;
    const x =
      w >= extent.width
        ? extent.x + extent.width / 2
        : Phaser.Math.Clamp(
            centerX,
            extent.x + w / 2,
            extent.x + extent.width - w / 2,
          );
    const y =
      h >= extent.height
        ? extent.y + extent.height / 2
        : Phaser.Math.Clamp(
            centerY,
            extent.y + h / 2,
            extent.y + extent.height - h / 2,
          );
    cam.centerOn(x, y);
  }
  command(command: string): void {
    if (command === "home") this.fit();
    if (command === "in" || command === "out") {
      this.cameras.main.setZoom(
        Phaser.Math.Clamp(
          this.cameras.main.zoom * (command === "in" ? 1.25 : 0.8),
          this.minimumZoom(),
          MAX_ZOOM * renderDensity(),
        ),
      );
      this.reportCamera();
    }
  }
  /**
   * Bring an entity into view. By default only pans, and only when it is not
   * already comfortably visible; `zoom` also frames it closer.
   */
  focus(id: string, zoom = false): void {
    const loc = this.locations.get(id),
      entity = this.entity(id);
    if (!loc || !entity) return;
    const cam = this.cameras.main;
    if (!zoom) {
      const v = cam.worldView,
        mx = v.width * 0.12,
        my = v.height * 0.12;
      const visible =
        loc.x > v.x + mx &&
        loc.x < v.x + v.width - mx &&
        loc.y > v.y + my &&
        loc.y < v.y + v.height - my;
      if (visible) return;
      if (this.reduced) cam.centerOn(loc.x, loc.y);
      else cam.pan(loc.x, loc.y, 380, "Cubic.easeOut", true);
      return;
    }
    const requestedZoom =
      entity.kind === "host"
        ? Math.min(
            (this.scale.width - 90 * renderDensity()) / loc.width,
            (this.scale.height - 80 * renderDensity()) / loc.height,
          )
        : entity.kind === "project"
          ? Math.min(1.5 * renderDensity(), this.scale.height / 650)
          : 1.5 * renderDensity();
    const level = Phaser.Math.Clamp(
      requestedZoom,
      this.minimumZoom(),
      MAX_ZOOM * renderDensity(),
    );
    if (this.reduced) {
      cam.setZoom(level);
      cam.centerOn(loc.x, loc.y);
    } else {
      cam.pan(loc.x, loc.y, 380, "Cubic.easeOut", true);
      cam.zoomTo(level, 380, "Cubic.easeOut", true);
    }
  }
  /** Highlight what the app has selected. Never reports back as a pick. */
  select(id: string | null): void {
    if (!this.created) return;
    this.selectedId = id && this.entity(id) ? id : null;
    this.drawSelection();
    this.game.events.emit(
      "atlas:selection",
      this.selectedId ? this.entity(this.selectedId) : null,
    );
  }
  private drawSelection(): void {
    this.selected.clear();
    const entity = this.selectedId ? this.entity(this.selectedId) : undefined;
    this.selectGlow.clear();
    if (!entity) return;
    // A golden rim with a breathing halo and a warm wash: clear on grass,
    // timber, flagstones and every tile colour.
    // Cells don't overlap, so the wash is even across the whole footprint.
    this.selectGlow.fillStyle(0xffe27a, 1);
    // A host is its whole landmass: rim and halo only, no wash over it all.
    for (const cell of entity.kind === "host" ? [] : this.cellsOf(entity)) {
      const c = point(cell);
      this.selectGlow.fillPoints(
        vectors(
          Array.from({ length: 6 }, (_, i) => ({
            x: c.x + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * (HEX_RADIUS + 0.5),
            y: c.y + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * (HEX_RADIUS + 0.5),
          })),
        ),
        true,
      );
    }
    this.outlineCells(this.selected, entity, 6, 0xffc72e, 1);
    this.breathe();
  }
  setInput(enabled: boolean): void {
    this.input.enabled = enabled;
    if (this.input.keyboard) this.input.keyboard.enabled = enabled;
    if (!enabled && this.hoveredId) this.setHover(null);
  }
  motion(reduced = !this.reduced): boolean {
    this.reduced = reduced;
    if (this.reduced) this.tweens.pauseAll();
    else this.tweens.resumeAll();
    this.animateTiles();
    this.walkRobots(0);
    this.flyDrones();
    return this.reduced;
  }
  thumbnail(entity: Entity): string {
    if (entity.kind === "agent" && entity.art)
      return this.textures.getBase64(`filtered-${entity.art}`, entity.art);
    return this.textures.getBase64("buildings", entity.art ?? "manor");
  }
  /** Canvas-relative CSS position of an entity. */
  screenOf(id: string): ScreenPoint | null {
    const loc = this.locations.get(id);
    if (!loc) return null;
    const cam = this.cameras.main,
      density = renderDensity();
    return {
      x: ((loc.x - cam.worldView.x) * cam.zoom) / density,
      y: ((loc.y - loc.height / 2 - cam.worldView.y) * cam.zoom) / density,
    };
  }
  inspect() {
    const layout = this.layout;
    return {
      scene: "atlas",
      renderer: "Phaser 4",
      selected: this.selectedId,
      hovered: this.hoveredId,
      selectionEdgeCount: this.selectedId
        ? this.selected.getData("edgeCount")
        : 0,
      islands: layout?.islands.map((i) => ({
        key: i.key,
        host: i.host,
        name: i.name,
        online: i.online,
        cells: i.cells.length,
      })),
      worldLabels: this.children.list
        .filter(
          (object) =>
            object instanceof Phaser.GameObjects.Container &&
            object.getData("labelKind"),
        )
        .map((object) => ({
          kind: object.getData("labelKind"),
          scaleX: (object as Phaser.GameObjects.Container).scaleX,
          scaleY: (object as Phaser.GameObjects.Container).scaleY,
        })),
      scenery: this.children.list
        .filter(
          (object) =>
            object instanceof Phaser.GameObjects.Image &&
            object.getData("sceneryCell"),
        )
        .map((object) => {
          const image = object as Phaser.GameObjects.Image;
          const b = image.getBounds();
          return {
            frame: image.frame.name,
            cell: image.getData("sceneryCell"),
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
          };
        }),
      selectedCells: this.selectedId
        ? footprint(this.entity(this.selectedId)!)
        : [],
      minimumZoom: this.minimumZoom() / renderDensity(),
      mapExtent: this.mapExtent(),
      structures: this.children.list
        .filter(
          (object) =>
            object instanceof Phaser.GameObjects.Image &&
            object.getData("footprint"),
        )
        .map((object) => {
          const image = object as Phaser.GameObjects.Image;
          return {
            x: image.x,
            y: image.y,
            width: image.displayWidth,
            height: image.displayHeight,
            cells: image.getData("footprint"),
          };
        }),
      motion: !this.reduced,
      zoom: this.cameras.main.zoom / renderDensity(),
      renderDensity: renderDensity(),
      viewport: {
        width: this.cameras.main.width,
        height: this.cameras.main.height,
      },
      projects: layout?.projects.map((p) => ({ id: p.id, name: p.name })),
      workspaces: layout?.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        project: w.project,
        camp: !!w.camp,
      })),
      agents: layout?.agents.map((a) => ({
        id: a.id,
        name: a.name,
        state: a.state,
        model: a.model,
        workspace: a.workspace,
        at: this.locations.get(a.id),
        screen: this.screenOf(a.id),
      })),
      tiles: Object.fromEntries(this.tiles),
      builds: this.builds,
      camera: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY },
      objects: this.children.length,
    };
  }
  private reportCamera(): void {
    this.game.events.emit(
      "atlas:zoom",
      this.cameras.main.zoom / renderDensity(),
    );
  }
  update(_time: number, delta: number): void {
    this.controls?.update(delta);
    this.constrainCamera();
    if (!this.reduced) {
      this.drift += delta * 0.006;
      this.clock += delta;
      this.animateTiles();
      this.breathe();
      this.walkRobots(delta);
      this.flyDrones();
    }
    // Ground and clouds cover exactly the visible view; their textures stay anchored to the world.
    // worldView trails a frame, so a margin covers fast pans and zooms.
    const view = this.cameras.main.worldView,
      pad = Math.max(view.width, view.height) * 0.25;
    // Clouds drift one way; the sea's glints drift slowly against them.
    for (const [layer, dx, dy] of [
      [this.water, 0, 0],
      [this.glints, -this.drift * 0.6, this.drift * 0.25],
      [this.clouds, this.drift, this.drift * 0.4],
    ] as const) {
      const scale = layer.tileScaleX;
      layer
        .setPosition(view.x - pad, view.y - pad)
        .setSize(view.width + pad * 2, view.height + pad * 2)
        .setTilePosition((view.x - pad - dx) / scale, (view.y - pad - dy) / scale);
    }
    if (this.cameras.main.zoomEffect.isRunning) this.reportCamera();
  }
}
