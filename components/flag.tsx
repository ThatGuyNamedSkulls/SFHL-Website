"use client";

import { Globe } from "lucide-react";

interface FlagProps {
  /** Flag image path (e.g. "/flags/pt.png") or null. */
  src?: string | null;
  /** Accessible label / tooltip (country name). */
  name?: string | null;
  className?: string;
}

/** Small rounded flag image with a globe fallback when no country is set. */
export function Flag({ src, name, className = "w-5 h-3.5" }: FlagProps) {
  if (!src) {
    return <Globe className={`${className} text-hl-muted`} aria-label="Unknown region" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name || "flag"}
      title={name || undefined}
      className={`${className} object-cover rounded-[2px] inline-block align-middle shadow-sm`}
    />
  );
}
