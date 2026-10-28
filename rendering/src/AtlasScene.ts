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
  cellBounds,
  ROBOT_SIZE,
  random,
  seedOf,
  type Axial,
  type State,
} from "./world";
import { frameName } from "./art";
import { perimeter } from "./outline";
import { MAX_ZOOM, mapExtent, minimumZoom, clampCamera, focusZoom, comfortablyVisible } from "./camera";
import {
  PROP_WIDTH,
  HOVER_COLOR,
  DRONE_SIZE,
  DRONE_ORBIT,
  placeStructures,
  campFlags,
  labels,
  locations,
  robots,
  plaza,
  artMask,
  lights,
  glowAlpha,
  tiles,
  pulseAlpha,
  type Label,
  type Placed,
  type Signal,
} from "./placement";
import {
  LABEL_FONT,
  RIBBON_BODY_RADIUS,
  RIBBON_HIGHLIGHT,
  RIBBON_SHADOW,
  RIBBON_STROKE,
  fitCaption,
  ribbonFont,
  ribbonShape,
} from "./ribbon";
import { WANDER_X, WANDER_Y, WALK_SPEED, TURN_SPEED } from "./wander";
import buildingsUrl from "./assets/buildings.png";
import structuresUrl from "./assets/structures.png";
import robotsUrl from "./assets/robots.png";
import foliageUrl from "./assets/tree-v2.png";
import sandUrl from "./assets/sand.png";
import propsUrl from "./assets/props.png";
const vectors = (points: { x: number; y: number }[]) =>
  points.map((p) => new Phaser.Math.Vector2(p.x, p.y));
type Box = { x: number; y: number; width: number; height: number };
/** Unmoving painted parts of the world (ground, buildings), drawn once into a
 * view-sized texture and redrawn only when the camera or the world changes, so
 * a frame draws each as one image. Each sits at its own depth, so moving things
 * keep their places between them. Vector shapes (banners, camp flags) stay live:
 * a texture has no multisampling, so their edges would roughen. */
type Cache = {
  texture: Phaser.Textures.DynamicTexture;
  image: Phaser.GameObjects.Image;
  /** World images drawn into it: those below `below` and at or above the previous cache's. */
  below: number;
  objects: Phaser.GameObjects.GameObject[];
};
/** How often the sea's glints and the cloud shadows move on (per second), and
 * their speed (world px/ms). Slow drift needs few steps; robots and tiles move
 * every frame. */
