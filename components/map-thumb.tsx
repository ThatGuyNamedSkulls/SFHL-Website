"use client";

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

/** FACEIT-style map thumbnail (gradient stand-in for loading-screen art). */
export function MapThumb({ map, className = "w-14 h-9" }: { map: string; className?: string }) {
  const label = prettyMap(map);
  const [from, to] = WASH[label.toLowerCase()] ?? ["#6a6a6a", "#222"];
  return (
    <span className={`relative overflow-hidden rounded-md shrink-0 ${className}`}>
      <span
        className="absolute inset-0"
        style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
      />
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_35%,rgba(255,255,255,0.28),transparent_55%)]" />
    </span>
  );
}
