import Phaser from "phaser";
import { renderDensity } from "./display";
import { registerFrames, sprite } from "./textures";
import { drawTerrain, paintGround, paintClouds, paintWater, paintGlints, WATER } from "./terrain";
import {
  point,
  HEX_RADIUS,
  MODEL_COLORS,
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
/** Widest a cottage is drawn: it has a cell to itself. */
const COTTAGE_SIZE = 140;
/** How far landmark art sits above the middle of its cells. */
const LANDMARK_LIFT = 30;
const LABEL_FONT = "Georgia, serif";
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
      this.tweens.killAll();
      for (const o of this.agentLayer.splice(0)) o.destroy();
      this.agentLayer = this.capture(() => {
        this.agentTiles(layout);
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
          (entity.kind === "agent" ||
            entity.kind === "host" ||
            insideFootprint(
            x + localX - width / 2,
              y + localY - height / 2,
              footprint(entity),
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
    if (entity && entity.kind !== "host")
      this.outlineCells(this.hover, entity, 2, 0xa77d35);
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
  private outlineCells(
    graphics: Phaser.GameObjects.Graphics,
    entity: Entity,
    width: number,
    color: number,
  ): void {
    graphics.lineStyle(width, color, 0.95);
    const edges = footprintEdges(footprint(entity));
    graphics.setData("edgeCount", edges.length);
    for (const { a, b } of edges) graphics.lineBetween(a.x, a.y, b.x, b.y);
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
    this.hit(h, x, y, Math.min(bounds.width, 420), 44, 24);
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
    const at = point(ws.position);
    const cells = footprint(ws);
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
      // The cottage stands centred on its own cell, the one facing the
      // landmark; the workspace's other two cells are its yard.
      const image = sprite(this, at.x, at.y, ws.art!, COTTAGE_SIZE).setDepth(16);
      image.setScale(
        fittedWidth(at.x, at.y, image.width / image.height, COTTAGE_SIZE, [ws.position]) /
          image.width,
      );
      image.setData("footprint", [ws.position]);
      if (ws.stale) image.setAlpha(0.6);
    }
    // No name plate: the workspace's name shows on hover.
    const area = cellBounds(cells);
    this.hit(ws, area.x + area.width / 2, area.y + area.height / 2, area.width, area.height, 29);
  }
  /** Each agent's tile takes the colour of its state, so state reads at any
   * zoom; states that need you pulse. */
  private agentTiles(layout: AtlasLayout): void {
    this.tiles.clear();
    for (const a of layout.agents) {
      const state = a.state!;
      const color = STATE_TILE[state];
      if (color === undefined) continue;
      this.tiles.set(a.id, state);
      const at = point(a.position);
      const hex = (r: number) =>
        vectors(
          Array.from({ length: 6 }, (_, i) => ({
            x: at.x + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * r,
            y: at.y + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * r,
          })),
        );
      const g = this.add.graphics().setDepth(4);
      g.fillStyle(color, state === "offline" ? 0.25 : 0.42).fillPoints(hex(HEX_RADIUS - 1), true);
      g.lineStyle(9, color, 0.95).strokePoints(hex(HEX_RADIUS - 5.5), true);
      g.lineStyle(1.5, 0xfff8e6, 0.7).strokePoints(hex(HEX_RADIUS - 10.5), true);
      if (["failed", "approval", "question", "done"].includes(state)) {
        const tween = this.tweens.add({
          targets: g,
          alpha: { from: 0.55, to: 1 },
          duration: 900,
          repeat: -1,
          yoyo: true,
          ease: "Sine.easeInOut",
        });
        if (this.reduced) tween.pause();
      }
    }
  }
  private agent(a: Entity): void {
    // Centred on its own cell.
    const { x, y } = point(a.position);
    const offline = a.state === "offline";
    const image = sprite(this, x, y, a.art!, ROBOT_SIZE).setDepth(35);
    image.setData("agent", a.id);
    if (offline) image.setTint(0x9c9a92).setAlpha(0.7);
    this.hit(a, x, y, ROBOT_SIZE + 10, ROBOT_SIZE + 10, 40);
    this.marker(a, x, y);
  }
  private badge(
    c: Phaser.GameObjects.Container,
    fill: number,
    rim: number,
    glyph: string,
  ): void {
    const g = this.add.graphics();
    g.fillStyle(rim).fillCircle(16, -16, 11);
    g.fillStyle(fill).fillCircle(15, -17, 10);
    g.lineStyle(1, 0xfff3d6, 0.9).strokeCircle(15, -17, 8.2);
    c.add(g);
    if (glyph === "x") {
      g.lineStyle(3, 0xffeed1);
      g.lineBetween(11, -21, 19, -13);
      g.lineBetween(19, -21, 11, -13);
    } else
      c.add(
        this.add
          .text(15, -17, glyph, {
            fontFamily: LABEL_FONT,
            fontSize: "15px",
            fontStyle: "bold",
            color: "#fffaf0",
          })
          .setOrigin(0.5, 0.52)
          .setResolution(3 * renderDensity()),
      );
  }
  private marker(a: Entity, x: number, y: number): void {
    // Marker geometry is drawn for a 27px robot and scales with the sprite.
    const c = this.add.container(x, y).setDepth(36).setScale(ROBOT_SIZE / 27);
    const color = MODEL_COLORS[a.model!];
    if (a.state === "running") {
      const waves = this.add.graphics().setDepth(-1);
      waves.lineStyle(2.5, color, 0.85);
      for (const radius of [18, 23]) {
        waves.beginPath().arc(0, 0, radius, -0.8, 0.8).strokePath();
        waves
          .beginPath()
          .arc(0, 0, radius, Math.PI - 0.8, Math.PI + 0.8)
          .strokePath();
      }
      c.add(waves);
      const tween = this.tweens.add({
        targets: waves,
        alpha: { from: 0.4, to: 1 },
        scale: { from: 0.96, to: 1.08 },
        duration: 1400,
        repeat: -1,
        yoyo: true,
        ease: "Sine.easeInOut",
      });
      if (this.reduced) tween.pause();
    } else if (a.state === "done") {
      const r = 12,
        ox = -2,
        oy = -30;
      const g = this.add.graphics();
      g.fillStyle(0xffd45a, 0.16).fillCircle(ox, oy, r + 7);
      g.fillStyle(0xffe5a0, 0.3).fillCircle(ox, oy, r + 4);
      g.fillStyle(0xb5781f).fillCircle(ox + 1, oy + 2, r + 2);
      g.fillStyle(0xe9ae2e).fillCircle(ox, oy, r);
      g.lineStyle(1.2, 0xffedac).strokeCircle(ox, oy, r - 2.5);
      const star = Array.from({ length: 16 }, (_, i) => {
        const radius = i % 2 === 0 ? r * 0.72 : r * 0.23;
        return {
          x: ox + Math.cos((i * Math.PI) / 8) * radius,
          y: oy + Math.sin((i * Math.PI) / 8) * radius,
        };
      });
      g.fillStyle(0xfff1b8).fillPoints(vectors(star), true);
      g.lineStyle(0.7, 0xb67b1c).strokePoints(vectors(star), true);
      c.add(g);
      const tween = this.tweens.add({
        targets: g,
        alpha: { from: 0.8, to: 1 },
        duration: 1800,
        repeat: -1,
        yoyo: true,
        ease: "Sine.easeInOut",
      });
      if (this.reduced) tween.pause();
    } else if (a.state === "approval") this.badge(c, 0xe39a1e, 0x9a5f0c, "!");
    else if (a.state === "question") this.badge(c, 0x3a7fc4, 0x1f4f80, "?");
    else if (a.state === "failed") this.badge(c, 0xc75136, 0x7f2d22, "x");
    if (a.subagents && a.state !== "offline") {
      // Helpers in flight: one small light per running subagent, up to three.
      const g = this.add.graphics();
      for (let i = 0; i < Math.min(3, a.subagents); i++) {
        g.fillStyle(0x3d3a2e, 0.25).fillCircle(-17 + i * 7, 17, 3.4);
        g.fillStyle(color).fillCircle(-17 + i * 7, 16, 3);
      }
      c.add(g);
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
    // Room for each host's shores all round, its banner above, and the map's
    // own floating controls (toolbar above, help line below).
    const marginX = HEX_RADIUS * 1.6,
      top = HEX_RADIUS * 2.4,
      bottom = HEX_RADIUS * 2;
    return {
      x: bounds.x - marginX,
      y: bounds.y - top,
      width: bounds.width + marginX * 2,
      height: bounds.height + top + bottom,
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
    if (!entity || entity.kind === "host") return;
    this.outlineCells(this.selected, entity, 3, 0x9c742c);
    if (entity.kind === "agent") {
      const loc = this.locations.get(entity.id)!;
      this.selected.lineStyle(2.5, 0x6e4f1d, 0.95).strokeCircle(loc.x, loc.y, ROBOT_SIZE * 0.7);
    }
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
    return this.reduced;
  }
  thumbnail(entity: Entity): string {
    return this.textures.getBase64(
      entity.kind === "agent" ? "robots" : "buildings",
      entity.art ?? "manor",
    );
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
    if (!this.reduced) this.drift += delta * 0.006;
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
