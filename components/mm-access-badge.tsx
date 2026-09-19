"use client";

/** Discord-style green check for players who unlocked matchmaking via
 *  Get Matchmaking Access (role 1523016656161603584). */
export function MmAccessBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Matchmaking access"
      className={`inline-flex shrink-0 ${className}`}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden className="block">
        <rect width="16" height="16" rx="4" fill="#23a559" />
        <path
          fill="#fff"
          d="M6.85 11.35 3.7 8.2l1.1-1.1 2.05 2.05 4.4-4.4 1.1 1.1-5.5 5.5Z"
        />
      </svg>
    </span>
  );
}
