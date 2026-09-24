"use client";

import { useSelectedLayoutSegment } from "next/navigation";

/**
 * The season hero in the league layout. An upcoming season's Overview draws
 * its own bigger hero (JOIN NOW), so the standard one steps aside there; on
 * the other tabs phones get the slim `compact` banner so the content starts
 * on the first screen.
 */
export function LeagueHeroSlot({
  upcoming,
  full,
  compact,
}: {
  upcoming: boolean;
  full: React.ReactNode;
  compact: React.ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  if (segment === null) return upcoming ? null : <>{full}</>;
  return (
    <>
      <div className="sm:hidden">{compact}</div>
      <div className="hidden sm:block">{full}</div>
    </>
  );
}
