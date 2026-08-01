// Render the k7s React app in a real Chromium and take a screenshot.
// Without the Tauri shell, @tauri-apps/api invoke() will reject, so the
// app will display its error/empty state — still a valid UI smoke test.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, "snap.png");
const url = process.env.K7S_URL || "http://localhost:5173/";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

// Capture console output for diagnostics
const logs = [];
page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
// Give React a moment to mount and run effects
await page.waitForTimeout(3000);

await page.screenshot({ path: out, fullPage: false });
console.log(`→ screenshot saved to ${out}`);
console.log("\n--- console output ---");
for (const l of logs) console.log(l);
await browser.close();
