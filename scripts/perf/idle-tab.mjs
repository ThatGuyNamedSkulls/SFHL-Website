#!/usr/bin/env node
/**
 * How many API requests an open tab makes while nobody touches it
 * (docs/PERFORMANCE_PLAN.md step 16).
 *
 *   node scripts/perf/idle-tab.mjs --base http://localhost:3301 --page /league/2 [--token <hl_session>] [--hidden] [--wait 0] [--seconds 60]
 *
 * Opens the page in headless Chrome, optionally hides the tab (--hidden) and
 * waits --wait seconds first (e.g. 180 to see the idle slow-down), then counts
 * /api/ requests for --seconds. Needs playwright-core (`npm i -D playwright-core`
 * or run it from a folder that has it) and a local Chrome.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  console.error("playwright-core isn't installed: npm i -D playwright-core");
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = opt("base", "http://localhost:3301");
const PAGE = opt("page", "/");
const TOKEN = opt("token");
const HIDDEN = args.includes("--hidden");
const WAIT = Number(opt("wait", "0"));
const SECONDS = Number(opt("seconds", "60"));
const CHROME =
  opt("chrome") ||
  (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/google-chrome");

const browser = await chromium.launch({ executablePath: CHROME });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (TOKEN) await ctx.addCookies([{ name: "hl_session", value: TOKEN, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(BASE + PAGE, { waitUntil: "networkidle", timeout: 120_000 });
  if (HIDDEN) {
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }
  if (WAIT > 0) await page.waitForTimeout(WAIT * 1000);
  const counts = {};
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) {
      const key = u.pathname.replace(/\/\d+/g, "/:id");
      counts[key] = (counts[key] || 0) + 1;
    }
  });
  await page.waitForTimeout(SECONDS * 1000);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`${PAGE} ${HIDDEN ? "(hidden)" : "(visible)"}: ${total} API requests in ${SECONDS}s${WAIT ? ` after ${WAIT}s idle` : ""}`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
} finally {
  await browser.close();
}
