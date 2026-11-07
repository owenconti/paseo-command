// node shoot.mjs <out.png> [k] [dy]: renders the preview in WebKit and saves the canvas.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM ?? new URL("../../web/package.json", import.meta.url).pathname);
const { webkit } = require("playwright");
import { writeFileSync } from "node:fs";
const [out, k = "4", dy = "0", extra = ""] = process.argv.slice(2);
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on("console", (m) => console.log("console:", m.text()));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://127.0.0.1:4391/overworld-preview/index.html?k=${k}&dy=${dy}${extra}`);
await page.waitForFunction(() => window.done, null, { timeout: 120000 });
const err = await page.evaluate(() => (typeof window.done === "string" ? window.done : ""));
if (err) { console.log(err); process.exit(1); }
const data = await page.evaluate(() => document.querySelector("canvas").toDataURL("image/png"));
writeFileSync(out, Buffer.from(data.split(",")[1], "base64"));
await browser.close();
