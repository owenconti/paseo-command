import Phaser from "phaser";
import { renderDensity } from "./display";
import { registerFrames, sprite } from "./textures";
import { drawTerrain, WORLD_BOUNDS } from "./terrain";
import {
  agents,
  projects,
  workspaces,
  hosts,
  entities,
  point,
  HEX_RADIUS,
  MODEL_COLORS,
  STATE_NAMES,
  type Entity,
  type State,
  footprint,
  insideFootprint,
  fittedWidth,
  landBounds,
  footprintEdges,
} from "./world";
const MAX_ZOOM = 2.4;
const vectors = (points: { x: number; y: number }[]) =>
  points.map((p) => new Phaser.Math.Vector2(p.x, p.y));
export class AtlasScene extends Phaser.Scene {
  private water!: Phaser.GameObjects.TileSprite;
  private selected!: Phaser.GameObjects.Graphics;
  private hover!: Phaser.GameObjects.Graphics;
  private markers = new Map<string, Phaser.GameObjects.Container>();
  private locations = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  private controls?: Phaser.Cameras.Controls.FixedKeyControl;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private down?: { x: number; y: number; scrollX: number; scrollY: number };
  private selectedId: string | null = null;
  constructor() {
    super("atlas");
  }
  preload(): void {
    this.load.image("buildings", "/assets/buildings.png");
    this.load.image("robots", "/assets/robots.png");
    this.load.image("foliage", "/assets/tree-v2.png");
    this.load.image("water", "/assets/water.png");
    this.load.image("sand", "/assets/sand.png");
    this.load.on("loaderror", (file: Phaser.Loader.File) =>
      this.game.events.emit(
        "atlas:error",
        `Could not load ${file.key}. Reload the preview to retry.`,
      ),
    );
  }
  create(): void {
    registerFrames(this);
    this.water = this.add
      .tileSprite(-3000, -3000, 7000, 6500, "water")
      .setOrigin(0)
      .setDepth(-10)
      .setTileScale(0.95)
      .setAlpha(0.48);
    this.cameras.main.setBackgroundColor("#72bfd0");
    drawTerrain(this);
    this.hover = this.add.graphics().setDepth(7);
    this.selected = this.add.graphics().setDepth(8);
    for (const p of projects) this.landmark(p);
    for (const ws of workspaces) this.workspace(ws);
    for (const a of agents) this.agent(a);
    this.ribbon(-245, -510, "LOCAL", 310, 38, true);
    this.ribbon(1100, 195, "MACMINI", 265, 34, true);
    for (const h of hosts) {
      const loc =
        h.id === "local"
          ? { x: -180, y: -120, width: 1230, height: 1050 }
          : { x: 1060, y: 570, width: 670, height: 690 };
      this.locations.set(h.id, loc);
    }
    this.configureInput();
    this.fit();
    const resize = () => this.fit();
    this.scale.on("resize", resize);
    this.events.once("shutdown", () => this.scale.off("resize", resize));
    this.game.events.emit("atlas:ready");
    this.reportCamera();
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
  private ribbon(
    x: number,
    y: number,
    text: string,
    width: number,
    height: number,
    host = false,
  ): void {
    const group = this.add.container(x, y).setDepth(23);
    const g = this.add.graphics();
    group.add(g);
    group.setData("labelKind", host ? "host" : "project");
    const l = -width / 2,
      r = width / 2,
      t = -height / 2,
      b = height / 2;
    g.fillStyle(0x6e5936, 0.13).fillRoundedRect(l + 3, t + 5, width, height, 2);
    g.fillStyle(0xdcc995).lineStyle(1.2, 0x8c7447);
    g.fillPoints(
      vectors([
        { x: l - 17, y: t + 5 },
        { x: l + 10, y: t + 7 },
        { x: l + 10, y: b + 10 },
        { x: l - 19, y: b + 8 },
        { x: l - 11, y: 3 },
      ]),
      true,
    );
    g.strokePoints(
      vectors([
        { x: l - 17, y: t + 5 },
        { x: l + 10, y: t + 7 },
        { x: l + 10, y: b + 10 },
        { x: l - 19, y: b + 8 },
        { x: l - 11, y: 3 },
      ]),
      true,
    );
    g.fillPoints(
      vectors([
        { x: r + 17, y: t + 5 },
        { x: r - 10, y: t + 7 },
        { x: r - 10, y: b + 10 },
        { x: r + 19, y: b + 8 },
        { x: r + 11, y: 3 },
      ]),
      true,
    );
    g.strokePoints(
      vectors([
        { x: r + 17, y: t + 5 },
        { x: r - 10, y: t + 7 },
        { x: r - 10, y: b + 10 },
        { x: r + 19, y: b + 8 },
        { x: r + 11, y: 3 },
      ]),
      true,
    );
    g.fillStyle(0xf5e8bd).fillRoundedRect(l, t, width, height, 3);
    g.lineStyle(1.4, 0x8c7447).strokeRoundedRect(l, t, width, height, 3);
    g.lineStyle(0.7, 0xfff7d9, 0.8).lineBetween(l + 4, t + 4, r - 4, t + 4);
    const caption = this.add
      .text(0, 0, text, {
        fontFamily: "Georgia, serif",
        fontSize: host ? "29px" : "21px",
        fontStyle: host ? "normal" : "bold",
        color: "#3e3322",
        letterSpacing: host ? 5 : 0,
      })
      .setOrigin(0.5)
      .setResolution(3 * renderDensity());
    group.add(caption);
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
        hitAreaCallback: (_area: unknown, localX: number, localY: number) =>
          entity.kind === "agent" ||
          insideFootprint(
            x + localX - width / 2,
            y + localY - height / 2,
            footprint(entity),
          ),
      });
    zone.on("pointerover", () => {
      this.outlineCells(this.hover, entity, 2, 0xa77d35);
    });
    zone.on("pointerout", () => this.hover.clear());
    zone.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (Phaser.Math.Distance.Between(p.downX, p.downY, p.x, p.y) < 7)
        this.select(entity.id);
    });
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
  private landmark(p: Entity): void {
    const at = point(p.position),
      cells = footprint(p);
    for (const cell of cells) {
      const center = point(cell);
      this.polygon(center.x, center.y, HEX_RADIUS, 0xe3d6b4, 0.4).setDepth(2);
    }
    const image = sprite(this, at.x, at.y, p.art!, 335).setDepth(15);
    const width = fittedWidth(
      at.x,
      at.y,
      image.width / image.height,
      335,
      cells,
    );
    image.setScale(width / image.width);
    image.setData("footprint", cells);
    this.ribbon(at.x, at.y + 112, p.name, 180, 26);
    this.hit(p, at.x, at.y, HEX_RADIUS * Math.sqrt(3) * 3, HEX_RADIUS * 5, 25);
  }
  private workspace(ws: Entity): void {
    const at = point(ws.position);
    this.polygon(
      at.x,
      at.y,
      HEX_RADIUS,
      0xf3e7c8,
      0.75,
      0xa99467,
      1.6,
    ).setDepth(3);
    this.polygon(
      at.x,
      at.y,
      HEX_RADIUS - 10,
      0xfaf1d5,
      0.1,
      0xbba77a,
      0.7,
    ).setDepth(3);
    const cells = footprint(ws);
    const image = sprite(this, at.x, at.y, ws.art!, 118).setDepth(16);
    image.setScale(
      fittedWidth(at.x, at.y, image.width / image.height, 118, cells) /
        image.width,
    );
    image.setData("footprint", cells);
    const numberGroup = this.add.container(at.x, at.y + 49).setDepth(21);
    const number = this.add.graphics();
    numberGroup.add(number);
    numberGroup.setData("labelKind", "workspace");
    number.fillStyle(0xf4e8c4).fillRoundedRect(-14, -8, 28, 16, 2);
    number.lineStyle(1, 0xa68d5d).strokeRoundedRect(-14, -8, 28, 16, 2);
    const numberCaption = this.add
      .text(0, 0, ws.number!, {
        fontFamily: "Georgia,serif",
        fontSize: "14px",
        color: "#4a3b25",
      })
      .setOrigin(0.5)
      .setResolution(3 * renderDensity());
    numberGroup.add(numberCaption);
    this.hit(ws, at.x, at.y, HEX_RADIUS * Math.sqrt(3), HEX_RADIUS * 2, 29);
  }
  private agent(a: Entity): void {
    const at = point(a.position),
      x = at.x + 24,
      y = at.y + 24;
    const image = sprite(this, x, y, a.art!, 27).setDepth(35);
    image.setData("agent", a.id);
    this.hit(a, x, y, 36, 36, 40);
    this.markers.set(a.id, this.marker(a, x, y));
  }
  private marker(
    a: Entity,
    x: number,
    y: number,
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y).setDepth(33);
    if (a.state === "running") {
      const waves = this.add.graphics();
      waves.lineStyle(2.5, MODEL_COLORS[a.model!], 0.85);
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
    } else if (a.state === "done" || a.state === "approval") {
      const done = a.state === "done",
        r = done ? 22 : 10,
        ox = done ? -36 : 16,
        oy = done ? -49 : -18;
      const g = this.add.graphics();
      if (done) {
        g.fillStyle(0xffd45a, 0.13).fillCircle(ox, oy, 28);
        g.fillStyle(0xffe5a0, 0.28).fillCircle(ox, oy, 25);
      }
      g.fillStyle(0xb5781f).fillCircle(ox + 1, oy + 2, r + 2);
      g.fillStyle(0xe9ae2e).fillCircle(ox, oy, r);
      g.lineStyle(1.5, 0xffedac).strokeCircle(ox, oy, r - 3);
      g.lineStyle(0.8, 0xa46c12).strokeCircle(ox, oy, r - 6);
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
      if (done) {
        const tween = this.tweens.add({
          targets: g,
          alpha: { from: 0.85, to: 1 },
          duration: 1800,
          repeat: -1,
          yoyo: true,
          ease: "Sine.easeInOut",
        });
        if (this.reduced) tween.pause();
      }
    } else if (a.state === "failed") {
      const g = this.add.graphics();
      g.fillStyle(0x7f2d22).fillCircle(22, -24, 15);
      g.fillStyle(0xc75136).fillCircle(21, -25, 14);
      g.lineStyle(1, 0xf5d4ab).strokeCircle(21, -25, 12);
      g.lineStyle(3.5, 0xffeed1);
      g.lineBetween(16, -30, 26, -20);
      g.lineBetween(26, -30, 16, -20);
      c.add(g);
    }
    return c;
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
    });
    this.input.on("pointerup", () => {
      this.down = undefined;
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
      keyboard.on("keydown-ESC", () => this.select(null));
    }
  }
  private mapExtent() {
    const bounds = landBounds();
    const marginX = HEX_RADIUS * Math.sqrt(3),
      marginY = HEX_RADIUS * 2;
    return {
      x: bounds.x - marginX,
      y: bounds.y - marginY,
      width: bounds.width + marginX * 2,
      height: bounds.height + marginY * 2,
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
    if (command === "local") {
      this.focus("local");
    }
    if (command === "macmini") this.focus("macmini");
  }
  focus(id: string): void {
    const loc = this.locations.get(id);
    if (!loc) return;
    const cam = this.cameras.main,
      entity = entities.find((e) => e.id === id)!;
    const requestedZoom =
      entity.kind === "host"
        ? Math.min(
            (this.scale.width - 90 * renderDensity()) / loc.width,
            (this.scale.height - 80 * renderDensity()) / loc.height,
          )
        : entity.kind === "project"
          ? Math.min(1.5 * renderDensity(), this.scale.height / 650)
          : 1.5 * renderDensity();
    const zoom = Math.max(this.minimumZoom(), requestedZoom);
    if (this.reduced) {
      cam.centerOn(loc.x, loc.y);
      cam.setZoom(zoom);
    } else {
      cam.pan(loc.x, loc.y, 380, "Cubic.easeOut", true);
      cam.zoomTo(zoom, 380, "Cubic.easeOut", true);
    }
  }
  select(id: string | null): void {
    this.selected.clear();
    this.selectedId = id;
    if (id) {
      const loc = this.locations.get(id),
        entity = entities.find((e) => e.id === id);
      if (!loc || !entity) return;
      this.outlineCells(this.selected, entity, 3, 0x9c742c);
    }
    this.game.events.emit(
      "atlas:selection",
      id ? entities.find((e) => e.id === id) : null,
    );
  }
  cycleState(id: string): void {
    const a = agents.find((a) => a.id === id);
    if (!a) return;
    const order: State[] = ["running", "idle", "done", "approval", "failed"];
    a.state = order[(order.indexOf(a.state!) + 1) % order.length]!;
    const loc = this.locations.get(id)!;
    this.markers.get(id)?.destroy();
    this.markers.set(id, this.marker(a, loc.x, loc.y));
    this.select(id);
  }
  motion(): boolean {
    this.reduced = !this.reduced;
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
  inspect() {
    return {
      scene: "atlas",
      illustrative: true,
      renderer: "Phaser 4",
      selected: this.selectedId,
      selectionEdgeCount: this.selectedId
        ? this.selected.getData("edgeCount")
        : 0,
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
        ? footprint(entities.find((e) => e.id === this.selectedId)!)
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
      backingZoom: this.cameras.main.zoom,
      renderDensity: renderDensity(),
      viewport: {
        width: this.cameras.main.width,
        height: this.cameras.main.height,
      },
      rendererSize: {
        width: this.game.renderer.width,
        height: this.game.renderer.height,
      },
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        state: a.state,
        model: a.model,
        at: this.locations.get(a.id),
      })),
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
    if (!this.reduced && this.water) this.water.tilePositionX += delta * 0.0015;
    if (this.cameras.main.zoomEffect.isRunning) this.reportCamera();
  }
}
