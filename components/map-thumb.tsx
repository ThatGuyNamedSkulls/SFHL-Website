"use client";

import { useState } from "react";
import { prettyMap } from "@/lib/format";

const WASH: Record<string, [string, string]> = {
  mirage: ["#d4b896", "#4a3018"],
  "dust ii": ["#e0c46a", "#6a4a18"],
  dust2: ["#e0c46a", "#6a4a18"],
  inferno: ["#e07040", "#4a1c10"],
  overpass: ["#6aa0c8", "#1a3048"],
  vertigo: ["#8cba4a", "#243010"],
  nuke: ["#9aaa58", "#2a3018"],
  ancient: ["#4a8a62", "#102018"],
  anubis: ["#d4b45a", "#4a3810"],
  cache: ["#6a8a42", "#1a2810"],
  train: ["#7a8a98", "#1c242c"],
};

/**
 * Map artwork: drop an image named after the map into public/maps/
 * (see public/maps/README.md), e.g. "dust-ii.png" for Dust II. The first of
 * these extensions that exists is used.
 */
const EXTENSIONS = ["webp", "png", "jpg", "jpeg"] as const;

/** "Dust II" / "de_dust2" -> "dust-ii" (the file name in public/maps/). */
export function mapImageSlug(map: string): string {
  return prettyMap(map).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Per page load: which file each map resolved to, or null when it has none,
// so every thumbnail of the same map doesn't probe the folder again.
const resolved = new Map<string, string | null>();

/** Map thumbnail: the map's image when public/maps/ has one, else a gradient. */
export function MapThumb({ map, className = "w-14 h-9" }: { map: string; className?: string }) {
  const label = prettyMap(map);
  const slug = mapImageSlug(map);
  const [attempt, setAttempt] = useState(0);
  const [from, to] = WASH[label.toLowerCase()] ?? ["#6a6a6a", "#222"];
  const known = resolved.get(slug);
  const src =
    known !== undefined
      ? known
      : slug && attempt < EXTENSIONS.length
        ? `/maps/${slug}.${EXTENSIONS[attempt]}`
        : null;
  return (
    <span className={`relative overflow-hidden rounded-md shrink-0 ${className}`}>
      <span
        className="absolute inset-0"
        style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
      />
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_35%,rgba(255,255,255,0.28),transparent_55%)]" />
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={label}
          className="absolute inset-0 h-full w-full object-cover"
          onLoad={() => resolved.set(slug, src)}
          onError={() => {
            if (attempt + 1 >= EXTENSIONS.length) resolved.set(slug, null);
            setAttempt((a) => a + 1);
          }}
        />
      ) : null}
    </span>
  );
}
