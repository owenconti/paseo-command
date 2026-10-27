import Phaser from "phaser";
import { renderDensity } from "../display";
import { STATE_TILE, seedOf, type AtlasData, type Entity, type State } from "../world";
import {
  FORMATION,
  HOST_FONT,
  RINGED,
  layoutGalaxy,
  type GalaxyLayout,
  type Planet,
  type Satellite,
  type Station,
} from "./layout";
import {
  ATMOSPHERE,
  PlanetSurface,
  atmosphere,
  nebula,
  pixels,
  ring,
  rock,
  satellite,
  stars,
  station,
} from "./paint";
import oceanUrl from "../assets/galaxy/ocean.jpg";
import forestUrl from "../assets/galaxy/forest.jpg";
import desertUrl from "../assets/galaxy/desert.jpg";
import volcanicUrl from "../assets/galaxy/volcanic.jpg";
import iceUrl from "../assets/galaxy/ice.jpg";
import ringedgasUrl from "../assets/galaxy/ringedgas.jpg";
import barrenUrl from "../assets/galaxy/barren.jpg";
import stormUrl from "../assets/galaxy/storm.jpg";
import cloudsUrl from "../assets/galaxy/clouds.jpg";
import nebulaUrl from "../assets/galaxy/nebula.jpg";
import type { ScreenPoint } from "../AtlasScene";

const SURFACES: Record<string, string> = {
  ocean: oceanUrl,
  forest: forestUrl,
  desert: desertUrl,
  volcanic: volcanicUrl,
  ice: iceUrl,
  ringedgas: ringedgasUrl,
  barren: barrenUrl,
  storm: stormUrl,
};
const MAX_ZOOM = 2.6;
const FONT = '"Paseo Barlow", "Barlow Semi Condensed", "Barlow Condensed", "Arial Narrow", sans-serif';
const SPACE = "#090605";
/** World pixels a station and a satellite are drawn across. */
const STATION_SIZE = 88;
const SATELLITE_SIZE = 46;
/** One revolution of a working station around its planet, in milliseconds. */
const ORBIT_MS = 160000;
const ATTENTION = new Set<State>(["failed", "approval", "question", "done"]);
type Box = { x: number; y: number; width: number; height: number };
const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text);

