"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AtSign, Flag, Globe, LineChart, MoreHorizontal, Pencil, Share2, ShieldCheck, UserCheck, UserPlus, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AvatarFrame } from "@/components/avatar-frame";
import { NameBadge } from "@/components/name-badge";
import { OnlineBadge, OnlineLabel } from "@/components/online-status";
import { RankBadge } from "@/components/rank-badge";
import { ReportDialog } from "@/components/profile/report-dialog";
import { useSession } from "@/components/session-provider";
import { useMyParty } from "@/components/use-my-party";
import { apiGetJson } from "@/lib/client-api";
import { optimizedAsset } from "@/lib/optimized-asset";
import { trackHref } from "@/lib/track-link";
import type { RankTierLetter } from "@/types";
import type { ProfilePlayer } from "@/components/profile/types";

export type FriendState = "none" | "pending" | "friends";

/**
 * The profile's identity card (docs/PROFILE_UI_PLAN.md §4.1): card art, avatar
 * and frame, the name on its own line with the @handle under it, the title and
 * online status, then Add friend / Share / ⋯. On phones it turns into a banner
 * with a rank strip, so the rank shows before the tabs.
 */
export function IdentityCard({
  player,
  isOwn,
  online,
  friendState,
  onAddFriend,
}: {
  player: ProfilePlayer;
  isOwn: boolean;
  online: boolean;
  friendState: FriendState;
  onAddFriend: () => Promise<string>;
}) {
  const { session } = useSession();
  const router = useRouter();
  const { party, refresh: refreshParty } = useMyParty(session?.discordId);
  const [message, setMessage] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [reporting, setReporting] = useState(false);
  // Asked only when the More menu opens, so viewing a profile costs nothing extra.
  const checkStaff = (open: boolean) => {
    if (!open || !session || isStaff) return;
    apiGetJson<{ staff?: boolean; admin?: boolean; manager?: boolean }>("/api/staff/me", { ttlMs: 5 * 60_000 })
      .then(({ ok, json }) => setIsStaff(ok && !!(json?.staff || json?.admin || json?.manager)))
      .catch(() => undefined);
  };
  const cardArt = player.cosmetics?.card?.asset ?? null;
  const handle = (player.discordUsername ?? "").trim();
  const showHandle = !!handle && handle.toLowerCase() !== player.username.toLowerCase();
  const placed = !!player.placementDone;
  const inMyParty = !!party?.members.some((m) => m.playerName === player.username);

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 4000);
  };

  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => flash(done),
      () => flash("Could not copy")
    );

  const inviteToParty = async () => {
    if (!party) return;
    const res = await fetch(`/api/parties/${party.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toName: player.username }),
    });
    const data = await res.json().catch(() => ({}));
    flash(
      !res.ok
        ? data.error || "Failed to invite"
        : data.status === "pending"
          ? "Invite already sent."
          : `Invited ${player.username} to your party.`
    );
    await refreshParty(true);
  };

  return (
    <section className="relative overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
      <div className="absolute inset-x-0 top-0 h-[9.5rem] lg:h-[22rem]" aria-hidden>
        {cardArt ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={optimizedAsset(cardArt)}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(ellipse_at_50%_20%,#2a2a2a,#161616_70%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-[#1c1c1c]/50 to-[#1c1c1c]" />
      </div>

      <div className="relative grid grid-cols-[5.5rem_minmax(0,1fr)] items-end gap-x-4 gap-y-3 px-4 pb-4 pt-[4.75rem] lg:grid-cols-1 lg:justify-items-center lg:px-5 lg:pb-5 lg:pt-[7.25rem] lg:text-center">
        <OnlineBadge
          online={online}
          size="md"
          className="[&>span:last-child]:bottom-1 [&>span:last-child]:right-1 [&>span:last-child]:h-4 [&>span:last-child]:w-4 lg:[&>span:last-child]:bottom-2 lg:[&>span:last-child]:right-2 lg:[&>span:last-child]:h-5 lg:[&>span:last-child]:w-5"
        >
          <AvatarFrame frame={player.cosmetics?.frame?.asset}>
            <Avatar className="h-[5.5rem] w-[5.5rem] border-0 lg:h-[7.5rem] lg:w-[7.5rem]">
              {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt={player.username} /> : null}
              <AvatarFallback className="bg-[#2a2a2a] text-2xl font-bold text-white">
                {(player.username || "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </AvatarFrame>
        </OnlineBadge>

        <div className="min-w-0 lg:mt-2 lg:max-w-full">
          <h1 className="flex min-w-0 items-center gap-1.5 text-[1.1875rem] font-extrabold tracking-tight text-white lg:justify-center lg:text-[1.3125rem]">
            {player.clubTag ? (
              <span className="shrink-0 text-[0.8125rem] font-bold tracking-wide text-hl-gold lg:text-[0.9375rem]">
                [{player.clubTag}]
              </span>
            ) : null}
            <span className="truncate">{player.username}</span>
            <NameBadge badge={player.badge} verified={player.mmAccess} size="lg" />
          </h1>
          {showHandle ? <div className="mt-0.5 truncate text-[0.8125rem] text-[#a0a0a0]">@{handle}</div> : null}
          {player.cosmetics?.title ? (
            <div className="mt-1 truncate text-xs font-semibold italic text-[#ff5500]">{player.cosmetics.title}</div>
          ) : null}
          <div className="mt-1.5">
            <OnlineLabel online={online} />
          </div>
        </div>

        <div className="col-span-2 flex items-center gap-2.5 rounded-[0.625rem] border border-white/[0.08] bg-[#121212] px-3 py-2 text-[0.8125rem] text-[#8a8a8a] lg:hidden">
          <RankBadge
            rank={(placed ? player.rank : "UNRANKED") as RankTierLetter}
            size="sm"
            showGlow={false}
            className="!h-7 !w-7"
          />
          {placed ? (
            <>
              <span className="text-[1.375rem] font-black leading-none tabular-nums text-[#ff5500]">{player.elo}</span>
              <span>Elo</span>
            </>
          ) : (
            <span className="font-bold text-white">
              Placement {player.placementGamesPlayed ?? 0}/{player.placementGamesTotal ?? 3}
            </span>
          )}
          {placed && player.rankings?.overall ? (
            <span className="ml-auto inline-flex items-center gap-1">
              <Globe className="h-3.5 w-3.5 text-[#ff5500]" />
              <b className="tabular-nums text-white">#{player.rankings.overall.toLocaleString()}</b> Global
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative flex gap-2 border-t border-white/[0.08] p-3">
        {isOwn ? (
          <Link
            href="/settings"
            className="flex h-[2.375rem] flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#232323] text-[0.8125rem] font-bold uppercase tracking-[0.06em] text-white hover:border-white/20"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit profile
          </Link>
        ) : friendState === "friends" ? (
          <span className="flex h-[2.375rem] flex-1 items-center justify-center gap-2 rounded-lg border border-[#2ecc71]/30 bg-[#2ecc71]/10 text-[0.8125rem] font-bold uppercase tracking-[0.06em] text-[#2ecc71]">
            <UserCheck className="h-4 w-4" /> Friends
          </span>
        ) : friendState === "pending" ? (
          <span className="flex h-[2.375rem] flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#232323] text-[0.8125rem] font-bold uppercase tracking-[0.06em] text-[#8a8a8a]">
            Requested
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void onAddFriend().then(flash)}
            disabled={!session}
            title={session ? undefined : "Log in to add friends"}
            className="flex h-[2.375rem] flex-1 items-center justify-center gap-2 rounded-lg bg-[#ff5500] text-[0.8125rem] font-extrabold uppercase tracking-[0.06em] text-white hover:bg-[#ff6a1f] disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> Add friend
          </button>
        )}
        <button
          type="button"
          title="Copy profile link"
          aria-label="Copy profile link"
          onClick={() => void copy(window.location.href.split("?")[0], "Profile link copied")}
          className="flex h-[2.375rem] w-[2.375rem] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#232323] text-[#c8c8c8] hover:border-white/20 hover:text-white"
        >
          <Share2 className="h-4 w-4" />
        </button>
        <DropdownMenu onOpenChange={checkStaff}>
          <DropdownMenuTrigger
            aria-label="More"
            className="flex h-[2.375rem] w-[2.375rem] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#232323] text-[#c8c8c8] outline-none hover:border-white/20 hover:text-white"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 border border-white/10 bg-[#202020] text-white">
            {!isOwn && party && !inMyParty ? (
              <DropdownMenuItem className="cursor-pointer gap-2.5 px-2.5 py-2" onClick={() => void inviteToParty()}>
                <Users className="h-4 w-4" /> Invite to party
              </DropdownMenuItem>
            ) : null}
            {handle ? (
              <DropdownMenuItem
                className="cursor-pointer gap-2.5 px-2.5 py-2"
                onClick={() => void copy(`@${handle}`, `Copied @${handle}`)}
              >
                <AtSign className="h-4 w-4" /> Copy Discord @
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="cursor-pointer gap-2.5 px-2.5 py-2"
              onClick={() => router.push(trackHref(player.username))}
            >
              <LineChart className="h-4 w-4" /> Open tracker
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2.5 px-2.5 py-2"
              onClick={() => void copy(window.location.href.split("?")[0], "Profile link copied")}
            >
              <Share2 className="h-4 w-4" /> Copy profile link
            </DropdownMenuItem>
            {session && !isOwn ? (
              <DropdownMenuItem className="cursor-pointer gap-2.5 px-2.5 py-2 text-hl-red" onClick={() => setReporting(true)}>
                <Flag className="h-4 w-4" /> Report player
              </DropdownMenuItem>
            ) : null}
            {isStaff ? (
              <DropdownMenuItem
                className="cursor-pointer gap-2.5 px-2.5 py-2"
                onClick={() => router.push(`/staff?player=${encodeURIComponent(player.username)}`)}
              >
                <ShieldCheck className="h-4 w-4 text-hl-gold" /> Manage as staff
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {session && !isOwn ? (
        <ReportDialog player={player.username} open={reporting} onOpenChange={setReporting} onSent={flash} />
      ) : null}
      {message ? <div className="border-t border-white/[0.08] px-4 py-2 text-xs text-[#ff5500]">{message}</div> : null}
    </section>
  );
}
