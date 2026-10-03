import { Suspense } from "react";
import type { Metadata } from "next";
import { getPlayer, publicRating } from "@/lib/db";
import { getRankByLetter } from "@/data/ranks";
import { nameFromSegment } from "@/lib/profile-link";
import { TrackSkeleton, TrackView } from "@/components/track/track-view";
import type { RankTierLetter } from "@/types";

type Props = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const player = await getPlayer(nameFromSegment(name)).catch(() => undefined);
  if (!player) return { title: "Player not found — HyperLeague" };
  const rating = publicRating(player);
  const rank = rating.placementDone ? getRankByLetter(rating.rank as RankTierLetter).name : null;
  const title = `${player.name} · Track — HyperLeague`;
  const description = rank
    ? `How ${player.name} (${rank}, ${rating.elo} Elo) has been playing on HyperLeague: form, sessions and maps.`
    : `How ${player.name} has been playing on HyperLeague.`;
  return { title, description, openGraph: { title, description, siteName: "HyperLeague" } };
}

/** Anyone's tracker (docs/TRACK_UI_PLAN.md Q1); /track opens your own. */
export default async function PlayerTrackPage({ params }: Props) {
  const { name } = await params;
  const playerName = nameFromSegment(name);
  return (
    <Suspense fallback={<TrackSkeleton />}>
      <TrackView key={playerName} name={playerName} />
    </Suspense>
  );
}