const DRIFT_RATE = 15;
const DRIFT_SPEED = 0.003;
/** Screen position in CSS pixels relative to the canvas. */
export type ScreenPoint = { x: number; y: number };
export class AtlasScene extends Phaser.Scene {
  private water!: Phaser.GameObjects.TileSprite;
  private glints!: Phaser.GameObjects.TileSprite;
  private clouds!: Phaser.GameObjects.TileSprite;
  private drift = 0;
  private driftPending = 0;
  private caches: Cache[] = [];
  /** The view the caches were painted for; empty when they must be repainted. */
  private cachedView = "";
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
  /** Each project's lamps and beacon, placed with its plaza; lit by its agents. */
  private signals = new Map<string, Signal[]>();
  /** Lit lamps and beacons' glows, which breathe and flicker. */
  private flames: { glow: Phaser.GameObjects.Graphics; period: number; phase: number; flicker: boolean }[] = [];
  /** Opaque pixels of each landmark's art, so props keep off it. */
  private masks = new Map<string, { data: Uint8ClampedArray; width: number; height: number }>();
  /** The state each workspace tile shows. */
  private tiles = new Map<string, State>();
  private created = false;
  private fitted = false;
  constructor() {
    super("atlas");
  }
  preload(): void {
    this.load.image("buildings", buildingsUrl);
    this.load.image("structures", structuresUrl);
    this.load.image("robots", robotsUrl);
    this.load.image("foliage", foliageUrl);
    this.load.image("sand", sandUrl);
    this.load.image("props", propsUrl);
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
    // Ground under agent tiles and the selection; buildings under cloud shadows.
    this.caches = (
      [
        [4, 1],
        [20, 17],
      ] as const
    ).map(([below, depth], i) => {
      const texture = this.textures.addDynamicTexture(`static-${i}`, this.scale.width, this.scale.height, false)!;
      const image = this.add.image(0, 0, texture).setOrigin(0).setDepth(depth);
      return { texture, image, below, objects: [] };
    });
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
    this.locations = locations(layout);
    if (structural) this.rebuild();
    else {
      for (const o of this.agentLayer.splice(0)) o.destroy();
      this.agentLayer = this.capture(() => {
        this.agentTiles(layout);
        this.lightSignals(layout);
        this.agents(layout);
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
    this.signals.clear();
    this.hover.clear();
    const build = ++this.builds;
    this.world = this.capture(() => {
      this.terrainKeys = drawTerrain(this, layout, build);
      const placed = new Map<string, Placed[]>();
      for (const s of placeStructures(layout, (frame) => this.frameSize(frame)))
        placed.set(s.entity, [...(placed.get(s.entity) ?? []), s]);
      // Each project's banner, in layout order, then each host's.
      const banners = labels(layout);
      layout.projects.forEach((p, i) => this.landmark(p, placed.get(p.id)!, banners[i]!));
      const flags = campFlags(layout).values();
      for (const ws of layout.workspaces)
        this.workspace(ws, ws.camp ? flags.next().value! : undefined, placed.get(ws.id) ?? []);
      // Neither a host's banner nor its land is interactive; the Hosts tab picks a host.
      for (const banner of banners.slice(layout.projects.length)) this.ribbon(banner);
    });
    this.cacheWorld();
    this.agentLayer = this.capture(() => {
      this.agentTiles(layout);
      this.lightSignals(layout);
      this.agents(layout);
    });
  }
  /** Hand the world's images to the caches; the camera itself skips them. */
  private cacheWorld(): void {
    const images = this.world
      .filter((o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image)
      .sort((a, b) => a.depth - b.depth);
    let from = -Infinity;
    for (const cache of this.caches) {
      cache.objects = images.filter((o) => o.depth >= from && o.depth < cache.below);
      this.cameras.main.ignore(cache.objects);
      from = cache.below;
    }
    this.cachedView = "";
  }
  /** Repaint the caches for the camera's current view, when it has changed. */
  private paintCaches(): void {
    const cam = this.cameras.main;
    cam.preRender();
    const view = cam.worldView;
    const key = [view.x, view.y, view.width, view.height, cam.width, cam.height].join();
    if (key === this.cachedView) return;
    this.cachedView = key;
    for (const { texture, image, objects } of this.caches) {
      if (texture.width !== cam.width || texture.height !== cam.height)
        texture.setSize(cam.width, cam.height, false);
      texture.camera.setScroll(cam.scrollX, cam.scrollY).setZoom(cam.zoom);
      texture.clear().draw(objects).render();
      // Covers exactly the view, so it lands on the screen pixel for pixel.
      image.setPosition(view.x, view.y).setDisplaySize(view.width, view.height);
    }
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
    caption.setText(
      fitCaption(text, maxWidth, (shown) => {
        caption.setText(shown);
        return caption.width;
      }),
    );
    return caption;
  }
  /** A host's or project's banner, at fixed world scale. */
  private ribbon(label: Label): Phaser.GameObjects.Container {
    const font = ribbonFont(label.kind);
    const group = this.add.container(label.x, label.y).setDepth(23);
    const caption = this.caption(label.text, font.size, label.maxWidth, {
      fontStyle: font.weight,
      letterSpacing: font.letterSpacing,
      color: ribbonShape(label.kind, 0, label.faded).text,
    });
    const shape = ribbonShape(label.kind, caption.width, label.faded);
    const g = this.add.graphics();
    group.add(g);
    group.setData("labelKind", label.kind);
    const { shadow, body } = shape;
    g.fillStyle(RIBBON_SHADOW.color, RIBBON_SHADOW.alpha).fillRoundedRect(
      shadow.x,
      shadow.y,
      shadow.width,
      shadow.height,
      RIBBON_SHADOW.radius,
    );
    g.fillStyle(shape.tailFill).lineStyle(RIBBON_STROKE.tail, shape.stroke);
    for (const tail of shape.tails) {
      g.fillPoints(vectors(tail), true);
      g.strokePoints(vectors(tail), true);
    }
    g.fillStyle(shape.fill).fillRoundedRect(body.x, body.y, body.width, body.height, RIBBON_BODY_RADIUS);
    g.lineStyle(RIBBON_STROKE.body, shape.stroke).strokeRoundedRect(
      body.x,
      body.y,
      body.width,
      body.height,
      RIBBON_BODY_RADIUS,
    );
    const inset = RIBBON_HIGHLIGHT.inset;
    g.lineStyle(RIBBON_HIGHLIGHT.width, RIBBON_HIGHLIGHT.color, RIBBON_HIGHLIGHT.alpha).lineBetween(
      body.x + inset,
      body.y + inset,
      body.x + body.width - inset,
      body.y + inset,
    );
    group.add(caption);
    return group;
  }
  /** Where the pointer picks an entity: within `box`, and on its cells. */
  private hit(
    entity: Entity,
    { x, y, width, height }: Box,
    depth = 30,
    /** Anywhere in the rectangle, rather than only on the entity's cells. */
    anywhere = entity.kind === "agent",
  ): void {
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
    const { segments, caps, edgeCount } = perimeter(this.cellsOf(entity), width, inset);
    graphics.setData("edgeCount", edgeCount);
    graphics.lineStyle(width, color, alpha).fillStyle(color, alpha);
    // Sides, then the round ends where they meet, then the bridges across steps.
    for (const [a, b] of segments.slice(0, edgeCount)) graphics.lineBetween(a.x, a.y, b.x, b.y);
    for (const p of caps) graphics.fillCircle(p.x, p.y, width / 2);
    for (const [a, b] of segments.slice(edgeCount)) graphics.lineBetween(a.x, a.y, b.x, b.y);
  }
  /** The cells an entity covers; a host covers its whole landmass. */
  private cellsOf(entity: Entity): Axial[] {
    if (entity.kind !== "host") return footprint(entity);
    return this.layout!.land
      .filter((mass) => mass.host === entity.id)
      .flatMap((mass) => mass.cells);
  }
  /** A painted structure, as `placeStructures` stands it. */
  private place(s: Placed): Phaser.GameObjects.Image {
    const image = sprite(this, s.x, s.y, s.frame, s.width).setDepth(s.depth);
    if (s.flipX) image.setFlipX(true);
    if (s.alpha !== 1) image.setAlpha(s.alpha);
    if (s.footprint) image.setData("footprint", s.footprint);
    return image;
  }
  /** A frame's natural size, as its sprite reports it. */
  private frameSize(art: string): { width: number; height: number } {
    const name = frameName(art);
    const frame = this.textures.getFrame(`filtered-${name}`, name);
    return { width: frame.realWidth, height: frame.realHeight };
  }
  /** A landmark, its banner and plaza. */
  private landmark(p: Entity, [building]: Placed[], banner: Label): void {
    const image = this.place(building!);
    const label = this.ribbon(banner).getBounds();
    // The ribbon's tails and shadow reach past its caption.
    this.plaza(p, image, { x: label.x - 34, y: label.y - 8, width: label.width + 68, height: label.height + 20 });
    this.hit(p, this.locations.get(p.id)!, 25);
  }
  /** A workspace's cottage and garden, or a camp's flag. No name plate: the
   * workspace's name shows on hover. */
  private workspace(ws: Entity, flag: { x: number; y: number } | undefined, placed: Placed[]): void {
    if (flag) {
      // No cottage: the daemon reports these agents without a workspace.
      const g = this.add.graphics().setDepth(16);
      g.lineStyle(2, 0x7b6340).lineBetween(flag.x - 6, flag.y + 6, flag.x - 6, flag.y - 30);
      g.fillStyle(0xc75136).fillTriangle(
        flag.x - 5,
        flag.y - 30,
        flag.x + 18,
        flag.y - 23,
        flag.x - 5,
        flag.y - 16,
      );
      g.fillStyle(0x7b6340, 0.35).fillEllipse(flag.x - 6, flag.y + 7, 18, 6);
    }
    for (const s of placed) this.place(s);
    this.hit(ws, this.locations.get(ws.id)!, 29);
  }
  /** Props on a landmark's paving, as `plaza` places them; its lamps and
   * beacon wait for the agents to light them. */
  private plaza(p: Entity, landmark: Phaser.GameObjects.Image, label: Box): void {
    const { props, signals } = plaza(p, this.landmarkMask(landmark), label, (frame) => {
      const f = this.textures.getFrame(`filtered-${frame}`, frame);
      return { width: f.width, height: f.height };
    });
    for (const prop of props) this.place(prop);
    this.signals.set(p.id, signals);
  }
  /** Whether a world point lands on a landmark's painted art. */
  private landmarkMask(image: Phaser.GameObjects.Image): (x: number, y: number) => boolean {
    const frame = image.frame;
    const key = `${image.texture.key}/${frame.name}`;
    let mask = this.masks.get(key);
    if (!mask) {
      const canvas = document.createElement("canvas");
      canvas.width = frame.cutWidth;
      canvas.height = frame.cutHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(
        frame.source.image as CanvasImageSource,
        frame.cutX,
        frame.cutY,
        frame.cutWidth,
        frame.cutHeight,
        0,
        0,
        frame.cutWidth,
        frame.cutHeight,
      );
      mask = { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
      this.masks.set(key, mask);
    }
    return artMask(mask, { x: image.x, y: image.y, width: image.scaleX * mask.width });
  }
  /** A plaza's lamps burn while any of its project's agents is working; its
   * beacon flares, in the colour of the most urgent, when one needs you. */
  private lightSignals(layout: AtlasLayout): void {
    this.flames = [];
    for (const l of lights(layout, this.signals)) {
      if (l.lit) {
        const glow = this.add.graphics().setDepth(17.4).setBlendMode(Phaser.BlendModes.ADD);
        for (let k = 6; k >= 1; k--) glow.fillStyle(l.color, 0.07).fillCircle(l.x, l.y, (l.reach * k) / 6);
        this.flames.push({ glow, period: l.period, phase: l.phase, flicker: l.flicker });
      }
      const prop = sprite(this, l.x, l.y, l.frame, PROP_WIDTH[l.kind]!).setDepth(17.5);
      if (l.stale) prop.setAlpha(0.6);
    }
    this.animateFlames();
  }
  /** Lamps breathe softly; beacons flicker and pulse. Steady, with reduced motion. */
  private animateFlames(): void {
    for (const f of this.flames) f.glow.setAlpha(glowAlpha(f, this.clock, this.reduced));
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
    for (const tile of tiles(layout)) {
      this.tiles.set(tile.id, tile.state);
      const at = tile;
      const hex = (r: number) =>
        Array.from({ length: 6 }, (_, i) => ({
          x: at.x + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * r,
          y: at.y + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * r,
        }));
      const fill = this.add.graphics().setDepth(4);
      fill.fillStyle(tile.color, tile.fillAlpha).fillPoints(vectors(hex(HEX_RADIUS - 1)), true);
      fill.lineStyle(1.5, 0xfff8e6, 0.7).strokePoints(vectors(hex(HEX_RADIUS - 10.5)), true);
      const border = this.add.graphics().setDepth(4.1);
      border.lineStyle(9, tile.color, tile.borderAlpha).strokePoints(vectors(hex(HEX_RADIUS - 5.5)), true);
      if (tile.pulse) this.moving.push({ graphics: border, period: tile.pulse, phase: tile.phase });
      else if (tile.running)
        this.moving.push({
          graphics: this.add.graphics().setDepth(4.2),
          period: tile.running,
          phase: tile.phase,
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
        tile.graphics.setAlpha(pulseAlpha(tile.period, tile.phase, this.clock, this.reduced));
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
  private agents(layout: AtlasLayout): void {
    const bots = robots(layout);
    layout.agents.forEach((a, i) => this.agent(a, bots[i]!));
  }
  private agent(a: Entity, bot: ReturnType<typeof robots>[number]): void {
    // Centred on its own cell.
    const { x, y } = bot;
    // A body and two hands, so its arms can move.
    // Each hand's frame is the whole robot's, so all three share one origin.
    const body = sprite(this, 0, 0, `${bot.art}-body`, ROBOT_SIZE);
    const hands = ["l", "r"].map((side) => sprite(this, 0, 0, `${bot.art}-hand-${side}`, ROBOT_SIZE));
    const image = this.add.container(x, y, [body, ...hands]).setDepth(35);
    image.setData("agent", a.id);
    if (bot.offline) for (const part of [body, ...hands]) part.setTint(0x9c9a92).setAlpha(0.7);
    // The whole cell answers the pointer; the robot is where it's pointed out.
    const cell = cellBounds([a.position]);
    this.hit(a, { x, y, width: cell.width, height: cell.height }, 40, false);
    // A working robot potters about its cell; the rest stand still.
    const robot = {
      id: a.id,
      image,
      hands: hands.map((h) => ({ image: h, x: h.x, y: h.y })),
      x,
      y,
      busy: bot.busy,
    };
    this.robots.push(robot);
    this.marker(a, robot, bot.drones);
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
  private marker(a: Entity, robot: AtlasScene["robots"][number], count: number): void {
    const { x, y } = robot;
    if (!count) return;
    const phase = random(seedOf(a.id + "drones"))();
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
  /** The canvas in render px. */
  private view(): { width: number; height: number } {
    return { width: this.scale.width, height: this.scale.height };
  }
  private mapExtent() {
    return mapExtent(this.layout, this.view(), renderDensity());
  }
  private minimumZoom(): number {
    return minimumZoom(this.layout, this.view(), renderDensity());
  }
  fit(): void {
    const cam = this.cameras.main,
      extent = this.mapExtent();
    cam.setZoom(this.minimumZoom());
    cam.centerOn(extent.x + extent.width / 2, extent.y + extent.height / 2);
    this.reportCamera();
  }
  private constrainCamera(): void {
    const cam = this.cameras.main;
    const c = clampCamera(
      { centerX: cam.scrollX + cam.width / 2, centerY: cam.scrollY + cam.height / 2, zoom: cam.zoom },
      this.layout,
      this.view(),
      renderDensity(),
    );
    cam.setZoom(c.zoom);
    cam.centerOn(c.centerX, c.centerY);
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
      if (comfortablyVisible(loc, cam.worldView)) return;
      if (this.reduced) cam.centerOn(loc.x, loc.y);
      else cam.pan(loc.x, loc.y, 380, "Cubic.easeOut", true);
      return;
    }
    const level = Phaser.Math.Clamp(
      focusZoom(entity.kind, loc, this.view(), renderDensity()),
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
    this.animateFlames();
    this.walkRobots(0);
    this.flyDrones();
    return this.reduced;
  }
  thumbnail(entity: Entity): string {
    if (entity.art && this.textures.exists(`filtered-${entity.art}`))
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
            art: image.frame.name,
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
      this.driftPending += delta;
      if (this.driftPending >= 1000 / DRIFT_RATE) {
        this.drift += this.driftPending * DRIFT_SPEED;
        this.driftPending = 0;
      }
      this.clock += delta;
      this.animateTiles();
      this.animateFlames();
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
    this.paintCaches();
    if (this.cameras.main.zoomEffect.isRunning) this.reportCamera();
  }
}
