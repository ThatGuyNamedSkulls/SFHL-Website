/**
 * Runs once in the parent test runner (node --test-global-setup).
 *
 * Every test file runs in its own child process and keeps its SQLite handle
 * open until that process exits — on Windows the file can't be deleted from
 * inside it. So all test databases live under one root folder created here
 * and removed here, after every child has exited, pass or fail.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function globalSetup() {
  process.env.HL_TEST_ROOT = mkdtempSync(join(tmpdir(), "hl-web-tests-"));
}

export async function globalTeardown() {
  const root = process.env.HL_TEST_ROOT;
  if (!root || !existsSync(root)) return;
  rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  if (existsSync(root)) {
    console.error(`Could not remove test databases in ${root}: ${readdirSync(root).join(", ")}`);
    process.exitCode = 1;
  }
}
