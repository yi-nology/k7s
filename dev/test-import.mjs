/**
 * Quick end-to-end check of the "Import kubeconfig" button in the web shell.
 * Loads the running k7s-web, watches the console for errors, drives the
 * sidebar's cluster switcher open, and clicks the "Import kubeconfig…" item.
 *
 * The native file picker can't be driven headlessly, so we set the input
 * files directly (Playwright supports this) after the picker is open and
 * wait for the menu to update.
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.K7S_URL ?? "http://127.0.0.1:8080/";

// A throwaway kubeconfig the test will upload.
const FIXTURE = `apiVersion: v1
kind: Config
current-context: e2e-test
clusters:
- name: e2e-cluster
  cluster: { server: https://127.0.0.1:6443, insecure-skip-tls-verify: true }
contexts:
- name: e2e-test
  context: { cluster: e2e-cluster, user: e2e-user }
users:
- name: e2e-user
  user: { token: e2e-token }
`;

mkdirSync("/tmp/k7s-test", { recursive: true });
writeFileSync("/tmp/k7s-test/kubeconfig.yaml", FIXTURE);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
page.on("requestfailed", (r) =>
  logs.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`),
);
page.on("request", (r) => {
  if (!r.url().includes("/api/")) return;
  logs.push(`[api->] ${r.method()} ${r.url()}`);
});
page.on("response", (r) => {
  if (!r.url().includes("/api/")) return;
  logs.push(`[api<-] ${r.status()} ${r.request().method()} ${r.url()}`);
});
page.on("requestfinished", async (r) => {
  if (!r.url().includes("/api/")) return;
  try {
    const resp = await r.response();
    if (resp) {
      logs.push(`[reqfin] ${resp.status()} ${r.method()} ${r.url()}`);
    } else {
      logs.push(`[reqfin] no-response ${r.method()} ${r.url()} failure=${r.failure()?.errorText}`);
    }
  } catch (e) {
    logs.push(`[reqfin-err] ${r.method()} ${r.url()} ${e.message}`);
  }
});

console.log(`→ opening ${URL}`);
await page.goto(URL, { waitUntil: "load", timeout: 15_000 });
await page.waitForTimeout(2_500);

console.log("→ opening cluster switcher (top-left badge)");
// The switcher always shows *something* (cluster name, context, or "no cluster").
// Locate by the chevron that's only present in the switcher row.
const switcher = page.locator("text=▼").first();
const switcherCount = await switcher.count();
console.log(`  found switcher chevron ${switcherCount} time(s)`);
if (switcherCount === 0) {
  console.log("--- page text snapshot ---");
  console.log((await page.locator("body").textContent())?.slice(0, 2000));
  await page.screenshot({ path: "/tmp/k7s-test/baseline.png", fullPage: true });
}
await switcher.click({ timeout: 5_000 });
await page.waitForTimeout(500);

console.log("→ screenshot menu-open state");
await page.screenshot({ path: "/tmp/k7s-test/menu-open.png", fullPage: true });

console.log("→ clicking 'Import kubeconfig…'");
const importBtn = page.locator("text=Import kubeconfig").first();
const importCount = await importBtn.count();
console.log(`  found 'Import kubeconfig' ${importCount} time(s)`);
if (importCount === 0) {
  // Maybe the menu didn't open — look for nearby text
  const all = await page.locator("body").textContent();
  console.log("--- menu text snapshot ---");
  console.log(all?.slice(0, 2000));
}

// Hook createElement + addEventListener so we can see the full lifecycle
// of the hidden file input.
await page.evaluate(() => {
  const origCreate = document.createElement.bind(document);
  window.__diag = { inputs: [], listeners: [], changeFired: null, lastInput: null };
  document.createElement = function (tag) {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === "input") {
      const snap = { ts: Date.now(), initialType: el.type, accept: el.accept };
      queueMicrotask(() => {
        snap.finalType = el.type;
        snap.finalAccept = el.accept;
      });
      window.__diag.inputs.push(snap);
      window.__diag.lastInput = el;
    }
    return el;
  };
  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, handler, opts) {
    if (this === window.__diag.lastInput) {
      window.__diag.listeners.push({ type, opts: opts === true ? "capture" : opts === false ? "bubble" : opts?.capture ? "capture" : "bubble" });
    }
    return origAdd.call(this, type, handler, opts);
  };
  // Capture when input is appended to body, so we can hook its native
  // events later. The helper sets accept then appendChild; we wait for
  // appendChild by polling isConnected in a microtask queue.
  const tryHook = () => {
    const el = window.__diag.lastInput;
    if (el && el.isConnected && el.type === "file") {
      origAdd.call(el, "change", () => {
        window.__diag.changeFired = { ts: Date.now(), files: el.files?.length };
      });
    }
  };
  setInterval(tryHook, 50);
});

let chooserResolve;
const chooserPromise = new Promise((r) => (chooserResolve = r));
page.on("filechooser", async (chooser) => {
  console.log("  [filechooser] native dialog opened — supplying fixture via chooser");
  await chooser.setFiles("/tmp/k7s-test/kubeconfig.yaml");
  chooserResolve();
});

await importBtn.click({ timeout: 5_000 });
const chooserFired = await Promise.race([
  chooserPromise.then(() => true),
  new Promise((r) => setTimeout(() => r(false), 2000)),
]);
console.log(`  filechooser event fired: ${chooserFired}`);

// Wait for either: the API call to land, or the failure to surface.
await page.waitForTimeout(5_000);

const fileInputCount = await page.locator("input[type=file]").count();
console.log(`  file inputs in DOM: ${fileInputCount}`);

console.log("→ waiting for UI to update");
await page.screenshot({ path: "/tmp/k7s-test/after-import.png", fullPage: true });

// Re-open the menu to see if contexts updated.
const switcher2 = page.locator("text=▼").first();
await switcher2.click({ timeout: 5_000 });
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/k7s-test/menu-after.png", fullPage: true });

// Did "e2e-test" appear in the sidebar?
const e2eVisible = await page
  .locator("text=e2e-test")
  .first()
  .isVisible()
  .catch(() => false);
console.log(`  'e2e-test' visible in UI: ${e2eVisible}`);

// Probe: did the side panel show the contexts?
const ctxList = await page.locator("text=e2e-test,text=default").count();
console.log(`  context occurrences in page: ${ctxList}`);

console.log("\n--- console logs ---");
for (const l of logs) console.log(l);

await browser.close();
console.log("\n→ screenshots: /tmp/k7s-test/{baseline,menu-open,after-import}.png");
