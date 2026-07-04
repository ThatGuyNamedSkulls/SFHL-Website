"use client";

import { ReactNode } from "react";

/**
 * Overlays an equipped avatar-frame image around a circular avatar.
 * Wrap the <Avatar> with this; the frame renders slightly larger than the
 * avatar (FACEIT-style decorative ring) and hides itself if the asset 404s.
 */
export function AvatarFrame({
  frame,
  children,
  className = "",
}: {
  frame?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative inline-block ${className}`}>
      {children}
      {frame && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frame}
          alt=""
          aria-hidden
          className="absolute -inset-[14%] w-[128%] h-[128%] max-w-none object-contain pointer-events-none select-none z-10"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}