export class GalaxyScene extends Phaser.Scene {
  private layout: GalaxyLayout | null = null;
  private pending: { data: AtlasData; aspect: number } | null = null;
  private created = false;
  private fitted = false;
  private world: Phaser.GameObjects.GameObject[] = [];
  private starsFar!: Phaser.GameObjects.TileSprite;
  private starsNear!: Phaser.GameObjects.TileSprite;
  private overlay!: Phaser.GameObjects.Graphics;
  private beams!: Phaser.GameObjects.Graphics;
  private surfaces = new Map<string, PlanetSurface>();
  private planetImages = new Map<string, { surface: PlanetSurface; image: Phaser.GameObjects.Image; key: string; seed: number }>();
  private stationViews = new Map<string, { root: Phaser.GameObjects.Container; body: Phaser.GameObjects.Image; lamp: Phaser.GameObjects.Graphics; zone: Phaser.GameObjects.Zone }>();
  private satelliteViews = new Map<string, { root: Phaser.GameObjects.Container; body: Phaser.GameObjects.Image; zone: Phaser.GameObjects.Zone }>();
  private locations = new Map<string, Box>();
  private textureKeys: string[] = [];
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private clock = 0;
  private turnIndex = 0;
  private builds = 0;
  private down?: { x: number; y: number; scrollX: number; scrollY: number };
  private controls?: Phaser.Cameras.Controls.FixedKeyControl;
  private surfaceData = new Map<string, ImageData>();
  private nebulae = new Map<string, { x: number; y: number; width: number; height: number }>();
  private cloudData: ImageData | null = null;
  private nebulaData: ImageData | null = null;
  constructor() {
    super("galaxy");
  }
  preload(): void {
    for (const [family, url] of Object.entries(SURFACES)) this.load.image(`surface-${family}`, url);
    this.load.image("galaxy-clouds", cloudsUrl);
    this.load.image("galaxy-nebula", nebulaUrl);
    this.load.on("loaderror", (file: Phaser.Loader.File) =>
      this.game.events.emit("atlas:error", `Could not load ${file.key}. Reload the world to retry.`),
    );
  }
  create(): void {
    for (const family of Object.keys(SURFACES))
      this.surfaceData.set(family, pixels(this.textures.get(`surface-${family}`).getSourceImage() as HTMLImageElement));
    this.cloudData = pixels(this.textures.get("galaxy-clouds").getSourceImage() as HTMLImageElement);
    this.nebulaData = pixels(this.textures.get("galaxy-nebula").getSourceImage() as HTMLImageElement);
    this.textures.addCanvas("stars-far", stars(1024, "far", 900));
    this.textures.addCanvas("stars-near", stars(1024, "near", 160));
    this.textures.addCanvas("station", station(256));
    this.cameras.main.setBackgroundColor(SPACE);
    this.starsFar = this.add.tileSprite(0, 0, 16, 16, "stars-far").setOrigin(0).setDepth(-20).setAlpha(0.75);
    this.starsNear = this.add.tileSprite(0, 0, 16, 16, "stars-near").setOrigin(0).setDepth(-19);
    this.beams = this.add.graphics().setDepth(14);
    this.overlay = this.add.graphics().setDepth(60);
    this.configureInput();
    this.scale.on("resize", () => this.fit());
    this.created = true;
    if (this.pending) this.setData(this.pending.data, this.pending.aspect);
    this.game.events.emit("atlas:ready");
    this.reportCamera();
    // World lettering uses the app's condensed face; redraw once it has loaded.
    void document.fonts
      ?.load(`600 30px ${FONT}`)
      .then(() => this.layout && this.sys.isActive() && this.rebuild())
      .catch(() => {});
  }
  setData(data: AtlasData, aspect: number): void {
    if (!this.created) {
      this.pending = { data, aspect };
      return;
    }
    this.pending = null;
    this.layout = layoutGalaxy(data, aspect);
    this.rebuild();
    if (this.selectedId && !this.entity(this.selectedId)) this.selectedId = null;
    if (this.hoveredId && !this.entity(this.hoveredId)) this.setHover(null);
    if (!this.fitted) {
      this.fitted = true;
      this.fit();
    }
  }
  private entity(id: string): Entity | undefined {
    return this.layout?.entities.find((e) => e.id === id);
  }
  private text(x: number, y: number, value: string, size: number, color: string, weight = "600", spacing = 1) {
    return this.add
      .text(x, y, value, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: weight, color, letterSpacing: spacing })
      .setResolution(3 * renderDensity());
  }
  private rebuild(): void {
    const layout = this.layout!;
    this.builds++;
    for (const o of this.world) o.destroy();
    this.world = [];
    for (const key of this.textureKeys) this.textures.remove(key);
    this.textureKeys = [];
    this.planetImages.clear();
    this.stationViews.clear();
    this.satelliteViews.clear();
    this.locations.clear();
    const keep = (o: Phaser.GameObjects.GameObject) => (this.world.push(o), o);
    // Host nebulae.
    const shapes = new Set<string>();
    layout.regions.forEach((region) => {
      // Painting a nebula is the slow part; regions that keep their shape reuse theirs.
      const shape = `nebula-${seedOf(JSON.stringify([region.blobs, region.bounds, region.tint, region.online]))}`;
      let n = this.nebulae.get(shape);
      if (!n) {
        const painted = nebula(region, this.nebulaData!, 200);
        this.textures.addCanvas(shape, painted.canvas);
        n = { x: painted.x, y: painted.y, width: painted.width, height: painted.height };
        this.nebulae.set(shape, n);
      }
      shapes.add(shape);
      keep(this.add.image(n.x, n.y, shape).setOrigin(0).setDisplaySize(n.width, n.height).setDepth(-10));
      // The host's name stands at the centre, its planets ringed around it.
      const label = this.text(0, 0, region.name.toUpperCase() + (region.online ? "" : " · OFFLINE"), HOST_FONT, region.online ? "#efe7d8" : "#9c968a", "600", 3);
      label.setOrigin(0.5).setPosition(region.label.x, region.label.y).setAlpha(0.9);
      keep(label.setDepth(5));
      label.setData("labelKind", "host");
      this.locations.set(region.host, { ...region.bounds, x: region.bounds.x + region.bounds.width / 2, y: region.bounds.y + region.bounds.height / 2 });
    });
    for (const key of [...this.nebulae.keys()])
      if (!shapes.has(key)) {
        this.textures.remove(key);
        this.nebulae.delete(key);
      }
    // Decorative rocks.
    for (const r of layout.rocks) {
      const key = `rock-${r.seed % 6}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, rock(64, r.seed % 6 + 7));
      keep(this.add.image(r.x, r.y, key).setDisplaySize(r.r * 2, r.r * 2).setDepth(-2).setAngle((r.seed % 360)).setAlpha(0.9));
    }
    for (const p of layout.planets) this.planet(p, keep);
    for (const s of layout.stations) this.station(s, keep);
    for (const s of layout.satellites) this.satellite(s, keep);
    this.place();
  }
  private planet(p: Planet, keep: (o: Phaser.GameObjects.GameObject) => Phaser.GameObjects.GameObject) {
    const size = Math.min(360, Math.ceil(p.r * 2 * 2.4));
    const cacheKey = `${p.id}|${size}|${p.family}`;
    let surface = this.surfaces.get(cacheKey);
    if (!surface) {
      surface = new PlanetSurface(size, this.surfaceData.get(p.family)!, this.cloudData, p.family);
      this.surfaces.set(cacheKey, surface);
    }
    const seed = (p.id.length * 7919) % 1000 / 1000;
    surface.render(seed + this.clock / 240000, seed + this.clock / 160000);
    // One texture per surface for the life of the scene; it is re-painted in place.
    const key = `planet-${cacheKey}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, surface.canvas);
    else (this.textures.get(key) as Phaser.Textures.CanvasTexture).refresh();
    const ringed = RINGED.has(p.family);
    if (ringed) {
      const rk = `ring-${p.family}-${p.id.length % 4}`;
      if (!this.textures.exists(rk)) this.textures.addCanvas(rk, ring(p.family, 512, p.id.length));
      const width = p.r * 3.7;
      // The upper half of the ring passes behind the planet, the lower half in front.
      const back = this.add.image(p.x, p.y, rk).setDisplaySize(width, width).setAngle(p.tilt).setDepth(9);
      back.setCrop(0, 0, 512, 256);
      const front = this.add.image(p.x, p.y, rk).setDisplaySize(width, width).setAngle(p.tilt).setDepth(11);
      front.setCrop(0, 256, 512, 256);
      keep(back);
      keep(front);
      if (p.stale) [back, front].forEach((o) => o.setAlpha(0.5));
    }
    const glow = ATMOSPHERE[p.family];
    if (glow !== undefined) {
      const ak = `atmo-${glow}`;
      if (!this.textures.exists(ak)) this.textures.addCanvas(ak, atmosphere(glow, 256));
      keep(this.add.image(p.x, p.y, ak).setDisplaySize(p.r * 2 * 1.18, p.r * 2 * 1.18).setDepth(10.5).setAlpha(0.9));
    }
    const image = this.add.image(p.x, p.y, key).setDisplaySize(p.r * 2, p.r * 2).setDepth(10);
    if (p.stale) image.setAlpha(0.6);
    keep(image);
    this.planetImages.set(p.id, { surface, image, key, seed });
    if (p.decorative) return;
    // The name clears the full orbit of a travelling station, but only the
    // actual reach of a parked one.
    const reach = (STATION_SIZE + SATELLITE_SIZE) / 2 + 70;
    const outer = Math.max(
      0,
      ...this.layout!.stations
        .filter((s) => s.planet === p.id)
        .map((s) => (s.moving ? s.orbit + FORMATION : Math.cos(s.angle) * s.orbit + reach)),
    );
    const lx = p.x + Math.max(ringed ? p.r * 1.85 : p.r * 1.1, outer) + 18;
    keep(this.text(lx, p.y - 34, p.name.toUpperCase(), 34, p.stale ? "#9c968a" : "#f3eee4").setDepth(30).setData("labelKind", "project"));
    keep(this.text(lx, p.y + 6, p.caption, 20, "#b7d4cd", "500").setDepth(30));
    this.locations.set(p.id, { x: p.x, y: p.y, width: p.r * 2, height: p.r * 2 });
    const zone = this.add.zone(p.x, p.y, p.r * 2, p.r * 2).setDepth(20);
    zone.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Circle(p.r, p.r, p.r), hitAreaCallback: Phaser.Geom.Circle.Contains });
    this.bindPick(zone, p.id);
    keep(zone);
  }
  private station(s: Station, keep: (o: Phaser.GameObjects.GameObject) => Phaser.GameObjects.GameObject) {
    const root = this.add.container(0, 0).setDepth(16);
    const lamp = this.add.graphics();
    const color = s.state ? STATE_TILE[s.state] : undefined;
    if (color !== undefined && !s.camp) {
      lamp.fillStyle(color, 0.16).fillCircle(0, 0, STATION_SIZE * 0.78);
      lamp.lineStyle(3, color, 0.85).strokeCircle(0, 0, STATION_SIZE * 0.62);
    }
    root.add(lamp);
    const body = this.add.image(0, 0, "station").setDisplaySize(STATION_SIZE, STATION_SIZE);
    if (s.camp) body.setVisible(false);
    if (s.stale) body.setAlpha(0.55);
    root.add(body);
    if (!s.camp) {
      const own = this.layout!.satellites.filter((a) => a.station === s.id).length;
      // The station's name sits above it; its satellites fan out below and beyond.
      const name = this.text(0, -STATION_SIZE * 0.56, `${clip(s.name.toUpperCase(), 26)}  ·  ${own} AGENT${own === 1 ? "" : "S"}`, 16, "#ece6da");
      name.setOrigin(0.5, 1).setData("stationName", true);
      root.add(name);
    }
    keep(root);
    const zone = this.add.zone(0, 0, STATION_SIZE, STATION_SIZE).setDepth(22);
    if (!s.camp) {
      zone.setInteractive({ useHandCursor: true });
      this.bindPick(zone, s.id);
    }
    keep(zone);
    this.stationViews.set(s.id, { root, body, lamp, zone });
  }
  private satellite(s: Satellite, keep: (o: Phaser.GameObjects.GameObject) => Phaser.GameObjects.GameObject) {
    const key = `satellite-${s.color}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, satellite(128, s.color));
    const root = this.add.container(0, 0).setDepth(18);
    const body = this.add.image(0, 0, key).setDisplaySize(SATELLITE_SIZE, SATELLITE_SIZE);
    if (s.state === "offline") body.setTint(0x8a8d92).setAlpha(0.65);
    root.add(body);
    const tile = STATE_TILE[s.state];
    if (ATTENTION.has(s.state) && tile !== undefined) {
      const g = this.add.graphics();
      g.lineStyle(2, tile, 0.95).strokeCircle(0, 0, SATELLITE_SIZE * 0.62);
      g.fillStyle(0x000000, 0.45).fillCircle(SATELLITE_SIZE * 0.48, -SATELLITE_SIZE * 0.48, 8.5);
      g.fillStyle(tile).fillCircle(SATELLITE_SIZE * 0.48, -SATELLITE_SIZE * 0.48, 7.5);
      root.add(g);
      const glyph = { failed: "×", approval: "!", question: "?", done: "★" }[s.state as "failed"];
      root.add(this.text(SATELLITE_SIZE * 0.48, -SATELLITE_SIZE * 0.48, glyph, 11, "#1a1208", "700", 0).setOrigin(0.5, 0.52));
    }
    if (s.subagents && s.state !== "offline") {
      const g = this.add.graphics();
      for (let i = 0; i < Math.min(3, s.subagents); i++) g.fillStyle(s.color).fillCircle(-8 + i * 6, SATELLITE_SIZE * 0.42, 2.2);
      root.add(g);
    }
    // Beside the satellite, clear of its station's name above the station.
    const label = this.text(SATELLITE_SIZE * 0.62, 0, clip(s.name.toUpperCase(), 30), 13, ATTENTION.has(s.state) ? "#f0cf8e" : "#e9e4da");
    label.setOrigin(0, 0.5);
    root.add(label);
    keep(root);
    const zone = this.add.zone(0, 0, SATELLITE_SIZE + 10, SATELLITE_SIZE + 10).setDepth(24);
    zone.setInteractive({ useHandCursor: true });
    this.bindPick(zone, s.id);
    keep(zone);
    this.satelliteViews.set(s.id, { root, body, zone });
  }
  private bindPick(zone: Phaser.GameObjects.Zone, id: string) {
    zone.on("pointerover", () => this.setHover(id));
    zone.on("pointerout", () => this.hoveredId === id && this.setHover(null));
    zone.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (Phaser.Math.Distance.Between(p.downX, p.downY, p.x, p.y) < 7) this.game.events.emit("atlas:pick", this.entity(id) ?? null);
    });
  }
  /** Where every moving body is now: stations on their orbits, satellites in formation. */
  private place(): void {
    const layout = this.layout;
    if (!layout) return;
    const planets = new Map(layout.planets.map((p) => [p.id, p]));
    const stationAt = new Map<string, { x: number; y: number; out: number }>();
    for (const s of layout.stations) {
      const p = planets.get(s.planet)!;
      const a = s.angle + (s.moving ? (this.clock / ORBIT_MS) * Math.PI * 2 : 0);
      const x = p.x + Math.cos(a) * s.orbit,
        y = p.y + Math.sin(a) * s.orbit * 0.62;
      stationAt.set(s.id, { x, y, out: Math.atan2(y - p.y, x - p.x) });
      const view = this.stationViews.get(s.id);
      if (!view) continue;
      view.root.setPosition(x, y);
      view.zone.setPosition(x, y);
      view.body.setAngle((this.clock / 1000) * 3 + s.angle * 57);
      // The name stands on the side away from the satellites' formation.
      const name = view.root.list.find((o) => o.getData?.("stationName")) as Phaser.GameObjects.Text | undefined;
      if (name) {
        const up = Math.sin(Math.atan2(y - p.y, x - p.x)) < 0;
        name.setOrigin(0.5, up ? 0 : 1).setY(up ? STATION_SIZE * 0.56 : -STATION_SIZE * 0.56);
      }
      if (s.state && ATTENTION.has(s.state)) view.lamp.setAlpha(0.6 + 0.4 * Math.sin(this.clock / 300));
      this.locations.set(s.id, { x, y, width: STATION_SIZE, height: STATION_SIZE });
    }
    this.beams.clear();
    const bySation = new Map<string, Satellite[]>();
    for (const s of layout.satellites) bySation.set(s.station, [...(bySation.get(s.station) ?? []), s]);
    for (const [id, list] of bySation) {
      const home = stationAt.get(id)!;
      const p = planets.get(layout.stations.find((s) => s.id === id)!.planet)!;
      list.forEach((s, i) => {
        // A formation fanned out beyond the station, away from the planet.
        const spread = (i - (list.length - 1) / 2) * 0.7;
        const a = home.out + spread;
        const dist = (STATION_SIZE + SATELLITE_SIZE) / 2 + 26 + (i % 2) * 22;
        const x = home.x + Math.cos(a) * dist,
          y = home.y + Math.sin(a) * dist;
        const view = this.satelliteViews.get(s.id)!;
        view.root.setPosition(x, y);
        view.zone.setPosition(x, y);
        view.body.setAngle((Math.atan2(p.y - y, p.x - x) * 180) / Math.PI + 90);
        this.locations.set(s.id, { x, y, width: SATELLITE_SIZE, height: SATELLITE_SIZE });
        if (s.state === "running") this.beam(x, y, home.x, home.y, p, s.color, i);
      });
    }
    this.drawOverlay();
  }
  /** A working agent's data link: satellite to its station, relayed down to
   * the planet, with a pulse travelling along it. */
  private beam(x: number, y: number, sx: number, sy: number, p: Planet, color: number, i: number) {
    const dx = p.x - sx,
      dy = p.y - sy,
      d = Math.hypot(dx, dy);
    const tx = p.x - (dx / d) * p.r * 0.96,
      ty = p.y - (dy / d) * p.r * 0.96;
    const flicker = this.reduced ? 1 : 0.8 + 0.2 * Math.sin(this.clock / 180 + i);
    for (const [w, a] of [
      [10, 0.1],
      [5, 0.25],
      [1.8, 0.95],
    ] as const) {
      this.beams.lineStyle(w, color, a * flicker);
      this.beams.lineBetween(x, y, sx, sy);
      this.beams.lineBetween(sx, sy, tx, ty);
    }
    this.beams.fillStyle(0xffffff, 0.9).fillCircle(tx, ty, 3.2);
    this.beams.fillStyle(color, 0.35).fillCircle(tx, ty, 8);
    if (!this.reduced) {
      // The pulse runs satellite → station → planet.
      const a = Math.hypot(sx - x, sy - y),
        b = Math.hypot(tx - sx, ty - sy);
      const t = ((this.clock / 1400 + i * 0.37) % 1) * (a + b);
      const [px, py] = t < a ? [x + ((sx - x) * t) / a, y + ((sy - y) * t) / a] : [sx + ((tx - sx) * (t - a)) / b, sy + ((ty - sy) * (t - a)) / b];
      this.beams.fillStyle(0xffffff, 0.95).fillCircle(px, py, 2.4);
    }
  }
  private brackets(id: string, color: number, width: number) {
    const loc = this.locations.get(id);
    const e = this.entity(id);
    if (!loc || !e || e.kind === "host") return;
    const pad = e.kind === "project" ? 14 : 8;
    const w = loc.width / 2 + pad,
      h = loc.height / 2 + pad,
      arm = Math.min(18, w * 0.4);
    const g = this.overlay;
    g.lineStyle(width, color, 0.95);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const cx = loc.x + sx * w,
        cy = loc.y + sy * h;
      g.lineBetween(cx, cy, cx - sx * arm, cy);
      g.lineBetween(cx, cy, cx, cy - sy * arm);
    }
  }
  private drawOverlay() {
    this.overlay.clear();
    if (this.hoveredId && this.hoveredId !== this.selectedId) this.brackets(this.hoveredId, 0xf1ebdd, 2);
    if (this.selectedId) this.brackets(this.selectedId, 0xe0a640, 3);
  }
  private setHover(id: string | null) {
    if (!this.created) return;
    this.hoveredId = id;
    const e = id ? this.entity(id) : undefined;
    this.game.events.emit("atlas:hover", e ?? null, e ? this.screenOf(e.id) : null);
    this.drawOverlay();
  }
  select(id: string | null): void {
    if (!this.created) return;
    this.selectedId = id && this.entity(id) ? id : null;
    this.drawOverlay();
    this.game.events.emit("atlas:selection", this.selectedId ? this.entity(this.selectedId) : null);
  }
  private configureInput(): void {
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const cam = this.cameras.main;
      this.down = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.down) return;
      const cam = this.cameras.main;
      cam.scrollX = this.down.scrollX - (p.x - this.down.x) / cam.zoom;
      cam.scrollY = this.down.scrollY - (p.y - this.down.y) / cam.zoom;
      if (this.hoveredId) this.setHover(null);
    });
    this.input.on("pointerup", () => (this.down = undefined));
    this.input.on("gameout", () => this.hoveredId && this.setHover(null));
    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const before = cam.getWorldPoint(pointer.x, pointer.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * Math.exp(-dy * 0.001), this.minimumZoom(), MAX_ZOOM * renderDensity()));
      cam.preRender();
      const after = cam.getWorldPoint(pointer.x, pointer.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
      if (this.hoveredId) this.setHover(null);
      this.reportCamera();
    });
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
    const b = this.layout?.bounds ?? { x: -400, y: -300, width: 800, height: 600 };
    return { x: b.x - 120, y: b.y - 200, width: b.width + 240, height: b.height + 320 };
  }
  private minimumZoom(): number {
    const e = this.mapExtent();
    return Math.min(this.scale.width / e.width, this.scale.height / e.height);
  }
  fit(): void {
    const cam = this.cameras.main,
      e = this.mapExtent();
    cam.setZoom(this.minimumZoom());
    cam.centerOn(e.x + e.width / 2, e.y + e.height / 2);
    this.reportCamera();
  }
  private constrainCamera(): void {
    const cam = this.cameras.main,
      e = this.mapExtent();
    cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minimumZoom(), MAX_ZOOM * renderDensity()));
    const w = cam.width / cam.zoom,
      h = cam.height / cam.zoom;
    const cx = cam.scrollX + cam.width / 2,
      cy = cam.scrollY + cam.height / 2;
    cam.centerOn(
      w >= e.width ? e.x + e.width / 2 : Phaser.Math.Clamp(cx, e.x + w / 2, e.x + e.width - w / 2),
      h >= e.height ? e.y + e.height / 2 : Phaser.Math.Clamp(cy, e.y + h / 2, e.y + e.height - h / 2),
    );
  }
  command(command: string): void {
    if (command === "home") this.fit();
    if (command === "in" || command === "out") {
      this.cameras.main.setZoom(
        Phaser.Math.Clamp(this.cameras.main.zoom * (command === "in" ? 1.25 : 0.8), this.minimumZoom(), MAX_ZOOM * renderDensity()),
      );
      this.reportCamera();
    }
  }
  /** Pans to an entity when it is off screen; `zoom` also frames it closer. */
  focus(id: string, zoom = false): void {
    const loc = this.locations.get(id),
      e = this.entity(id);
    if (!loc || !e) return;
    const cam = this.cameras.main;
    if (!zoom) {
      const v = cam.worldView,
        mx = v.width * 0.12,
        my = v.height * 0.12;
      if (loc.x > v.x + mx && loc.x < v.x + v.width - mx && loc.y > v.y + my && loc.y < v.y + v.height - my) return;
      if (this.reduced) cam.centerOn(loc.x, loc.y);
      else cam.pan(loc.x, loc.y, 380, "Cubic.easeOut", true);
      return;
    }
    const level = Phaser.Math.Clamp(
      e.kind === "host"
        ? Math.min(this.scale.width / (loc.width + 200), this.scale.height / (loc.height + 200))
        : e.kind === "project"
          ? Math.min(1.2 * renderDensity(), this.scale.height / 700)
          : 1.8 * renderDensity(),
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
  setInput(enabled: boolean): void {
    this.input.enabled = enabled;
    if (this.input.keyboard) this.input.keyboard.enabled = enabled;
    if (!enabled && this.hoveredId) this.setHover(null);
  }
  motion(reduced = !this.reduced): boolean {
    this.reduced = reduced;
    return this.reduced;
  }
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
  thumbnail(): string {
    return "";
  }
  inspect() {
    const layout = this.layout;
    return {
      scene: "galaxy",
      renderer: "Phaser 4",
      selected: this.selectedId,
      hovered: this.hoveredId,
      zoom: this.cameras.main.zoom / renderDensity(),
      minimumZoom: this.minimumZoom() / renderDensity(),
      camera: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY },
      motion: !this.reduced,
      builds: this.builds,
      regions: layout?.regions.map((r) => ({ host: r.host, name: r.name, online: r.online })),
      islands: layout?.regions.map((r) => ({ key: r.host, host: r.host, name: r.name, online: r.online })),
      projects: layout?.planets.filter((p) => !p.decorative).map((p) => ({ id: p.id, name: p.name, family: p.family, caption: p.caption })),
      workspaces: layout?.stations.map((s) => ({ id: s.id, name: s.name, project: s.planet, camp: s.camp, state: s.state })),
      tiles: Object.fromEntries((layout?.stations ?? []).filter((s) => s.state).map((s) => [s.id, s.state])),
      agents: layout?.satellites.map((s) => ({
        id: s.id,
        name: s.name,
        state: s.state,
        model: s.model,
        color: s.color,
        workspace: s.station,
        at: this.locations.get(s.id),
        screen: this.screenOf(s.id),
      })),
      objects: this.children.length,
    };
  }
  private reportCamera(): void {
    this.game.events.emit("atlas:zoom", this.cameras.main.zoom / renderDensity());
  }
  update(_time: number, delta: number): void {
    this.controls?.update(delta);
    this.constrainCamera();
    if (!this.reduced) this.clock += delta;
    const view = this.cameras.main.worldView,
      pad = Math.max(view.width, view.height) * 0.25;
    for (const [layer, depth] of [
      [this.starsFar, 0.3],
      [this.starsNear, 0.6],
    ] as const)
      layer
        .setPosition(view.x - pad, view.y - pad)
        .setSize(view.width + pad * 2, view.height + pad * 2)
        .setTilePosition((view.x - pad) * depth + this.clock * 0.002, (view.y - pad) * depth);
    if (!this.layout) return;
    this.place();
    // Planets turn slowly; one visible planet is re-painted per frame.
    if (!this.reduced && this.planetImages.size) {
      const list = [...this.planetImages.values()];
      for (let tries = 0; tries < list.length; tries++) {
        const item = list[this.turnIndex++ % list.length]!;
        const b = item.image.getBounds();
        if (!Phaser.Geom.Rectangle.Overlaps(view, b)) continue;
        item.surface.render(item.seed + this.clock / 240000, item.seed + this.clock / 160000);
        const tex = this.textures.get(item.key) as Phaser.Textures.CanvasTexture;
        tex.refresh();
        break;
      }
    }
    if (this.cameras.main.zoomEffect.isRunning) this.reportCamera();
  }
}
