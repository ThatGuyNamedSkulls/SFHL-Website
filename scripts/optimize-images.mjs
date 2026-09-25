#!/usr/bin/env node
/**
 * Small WebP copies of the heavy public images (docs/PERFORMANCE_PLAN.md step 2).
 *
 *   node scripts/optimize-images.mjs
 *
 * Rank badges (500×500 PNG, ~250 KB) are shown at ≤ 64 px, profile cards
 * (up to 1.2 MB) at ≤ 300 px wide, avatar frames at ≤ ~170 px. This writes
 * resized WebP copies to public/_opt/<folder>/ and a manifest
 * (lib/optimized-assets.json: original path → copy) that lib/optimized-asset.ts
 * uses at render time. Originals stay untouched. A copy is only kept when it is
 * smaller than the original; files sharp can't read are skipped.
 *
 * Re-run after adding a new rank icon, profile card or frame (the bot grants
 * cosmetics by path, so the paths never change — only the manifest grows).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(PUBLIC, "_opt");
const MANIFEST = path.join(ROOT, "lib", "optimized-assets.json");

/** Folder → output width (2× the largest size it's shown at). */
const FOLDERS = {
  ranks: 160,
  profilecards: 640,
  avatarframes: 384,
};
const INPUT = /\.(png|jpe?g|webp|avif)$/i;

const manifest = {};
let before = 0;
let after = 0;
for (const [folder, width] of Object.entries(FOLDERS)) {
  const dir = path.join(PUBLIC, folder);
  if (!fs.existsSync(dir)) continue;
  fs.mkdirSync(path.join(OUT, folder), { recursive: true });
  for (const file of fs.readdirSync(dir).sort()) {
    if (!INPUT.test(file)) continue;
    const src = path.join(dir, file);
    const out = path.join(OUT, folder, file.replace(INPUT, ".webp"));
    try {
      await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90 }).toFile(out);
    } catch (e) {
      console.log(`skip  ${folder}/${file}  (${String(e.message).split("\n")[0]})`);
      continue;
    }
    const a = fs.statSync(src).size;
    const b = fs.statSync(out).size;
    if (b >= a) {
      fs.rmSync(out);
      console.log(`keep  ${folder}/${file}  (already small: ${Math.round(a / 1024)} KB)`);
      continue;
    }
    before += a;
    after += b;
    manifest[`/${folder}/${file}`] = `/_opt/${folder}/${path.basename(out)}`;
    console.log(`ok    ${folder}/${file}  ${Math.round(a / 1024)} KB → ${Math.round(b / 1024)} KB`);
  }
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n${Object.keys(manifest).length} images: ${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB`);
