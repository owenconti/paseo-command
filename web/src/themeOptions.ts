export const themeLabel = {
  system: "System",
  light: "Light",
  dark: "Dark",
  "lake-country": "Lake Country",
  galaxy: "Galaxy",
} as const;

export type ThemeSetting = keyof typeof themeLabel;
export type ResolvedTheme = Exclude<ThemeSetting, "system">;
export const THEME_ORDER: ThemeSetting[] = [
  "system",
  "light",
  "dark",
  "lake-country",
  "galaxy",
];
export const THEME_BACKGROUND: Record<ResolvedTheme, string> = {
  light: "#e4ebf2",
  dark: "#111925",
  "lake-country": "#e6e1cf",
  galaxy: "#070c11",
};

export function validTheme(value: unknown): ThemeSetting {
  return typeof value === "string" && Object.hasOwn(themeLabel, value)
    ? (value as ThemeSetting)
    : "system";
}

export function resolveTheme(
  setting: ThemeSetting,
  systemDark: boolean,
): ResolvedTheme {
  return setting === "system" ? (systemDark ? "dark" : "light") : setting;
}
