import { Suspense } from "react";
import type { Metadata } from "next";
import { getPlayer, publicRating } from "@/lib/db";
import { pickAvatar } from "@/lib/avatar";
import { getRankByLetter } from "@/data/ranks";
import { nameFromSegment } from "@/lib/profile-link";
import { ProfileSkeleton, ProfileView } from "@/components/profile/profile-view";
import type { RankTierLetter } from "@/types";

type Props = { params: Promise<{ name: string }> };

/**
 * Link previews (docs/PROFILE_UI_PLAN.md Q4): Discord, WhatsApp and the like
 * read these tags, so a pasted profile link shows the player, rank and Elo.
 * Next.js renders them into <head> for those bots (html-limited bots).
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const player = await getPlayer(nameFromSegment(name)).catch(() => undefined);
  if (!player) return { title: "Player not found — HyperLeague" };

  const rating = publicRating(player);
  const rank = rating.placementDone ? getRankByLetter(rating.rank as RankTierLetter).name : null;
  const wins = Number(player.matches_won) || 0;
  const losses = Math.max(0, (Number(player.matches_played) || 0) - wins);
  const title = rank ? `${player.name} · ${rank} · ${rating.elo} Elo — HyperLeague` : `${player.name} — HyperLeague`;
  const description = rank
    ? `${player.name} is skill level ${rank} with ${rating.elo} Elo on HyperLeague, Counter Blox matchmaking. ${wins} wins, ${losses} losses.`
    : `${player.name} is playing placement matches on HyperLeague, Counter Blox matchmaking.`;
  const avatar = pickAvatar(player.roblox_avatar_image, player.discord_avatar, player.discord_id);
  const images = /^https?:\/\//i.test(avatar) ? [{ url: avatar, width: 128, height: 128, alt: player.name }] : undefined;

  return {
    title,
    description,
    openGraph: { title, description, type: "profile", siteName: "HyperLeague", images },
    twitter: { card: "summary", title, description, images: images?.map((i) => i.url) },
  };
}

export default async function PlayerProfilePage({ params }: Props) {
  const { name } = await params;
  const playerName = nameFromSegment(name);
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      {/* A new key per player resets the page when moving between profiles. */}
      <ProfileView key={playerName} name={playerName} />
    </Suspense>
  );
}
