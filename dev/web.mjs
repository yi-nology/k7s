#!/usr/bin/env node
/**
 * dev/web.mjs — start the browser shell.
 *
 *   npm run dev:web         # defaults: vite on 1420, k7s-web on 7180
 *   WEB_PORT=7000 npm run dev:web
 *
 * Stops any prior k7s vite / k7s-web process (matched to this repo only — it
 * will never touch another project's server), refuses to start if something
 * else owns the port, and tears both down when either exits.
 *
 * Mirrors the Tauri dev runner's "make stale state impossible" approach.
 * Lives in dev/ so it can be cross-platform and not require any cargo or
 * rust toolchain knowledge to read.
 */

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const VITE_PORT = process.env.VITE_PORT ?? "1420";
const WEB_PORT = process.env.WEB_PORT ?? "7180";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if `pid` is alive (and we have permission to check). */
function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find any vite / k7s-web process from a previous run, in this repo only.
 * Reads lsof for the port and filters the command line to ours — never
 * touches another project's dev server.
 */
function findOrphans(ports) {
  const found = new Set();
  for (const port of ports) {
    try {
      const out = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "pc"], {
        encoding: "utf8",
      }).stdout ?? "";
      for (const block of out.split("\n\n")) {
        const pidLine = block.split("\n").find((l) => l.startsWith("p"));
        const cmdLine = block.split("\n").find((l) => l.startsWith("c"));
        if (!pidLine || !cmdLine) continue;
        const pid = Number(pidLine.slice(1));
        const cmd = cmdLine.slice(1);
        // Match the vite dev server (ours has `k7s/package.json` in the
        // env) or the k7s-web binary running out of this repo's target/.
        if (cmd.includes(`${repoRoot}/node_modules/.bin/vite`)) {
          found.add(pid);
        } else if (cmd.endsWith("/k7s-web") && cmd.includes(`${repoRoot}/src-tauri/target/`)) {
          found.add(pid);
        }
      }
    } catch {
      // lsof not available, or something else — skip.
    }
  }
  return [...found];
}

/** Refuse to start if something we *don't* own holds the port. */
function checkPortFree(port) {
  try {
    const out = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    }).stdout ?? "";
    // If lsof returns anything (besides the header) we have a process.
    const lines = out.split("\n").filter((l) => l.trim() && !l.startsWith("COMMAND"));
    return lines.length === 0;
  } catch {
    return true; // can't check — assume free, dev will fail loudly
  }
}

function killAndWait(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

// Refuse to take a port we don't own. Tauri dev can re-use the vite port in
// other workflows, so we just warn for the web port (k7s-web) — the vite port
// is more critical to get right because the browser's URL is fixed at 1420.
for (const [port, role] of [[VITE_PORT, "vite"], [WEB_PORT, "k7s-web"]]) {
  if (!checkPortFree(port)) {
    console.error(`✗ ${role}: port ${port} is in use by something we don't own`);
    console.error("  (if it's a previous k7s dev server, kill it first)");
    process.exit(1);
  }
}

// Stop any leftover from a prior run.
const orphans = findOrphans([VITE_PORT, WEB_PORT]);
for (const pid of orphans) {
  console.log(`→ killing previous k7s process (pid ${pid})`);
  killAndWait(pid);
}
if (orphans.length) {
  // Give the OS a moment to release the port.
  await new Promise((r) => setTimeout(r, 600));
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

console.log(`→ starting k7s-web on :${WEB_PORT}`);
const web = spawn(
  "cargo",
  ["run", "--features", "web", "--bin", "k7s-web", "--", "--addr", `127.0.0.1:${WEB_PORT}`],
  { cwd: `${repoRoot}/src-tauri`, stdio: ["ignore", "pipe", "pipe"] },
);
web.stdout.on("data", (d) => process.stdout.write(`[k7s-web] ${d}`));
web.stderr.on("data", (d) => process.stderr.write(`[k7s-web] ${d}`));
web.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    console.error(`\n[k7s-web] exited with code ${code}`);
  }
  // If the back-end dies, kill vite too.
  vite.kill("SIGTERM");
  process.exit(code ?? 0);
});

// Wait for k7s-web's /health to answer before opening the browser — opening
// it to "connection refused" is the only thing worse than a slower-than-
// necessary cold start.
const start = Date.now();
while (Date.now() - start < 30_000) {
  try {
    const res = await fetch(`http://127.0.0.1:${WEB_PORT}/health`);
    if (res.ok) {
      console.log(`✓ k7s-web ready (${Date.now() - start}ms)`);
      break;
    }
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}

console.log(`→ starting vite on :${VITE_PORT}`);
const vite = spawn("npx", ["vite", "--port", VITE_PORT, "--strictPort"], {
  cwd: repoRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
vite.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
vite.on("exit", (code) => {
  web.kill("SIGTERM");
  process.exit(code ?? 0);
});

// Forward SIGINT / SIGTERM to both children, and wait for them.
const cleanup = () => {
  vite.kill("SIGTERM");
  web.kill("SIGTERM");
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
