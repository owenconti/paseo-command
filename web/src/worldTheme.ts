export type WorldThemeManifest = {
  version: 1;
  units: "metres";
  upAxis: "Y";
  geometryCompatibility: string;
  roles: Record<
    string,
    {
      variants: Record<string, string[]>;
      pivot: [number, number, number];
      footprint: [number, number];
      clearance: number;
      anchors: Record<string, [number, number, number]>;
    }
  >;
  themes: Record<
    string,
    { palette: Record<string, [number, number, number]>; lighting: string }
  >;
  distance: { detailBelow: number; regionalAbove: number };
  outline: { color: [number, number, number]; widthPixels: number };
  status: {
    running: "green";
    attention: "amber";
    failed: "red";
    idle: "neutral";
    selection: "white-ground-brackets";
  };
};
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const vector = (value: unknown, size: number): value is number[] =>
  Array.isArray(value) && value.length === size && value.every(finite);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** Fail before committing a replacement theme. Geometry contracts are shared
 * across variants so a material switch cannot change navigable space. */
export function validateWorldTheme(
  value: unknown,
): asserts value is WorldThemeManifest {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.units !== "metres" ||
    value.upAxis !== "Y" ||
    typeof value.geometryCompatibility !== "string" ||
    !value.geometryCompatibility
  )
    throw new Error("Unsupported world theme manifest.");
  if (
    !record(value.themes) ||
    !Object.keys(value.themes).length ||
    !record(value.roles) ||
    !Object.keys(value.roles).length
  )
    throw new Error("World theme is missing assets or materials.");
  const themes = Object.keys(value.themes);
  for (const theme of Object.values(value.themes)) {
    if (
      !record(theme) ||
      !record(theme.palette) ||
      !Object.keys(theme.palette).length ||
      typeof theme.lighting !== "string"
    )
      throw new Error("Invalid theme palette or lighting.");
    for (const color of Object.values(theme.palette))
      if (!vector(color, 3) || (color as number[]).some((c) => c < 0 || c > 1))
        throw new Error("Theme palette colors must be linear RGB values.");
  }
  for (const [name, role] of Object.entries(value.roles)) {
    if (
      !record(role) ||
      !vector(role.pivot, 3) ||
      !vector(role.footprint, 2) ||
      role.footprint.some((n: number) => n <= 0) ||
      !finite(role.clearance) ||
      role.clearance < 0 ||
      !record(role.anchors) ||
      !record(role.variants)
    )
      throw new Error(`Invalid navigation contract for ${name}.`);
    for (const anchor of Object.values(role.anchors))
      if (!vector(anchor, 3))
        throw new Error(`Invalid interaction anchor for ${name}.`);
    for (const theme of themes) {
      const assets = role.variants[theme];
      if (
        !Array.isArray(assets) ||
        assets.length < 2 ||
        assets.some(
          (asset) =>
            typeof asset !== "string" ||
            !asset.endsWith(".usdz") ||
            asset.includes("..") ||
            asset.startsWith("/") ||
            asset.includes(":"),
        )
      )
        throw new Error(
          `Missing or unsafe distance assets for ${name}/${theme}.`,
        );
    }
  }
  if (
    !record(value.distance) ||
    !finite(value.distance.detailBelow) ||
    !finite(value.distance.regionalAbove) ||
    value.distance.detailBelow <= 0 ||
    value.distance.regionalAbove <= value.distance.detailBelow
  )
    throw new Error("Invalid world detail distances.");
  if (
    !record(value.outline) ||
    !vector(value.outline.color, 3) ||
    !finite(value.outline.widthPixels) ||
    value.outline.widthPixels <= 0 ||
    value.outline.widthPixels > 2
  )
    throw new Error("Invalid world outline contract.");
  if (
    !record(value.status) ||
    value.status.running !== "green" ||
    value.status.attention !== "amber" ||
    value.status.failed !== "red" ||
    value.status.idle !== "neutral" ||
    value.status.selection !== "white-ground-brackets"
  )
    throw new Error("Theme changes cannot change status meaning.");
}
