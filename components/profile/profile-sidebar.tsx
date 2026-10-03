"use client";

import { useState } from "react";
import Link from "next/link";
import { Award, ChevronDown, Clock, Pencil, Swords } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { ClubMark } from "@/components/club-identity";
import { Flag } from "@/components/flag";
import { RankBadge } from "@/components/rank-badge";
import { flagPath, countryName } from "@/lib/countries";
import { profileHref } from "@/lib/profile-link";
import { formatMemberSince, parseDbTime, relativeTime } from "@/lib/profile-stats";
import type { RankTierLetter } from "@/types";
import type { ProfileClan, ProfilePlayer } from "@/components/profile/types";

function SideHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <h2 className="mb-2.5 flex items-baseline gap-2 text-sm font-bold text-white">
      {title}
      {sub ? <span className="text-xs font-medium text-[#8a8a8a]">{sub}</span> : null}
    </h2>
  );
}

/** Equipped badge icon with a lucide fallback when the asset is missing. */
function BadgeIcon({ asset, name }: { asset: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (asset && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={asset} alt={name} className="h-8 w-8 shrink-0 object-contain" onError={() => setBroken(true)} />;
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hl-gold/30 bg-hl-gold/10">
      <Award className="h-4 w-4 text-hl-gold" />
    </span>
  );
}

/**
 * The left column under the identity card (docs/PROFILE_UI_PLAN.md §4.2–4.5):
 * About, Badges, Recent activity, Played with and Clan. On phones it follows
 * the Summary tab's content.
 */
export function ProfileSidebar({
  player,
  isOwn,
  clans,
}: {
  player: ProfilePlayer;
  isOwn: boolean;
  clans: ProfileClan[];
}) {
  const [allMates, setAllMates] = useState(false);
  const since = formatMemberSince(player.firstMatchAt);
  const lastMs = parseDbTime(player.lastMatchAt);
  const badges = player.cosmetics?.badges ?? [];
  const mates = player.playedWith ?? [];
  const shownMates = allMates ? mates : mates.slice(0, 5);
  const career = player.careerMatchesPlayed ?? player.stats.matchesPlayed;
  const hours = player.stats.playtimeHours;
  const clan = clans.find((c) => c.tag === player.clubTag) ?? clans[0] ?? null;

  return (
    <div className="space-y-6">
      <section className="px-1">
        <div className="text-sm font-bold text-white">{since ?? "New on HyperLeague"}</div>
        {player.bio ? (
          <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-[#c8c8c8]">{player.bio}</p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-[#8a8a8a]">
            We don&apos;t know anything about {player.username} yet.
            {isOwn ? (
              <>
                {" "}
                <Link href="/settings#bio" className="inline-flex items-center gap-1 font-semibold text-hl-gold hover:underline">
                  <Pencil className="h-3 w-3" /> Write a bio
                </Link>
              </>
            ) : null}
          </p>
        )}
        <ul className="mt-3 space-y-2 text-[0.8125rem] text-[#c8c8c8]">
          {player.country ? (
            <li className="flex items-center gap-2">
              <Flag src={player.countryFlag ?? flagPath(player.country)} name={player.countryName} className="w-5 h-3.5" />
              <span>{player.countryName ?? countryName(player.country)}</span>
              {player.region ? (
                <>
                  <span className="text-[#6a6a6a]">·</span>
                  <span>{player.region}</span>
                </>
              ) : null}
            </li>
          ) : null}
          {lastMs != null ? (
            <li className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-[#8a8a8a]" /> Last match {relativeTime(lastMs)}
            </li>
          ) : null}
          <li className="flex items-center gap-2">
            <Swords className="h-3.5 w-3.5 text-[#8a8a8a]" />
            <span>
              <b className="font-semibold text-white tabular-nums">{career}</b> career {career === 1 ? "match" : "matches"}
              {hours > 0 ? (
                <>
                  {" "}· <b className="font-semibold text-white tabular-nums">{hours}</b> h played
                </>
              ) : null}
            </span>
          </li>
        </ul>
      </section>

      {badges.length > 0 ? (
        <section className="px-1">
          <SideHeading title="Badges" sub={String(badges.length)} />
          <div className="space-y-2">
            {badges.map((b) => (
              <div
                key={b.slug}
                className="flex items-center gap-3 rounded-[0.625rem] border border-white/[0.08] bg-[#1c1c1c] px-2.5 py-2"
                title={b.description ? `${b.name} — ${b.description}` : b.name}
              >
                <BadgeIcon asset={b.asset} name={b.name} />
                <div className="min-w-0">
                  <div className="truncate text-[0.8125rem] font-bold text-white">{b.name}</div>
                  {b.description ? <div className="truncate text-xs text-[#8a8a8a]">{b.description}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="px-1">
        <SideHeading title="Recent activity" sub="Last 90 days" />
        <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-3.5">
          <ActivityHeatmap dates={player.activity ?? []} />
        </div>
      </section>

      {mates.length > 0 ? (
        <section className="px-1">
          <SideHeading title="Played with" sub="teammates" />
          <div className="space-y-1">
            {shownMates.map((p) => {
              const winPct = p.count > 0 ? Math.round((p.wins / p.count) * 100) : 0;
              return (
                <Link key={p.name} href={profileHref(p.name)} className="group flex items-center gap-2.5 py-1.5">
                  <Avatar className="h-[1.875rem] w-[1.875rem]">
                    {p.avatar ? <AvatarImage src={p.avatar} alt={p.name} /> : null}
                    <AvatarFallback className="bg-[#2a2a2a] text-[0.6875rem] font-bold text-white">
                      {(p.name || "?").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-white group-hover:text-[#ff5500]">
                    <RankBadge rank={(p.rank || "UNRANKED") as RankTierLetter} size="sm" showGlow={false} className="!h-[1.125rem] !w-[1.125rem] shrink-0" />
                    <span className="truncate">{p.name}</span>
                    {p.country ? <Flag src={flagPath(p.country)} name={countryName(p.country)} className="h-3 w-4 shrink-0" /> : null}
                  </span>
                  <span className="shrink-0 text-right text-xs leading-tight text-[#8a8a8a]">
                    <b className="text-[0.8125rem] text-white tabular-nums">{p.count}</b> {p.count === 1 ? "game" : "games"}
                    <br />
                    <span className={`tabular-nums ${winPct >= 50 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>{winPct}% W</span>
                  </span>
                </Link>
              );
            })}
          </div>
          {mates.length > 5 ? (
            <button
              type="button"
              onClick={() => setAllMates((v) => !v)}
              className="mt-1.5 inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-[#ff5500] hover:underline"
            >
              {allMates ? "Show less" : `Show all ${mates.length}`}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${allMates ? "rotate-180" : ""}`} />
            </button>
          ) : null}
        </section>
      ) : null}

      {clan ? (
        <section className="px-1">
          <SideHeading title="Clan" />
          <Link
            href={`/clans/${clan.id}`}
            className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-3 hover:border-hl-gold/40"
          >
            <ClubMark tag={clan.tag} accentColor={clan.accentColor} logoUrl={clan.logoUrl} size={42} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">{clan.name}</div>
              <div className="truncate text-xs text-[#8a8a8a]">
                {clan.memberCount} {clan.memberCount === 1 ? "member" : "members"} · {clan.region}
                {clan.ownerName && clan.ownerName.toLowerCase() === player.username.toLowerCase() ? " · Owner" : ""}
              </div>
            </div>
          </Link>
        </section>
      ) : null}
    </div>
  );
}
