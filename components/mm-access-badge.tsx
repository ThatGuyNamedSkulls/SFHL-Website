"use client";

/** Exact Get Matchmaking Access badge (role MM_ACCESS_ROLE_ID in lib/auth.ts). */
export function MmAccessBadge({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/badges/mm-access.png"
      alt="Matchmaking access"
      title="Matchmaking access"
      width={16}
      height={19}
      className={`inline-block shrink-0 align-middle object-contain ${className}`}
    />
  );
}
