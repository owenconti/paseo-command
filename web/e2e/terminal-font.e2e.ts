/**
 * Settings → Terminal: in the macOS app the page asks the app for its terminals' font and the installed monospaced
 * families (`terminalFont`), shows them, and sets the family (a searchable picker), size, line height and letter spacing
 * through the same message, the app answering each with `paseo:terminal-font`; ⌘K "Terminal settings…" opens it. In a
 * browser the section says it's the app's. The app is a stand-in here, which keeps the values and answers as the app does.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { appEvent, launch, mockApi, newContext, startApp, waitFor } from "./harness";

let app: Awaited<ReturnType<typeof startApp>>;
let browser: Browser;
before(async () => {
  [app, browser] = await Promise.all([startApp(), launch()]);
});
after(async () => {
  await browser?.close();
  await app?.stop();
  assert.deepEqual(app?.apiHits ?? [], []);
});

type Sent = { type: string; set?: Record<string, unknown>; action?: string };
/** The app's channel: it records what the page sends and answers `terminalFont` as the app does (clamped, families when asked). */
const asMacApp = (page: Page) =>
  page.addInitScript(`
    window.sentToApp = [];
    const defaults = { family: "", size: 12.5, lineHeight: 1, letterSpacing: 0 };
    const ranges = { size: [8, 32], lineHeight: [1, 1.6], letterSpacing: [-1, 4] };
    const families = ["Courier New", "Menlo", "MesloLGS Nerd Font Mono", "Monaco"];
    let font = { ...defaults, size: 14 };
    const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => {
      m = JSON.parse(JSON.stringify(m));
      window.sentToApp.push(m);
      if (m.type !== "terminalFont") return;
      if (m.set) {
        const s = m.set;
        if (typeof s.family === "string") font.family = families.includes(s.family) ? s.family : "";
        for (const k of ["size", "lineHeight", "letterSpacing"]) if (typeof s[k] === "number") font[k] = clamp(s[k], ranges[k]);
      }
      const detail = { ...font, defaults, ranges, ...(m.set ? {} : { families }) };
      setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:terminal-font", { detail })), 0);
    } } } };
  `);
const sent = (page: Page, type: string) =>
  page.evaluate((t) => (window as unknown as { sentToApp: Sent[] }).sentToApp.filter((m) => m.type === t), type);

test("in the macOS app, Settings → Terminal shows the app's font and sets it", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await asMacApp(page);
  await mockApi(page, { agents: () => [], projects: () => [] });
  await page.goto(app.url);
  // ⌘K "Terminal settings…" asks the app for Settings, which shows once the app says so.
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press("Meta+k");
  await palette.getByRole("combobox", { name: "Search commands" }).fill("Terminal settings");
  await palette.getByRole("option", { name: /Terminal settings…/ }).first().click();
  await waitFor(() => sent(page, "menu"), (menu) => menu.some((m) => m.action === "settings"), "the app asked for Settings");
  await appEvent(page, "paseo:mode", { mode: "settings" });
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.locator('.settings-nav-item[data-section="terminal"][aria-current="page"]').waitFor();
  await settings.getByRole("heading", { name: "Terminal" }).waitFor();
  // It asked for the font and the families, and shows them.
  assert.ok((await sent(page, "terminalFont")).some((m) => !m.set));
  const fontButton = settings.getByRole("button", { name: "Terminal font: System monospace" });
  await fontButton.waitFor();
  const size = settings.getByRole("slider", { name: "Size" });
  assert.equal(await size.inputValue(), "14");
  await settings.getByText("14 pt", { exact: true }).waitFor();
  // The family's picker is searchable, with the system's monospace first.
  await fontButton.click();
  const picker = settings.getByRole("listbox", { name: "Terminal font" });
  await picker.getByText("System monospace").waitFor();
  await page.keyboard.type("meslo");
  assert.equal(await picker.getByText("Menlo", { exact: true }).count(), 0);
  await page.keyboard.press("Enter");
  await settings.getByRole("button", { name: "Terminal font: MesloLGS Nerd Font Mono" }).waitFor();
  assert.deepEqual((await sent(page, "terminalFont")).at(-1)?.set, { family: "MesloLGS Nerd Font Mono" });
  // Size, line height and letter spacing, each as it changes; the app's answer is what shows.
  await size.fill("16");
  await settings.getByText("16 pt", { exact: true }).waitFor();
  const lineHeight = settings.getByRole("slider", { name: "Line height" });
  await lineHeight.fill("1.3");
  await settings.getByText("1.3×", { exact: true }).waitFor();
  const spacing = settings.getByRole("slider", { name: "Letter spacing" });
  await spacing.fill("0.5");
  await settings.getByText("+0.5 pt", { exact: true }).waitFor();
  const sets = (await sent(page, "terminalFont")).filter((m) => m.set).map((m) => m.set);
  assert.deepEqual(sets.slice(-3), [{ size: 16 }, { lineHeight: 1.3 }, { letterSpacing: 0.5 }]);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // The preview draws in the chosen font, at its size and spacing.
  const preview = settings.getByLabel("Preview");
  const style = await preview.evaluate((el) => [getComputedStyle(el).fontFamily, getComputedStyle(el).fontSize, getComputedStyle(el).letterSpacing]);
  assert.match(style[0]!, /MesloLGS Nerd Font Mono/);
  assert.deepEqual(style.slice(1), ["16px", "0.5px"]);
  // ⌘+ in a terminal: the app tells the page, which follows.
  await appEvent(page, "paseo:terminal-font", { family: "MesloLGS Nerd Font Mono", size: 17, lineHeight: 1.3, letterSpacing: 0.5 });
  await settings.getByText("17 pt", { exact: true }).waitFor();
  assert.equal(await settings.getByRole("button", { name: "Terminal font: MesloLGS Nerd Font Mono" }).count(), 1, "the families stay");
  // Restore defaults sends them all.
  await settings.getByRole("button", { name: "Restore defaults" }).click();
  assert.deepEqual((await sent(page, "terminalFont")).at(-1)?.set, { family: "", size: 12.5, lineHeight: 1, letterSpacing: 0 });
  await settings.getByRole("button", { name: "Terminal font: System monospace" }).waitFor();
  await settings.getByText("12.5 pt", { exact: true }).waitFor();
  assert.equal(await settings.getByRole("button", { name: "Restore defaults" }).isDisabled(), true);
  await context.close();
});

test("in a browser, Settings → Terminal says it's the macOS app's", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, { agents: () => [], projects: () => [] });
  await page.goto(app.url);
  await page.locator(".app-bar-tools").getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.locator('.settings-nav-item[data-section="terminal"]').click();
  await settings.getByText(/are the macOS app’s/).waitFor();
  assert.equal(await settings.getByRole("slider").count(), 0);
  assert.equal(await settings.getByRole("button", { name: /Terminal font/ }).count(), 0);
  await context.close();
});
