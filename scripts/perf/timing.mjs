#!/usr/bin/env node
/**
 * Page / API timing with database round trips (docs/PERFORMANCE_PLAN.md step 16).
 *
 *   npx next build --webpack            # once, after changes
 *   node scripts/perf/timing.mjs --db file:./perf.db [--token <hl_session>] [--latency 40] [--cold] /league/2 /api/me/status
 *
 * Starts `next start` on port 3301 against a LOCAL file database (it refuses
 * anything else), with a fake round-trip delay (--latency ms, default 40 ≈
 * Turso from the same region) and a log of every round trip. For each path it
 * prints the time, the round trips and how many were table setup.
 * --cold restarts the server before each path (a fresh Vercel instance);
 * otherwise each path is requested once to warm up, then measured.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const DB = opt("db");
const TOKEN = opt("token");
const LATENCY = opt("latency", "40");
const PORT = opt("port", "3301");
const COLD = flag("cold");
const paths = args.filter((a) => a.startsWith("/"));

if (!DB || !DB.startsWith("file:")) {
  console.error("--db must be a local file: database (never the live Turso database)");
  process.exit(1);
}
if (!paths.length) {
  console.error("give at least one path, e.g. /league/2");
  process.exit(1);
}

const LOG = path.join(os.tmpdir(), `hl-perf-${process.pid}.log`);
const BASE = `http://localhost:${PORT}`;
let server = null;

function stopServer() {
  if (!server) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-server.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  server = null;
}

async function startServer() {
  stopServer();
  // Windows needs a shell to run npx; give it one command string (no args array).
  const win = process.platform === "win32";
  server = spawn(win ? `npx next start -p ${PORT}` : "npx", win ? [] : ["next", "start", "-p", PORT], {
    shell: win,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      TURSO_DATABASE_URL: DB,
      TURSO_AUTH_TOKEN: "",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "local-perf-secret",
      HL_PERF_LATENCY_MS: LATENCY,
      HL_PERF_LOG: LOG,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server didn't start in 60 s")), 60_000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("Ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

async function hit(p) {
  const t = performance.now();
  const res = await fetch(BASE + p, { headers: TOKEN ? { cookie: `hl_session=${TOKEN}` } : {} });
  await res.arrayBuffer();
  return { ms: performance.now() - t, status: res.status };
}

try {
  if (!COLD) await startServer();
  console.log(`${COLD ? "cold" : "warm"} · fake latency ${LATENCY} ms · ${TOKEN ? "logged in" : "logged out"}`);
  for (const p of paths) {
    if (COLD) await startServer();
    else await hit(p);
    fs.writeFileSync(LOG, "");
    const { ms, status } = await hit(p);
    const lines = fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean);
    const setup = lines.filter((l) => / (CREATE|PRAGMA|ALTER) /.test(l)).length;
    console.log(`${p.padEnd(32)} ${String(status).padEnd(4)} ${(ms / 1000).toFixed(2)}s  ${String(lines.length).padStart(3)} round trips  (${setup} table setup)`);
  }
} finally {
  stopServer();
  fs.rmSync(LOG, { force: true });
}
