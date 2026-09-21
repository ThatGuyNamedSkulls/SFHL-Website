"use client";

import { useState } from "react";
import { DEFAULT_PROFILE_BACKGROUNDS } from "@/lib/profile-backgrounds";

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
  const [failed, setFailed] = useState(false);
  const letter = (tag || "?").slice(0, 1).toUpperCase();
  const showImg = !!logoUrl && !failed;
  const light = accentColor === "#f1c40f" || accentColor === "#c4b5fd" || accentColor === "#f5f5f5";

  return (
    <div
      className={`shrink-0 overflow-hidden rounded-lg flex items-center justify-center font-black select-none ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: accentColor || "#ff7a18",
        color: light ? "#111111" : "#ffffff",
        fontSize: Math.max(12, Math.round(size * 0.42)),
      }}
      aria-hidden
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        letter
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
      {tag ? <span className="text-hl-gold font-bold mr-1">[{tag}]</span> : null}
      {shown}
    </span>
  );
}
