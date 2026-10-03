"use client";

import { useState } from "react";
import { DEFAULT_PROFILE_BACKGROUNDS } from "@/lib/profile-backgrounds";

/**
 * A clan's logo: its image, or its tag on a deep tint of the clan color
 * (docs/CLANS_UI_PLAN.md). Two letters from 28 px up, one below.
 */
export function ClubMark({
  tag,
  accentColor,
  logoUrl,
  size = 48,
  className = "",
}: {
  tag: string;
  accentColor: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const letters = (tag || "?").slice(0, size >= 28 ? 2 : 1).toUpperCase();
  const showImg = !!logoUrl && failed !== logoUrl;
  const color = accentColor || "#ff7a18";

  return (
    <div
      className={`shrink-0 overflow-hidden rounded-lg flex items-center justify-center font-bold tracking-[0.02em] select-none text-white ${className}`}
      style={{
        width: size,
        height: size,
        background: showImg ? "#141414" : `color-mix(in srgb, ${color} 58%, #121212)`,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
        fontSize: Math.max(10, Math.round(size * (letters.length > 1 ? 0.34 : 0.42))),
      }}
      aria-hidden
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(logoUrl!)}
        />
      ) : (
        letters
      )}
    </div>
  );
}

export function ClubColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DEFAULT_PROFILE_BACKGROUNDS.map((bg) => {
        const selected = value === bg.color;
        return (
          <button
            key={bg.slug}
            type="button"
            title={bg.name}
            onClick={() => onChange(bg.color)}
            className={`h-7 w-7 rounded-full border transition-shadow ${
              selected ? "border-white ring-2 ring-hl-gold" : "border-white/20 hover:border-white/50"
            }`}
            style={{ backgroundColor: bg.color }}
            aria-label={bg.name}
            aria-pressed={selected}
          />
        );
      })}
    </div>
  );
}

export function ClubTaggedName({
  name,
  tag,
  discordUsername,
  className = "",
}: {
  name: string;
  tag?: string | null;
  discordUsername?: string | null;
  className?: string;
}) {
  const handle = (discordUsername ?? "").trim();
  const shown =
    handle && handle.toLowerCase() !== name.toLowerCase() ? `${name} (@${handle})` : name;
  return (
    <span className={className}>
      {tag ? (
        <span className="text-hl-gold font-semibold mr-1 text-[0.78em] tracking-wide align-middle">
          [{tag}]
        </span>
      ) : null}
      {shown}
    </span>
  );
}
