"use client";

import { useState, type ImgHTMLAttributes } from "react";
import { avatarFallbackFor } from "@/lib/avatar-fallback";

/**
 * A player picture as a plain <img> that never shows the broken-image icon: a
 * dead link falls back to the account's default Discord avatar, and if even
 * that fails it renders nothing (the parent's circle shows through).
 */
export function AvatarImg({ src, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const current = [src, avatarFallbackFor(src)].find((url) => !failed.includes(url));
  if (!current) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote Discord CDN avatars
    <img
      alt=""
      referrerPolicy="no-referrer"
      {...props}
      src={current}
      onError={() => setFailed((list) => [...list, current])}
    />
  );
}
