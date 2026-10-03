"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Flag, Info, Trophy, UserPlus } from "lucide-react";
import { MapThumb } from "@/components/map-thumb";
import { RatingPill } from "@/components/match-list-row";
import { RankBadge } from "@/components/rank-badge";
import { useClan } from "@/components/clans/clan-context";
import { BoxHead, Medal, PANEL, PlayerAvatar, RoleChip } from "@/components/clans/ui";
import type { ClanEventData } from "@/components/clans/types";
import { regionMeta } from "@/lib/regions";
import { profileHref } from "@/lib/profile-link";
import { rulesLines, type ClanTab } from "@/lib/clan-ui";
import { STAT_ESTIMATE_HINT } from "@/lib/match-stats";
import { formatWhen } from "@/lib/profile-stats";
import type { RankTierLetter } from "@/types";

const CUP_STATUS: Record<string, string> = { open: "registration open", live: "live", completed: "finished" };
const RATING_HINT = `The members' average rating. ${STAT_ESTIMATE_HINT}`;

/*
 * Recent activity in the profile's match-row style (components/profile/match-row.tsx):
 * date · score · the members' Elo · their rating · who played · map. Joins, the
 * creation and cups use the same columns. The columns follow the panel's own
 * width (a container query): beside the sidebar it's narrower than the screen.
 */
const COLS =
  "@min-[44rem]:grid-cols-[5.75rem_5.25rem_minmax(7.5rem,0.8fr)_3.75rem_minmax(0,1.4fr)_8rem] @min-[44rem]:[grid-template-areas:none]";
const MATCH_NARROW = "grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:'score_map_elo'_'meta_meta_rating']";
const ROW = "grid items-center gap-x-2.5 gap-y-1.5 border-l-[3px] px-3 py-2.5 @min-[44rem]:px-4";

type MatchEvent = Extract<ClanEventData, { kind: "match" }>;

function ActivityHeader() {
  return (
    <div
      className={`hidden gap-2.5 border-b border-l-[3px] border-white/[0.06] border-l-transparent px-4 py-2.5 text-[0.75rem] font-semibold text-[#6a6a6a] @min-[44rem]:grid ${COLS}`}
    >
      <span>Date</span>
      <span>Score</span>
      <span>Members&apos; Elo</span>
      <span className="flex items-center gap-1" title={RATING_HINT}>
        Rating <Info className="h-3 w-3" />
      </span>
      <span>Members</span>
      <span>Map</span>
    </div>
  );
}

function When({ at }: { at: number }) {
  const { day, time } = formatWhen(at);
  return (
    <span className="hidden min-w-0 leading-tight @min-[44rem]:block">
      <span className="block truncate text-[0.875rem] font-semibold text-white">{day}</span>
      <span className="block text-[0.75rem] text-[#8a8a8a]">{time}</span>
    </span>
  );
}

/** Who played, the best-rated member in white. */
function Names({ players, best }: { players: string[]; best?: string }) {
  return (
    <>
      {players.map((p, i) => (
        <Fragment key={p}>
          {i ? ", " : ""}
          <span className={p === best ? "font-semibold text-[#e8e8e8]" : ""}>{p}</span>
        </Fragment>
      ))}
      {players.length >= 5 ? <span className="text-[#6a6a6a]"> · full stack</span> : null}
    </>
  );
}

function MatchEventRow({ e, avatarOf }: { e: MatchEvent; avatarOf: (name: string) => string | null }) {
  const { day, time } = formatWhen(e.at);
  const win = e.result === "W";
  const [a, b] = e.score.split(":");
  const delta = e.eloChange;
  const who = e.best
    ? `${e.players.join(", ")}\nBest rating: ${e.best.name}, ${e.best.rating.toFixed(2)} (${e.best.kills} / ${e.best.deaths} / ${e.best.assists})`
    : e.players.join(", ");
  return (
    <Link
      href={`/match/${e.matchId}`}
      className={`${ROW} ${MATCH_NARROW} ${COLS} hover:bg-white/[0.03] ${win ? "border-l-[#2ecc71]" : "border-l-[#e74c3c]"}`}
    >
      <When at={e.at} />
      <span className="flex items-center font-semibold tabular-nums text-[#9a9a9a] [grid-area:score] @min-[44rem]:[grid-area:auto]">
        <span
          className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-[5px] text-[0.75rem] font-extrabold ${
            win ? "bg-[#2ecc71]/15 text-[#2ecc71]" : "bg-[#e74c3c]/15 text-[#e74c3c]"
          }`}
        >
          {win ? "W" : "L"}
        </span>
        {a ? (
          <>
            <span className={win ? "font-extrabold text-white" : ""}>{a}</span>
            <span className="mx-1">:</span>
            <span className={win ? "" : "font-extrabold text-white"}>{b}</span>
          </>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-2 justify-self-end [grid-area:elo] @min-[44rem]:justify-self-auto @min-[44rem]:[grid-area:auto]">
        <RankBadge
          rank={e.rank as RankTierLetter}
          size="sm"
          showGlow={false}
          className="hidden !h-[1.375rem] !w-[1.375rem] shrink-0 @min-[44rem]:block"
        />
        {e.elo != null ? (
          <span
            className="hidden text-[0.875rem] font-bold tabular-nums text-white @min-[44rem]:inline"
            title="The members' average Elo after the match"
          >
            {e.elo.toLocaleString()}
          </span>
        ) : null}
        <span
          className={`inline-flex items-center gap-0.5 text-[0.8125rem] font-bold tabular-nums ${
            delta > 0 ? "text-[#2ecc71]" : delta < 0 ? "text-[#e74c3c]" : "text-[#8a8a8a]"
          }`}
          title="The members' average Elo change"
        >
          {delta > 0 ? <ArrowUp className="h-3 w-3" strokeWidth={3} /> : delta < 0 ? <ArrowDown className="h-3 w-3" strokeWidth={3} /> : null}
          {Math.abs(delta)}
        </span>
      </span>
      <span className="justify-self-end [grid-area:rating] @min-[44rem]:justify-self-auto @min-[44rem]:[grid-area:auto]">
        {e.rating != null ? <RatingPill rating={e.rating} title={RATING_HINT} /> : <span className="text-[#6a6a6a]">—</span>}
      </span>
      <span className="hidden min-w-0 items-center gap-2 @min-[44rem]:flex" title={who}>
        <span className="inline-flex shrink-0">
          {e.players.map((p, i) => (
            <span key={p} className={`rounded-full shadow-[0_0_0_2px_#1c1c1c] ${i ? "-ml-1.5" : ""}`}>
              <PlayerAvatar name={p} src={avatarOf(p)} size={20} />
            </span>
          ))}
        </span>
        <span className="min-w-0 truncate text-[0.8125rem] text-[#8a8a8a]">
          <Names players={e.players} best={e.best?.name} />
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2.5 text-[0.875rem] text-[#e8e8e8] [grid-area:map] @min-[44rem]:[grid-area:auto]">
        <MapThumb map={e.map} className="h-[1.625rem] w-10" />
        <span className="truncate">{e.map}</span>
      </span>
      <span className="truncate text-[0.75rem] text-[#8a8a8a] [grid-area:meta] @min-[44rem]:hidden">
        {day} {time} · <Names players={e.players} best={e.best?.name} />
      </span>
    </Link>
  );
}

/** A join, the clan's creation or a cup, on the same columns as the matches. */
function NoteEventRow({ e }: { e: Exclude<ClanEventData, { kind: "match" }> }) {
  const { day, time } = formatWhen(e.at);
  let icon: React.ReactNode;
  let text: React.ReactNode;
  let href: string | null = null;
  if (e.kind === "join") {
    icon = <UserPlus className="h-3 w-3" />;
    text = (
      <>
        <b className="font-semibold text-white">{e.name}</b> joined the clan
      </>
    );
  } else if (e.kind === "created") {
    icon = <Flag className="h-3 w-3" />;
    text = (
      <>
        Clan created by <b className="font-semibold text-white">{e.name}</b>
      </>
    );
  } else {
    icon = <Trophy className="h-3 w-3" />;
    text = (
      <>
        <b className="font-semibold text-white">{e.name}</b> tournament created
        <span className="text-[#8a8a8a]">
          {" "}· {CUP_STATUS[e.status] ?? e.status}, {e.teams} of {e.size} teams
        </span>
      </>
    );
    href = `/tournaments/${e.cupId}`;
  }
  const body = (
    <>
      <When at={e.at} />
      <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-[#242424] text-[#8a8a8a]">{icon}</span>
      <span className="min-w-0 text-[0.875rem] text-[#d0d0d0] @min-[44rem]:col-[3/-1]">
        <span className="block truncate">{text}</span>
        <span className="block text-[0.75rem] text-[#8a8a8a] @min-[44rem]:hidden">
          {day} {time}
        </span>
      </span>
    </>
  );
  const cls = `${ROW} grid-cols-[1.25rem_minmax(0,1fr)] border-l-transparent ${COLS}`;
  return href ? (
    <Link href={href} className={`${cls} hover:bg-white/[0.03]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * Overview (§4.9): about and rules, recent activity on the left; top players,
 * staff and who's online on the right.
 */
export function OverviewTab({ onTab }: { onTab: (tab: ClanTab) => void }) {
  const { data, isOnline } = useClan();
  const club = data.club;
  const [showRules, setShowRules] = useState(false);
  const rules = rulesLines(club.rules);
  const top = club.members
    .filter((m) => m.placementDone && m.elo > 0)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 5);
  const staff = club.members.filter((m) => m.role !== "member");
  const online = club.members.filter((m) => isOnline({ name: m.playerName || m.username }));
  const roleOf = (id: string) => club.roles.find((r) => r.id === id);
  const avatars = new Map(club.members.map((m) => [(m.playerName || m.username).toLowerCase(), m.avatar]));
  const avatarOf = (name: string) => avatars.get(name.toLowerCase()) ?? null;
  const permsText = (id: string) => {
    if (id === "owner") return "All permissions";
    const r = roleOf(id);
    const parts = [r?.canInvite && "Invites", r?.canKick && "removals", r?.canPromote && "roles", r?.canEdit && "profile"].filter(Boolean);
    return parts.length ? parts.join(", ") : "No staff permissions";
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20.625rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <section className={PANEL}>
          <BoxHead title="About" />
          <div className="p-4 text-sm leading-relaxed text-[#bdbdbd]">
            {club.description || <span className="text-[#8a8a8a]">No description yet.</span>}
            <dl className="mt-4 grid grid-cols-[6.875rem_minmax(0,1fr)] gap-y-2 border-t border-white/[0.05] pt-3.5 text-[0.8125rem]">
              <dt className="text-[#8a8a8a]">Joining</dt>
              <dd className="text-[#ededed]">{club.private ? "Request to join, or an invite link" : "Open to everyone"}</dd>
              <dt className="text-[#8a8a8a]">Region</dt>
              <dd className="text-[#ededed]">{regionMeta(club.region).label}</dd>
              <dt className="text-[#8a8a8a]">Game</dt>
              <dd className="text-[#ededed]">Counter Blox, 5v5</dd>
              <dt className="text-[#8a8a8a]">Created</dt>
              <dd className="text-[#ededed]">
                {new Date(club.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} by {club.ownerName}
              </dd>
            </dl>
            {rules.length ? (
              <div className="mt-3.5 border-t border-white/[0.05] pt-3">
                <button
                  type="button"
                  onClick={() => setShowRules((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-[#bdbdbd] hover:text-white"
                  aria-expanded={showRules}
                >
                  {showRules ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Clan rules ({rules.length})
                </button>
                {showRules ? (
                  <ol className="mt-2.5 list-decimal space-y-1 pl-5 text-[0.8125rem] text-[#bdbdbd]">
                    {rules.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className={PANEL}>
          <BoxHead title="Recent activity">
            <span className="hidden sm:inline">Matches with 2+ members on one team, new members, cups</span>
          </BoxHead>
          {data.activity.length ? (
            <div className="@container">
              <ActivityHeader />
              <div className="divide-y divide-white/[0.05]">
                {data.activity.map((e, i) =>
                  e.kind === "match" ? (
                    <MatchEventRow key={`match-${e.matchId}-${i}`} e={e} avatarOf={avatarOf} />
                  ) : (
                    <NoteEventRow key={`${e.kind}-${e.at}-${i}`} e={e} />
                  )
                )}
              </div>
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-[#8a8a8a]">Nothing yet. Matches played together show here.</p>
          )}
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <section className={PANEL}>
          <BoxHead title="Top players">
            <button
              type="button"
              onClick={() => onTab("leaderboard")}
              className="inline-flex items-center gap-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[#bdbdbd] hover:text-white"
            >
              Leaderboard <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </BoxHead>
          {top.length ? (
            <div className="divide-y divide-white/[0.05]">
              {top.map((m, i) => {
                const name = m.playerName || m.username;
                return (
                  <div key={m.discordId} className="flex items-center gap-[0.6875rem] px-4 py-2.5">
                    <Medal n={i + 1} />
                    <PlayerAvatar name={name} src={m.avatar} size={30} online={isOnline({ name })} />
                    <span className="min-w-0 flex-1">
                      {m.playerName ? (
                        <Link href={profileHref(m.playerName)} className="block truncate font-semibold text-[#ededed] hover:text-white">
                          {name}
                        </Link>
                      ) : (
                        <b className="block truncate font-semibold text-[#ededed]">{name}</b>
                      )}
                      <small className="block truncate text-xs text-[#8a8a8a]">{m.together} matches together</small>
                    </span>
                    <RankBadge rank={m.rank as RankTierLetter} size="sm" showGlow={false} className="!h-5 !w-5" />
                    <span className="font-semibold tabular-nums text-[#ededed]">{m.elo.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-4 text-sm text-[#8a8a8a]">No ranked members yet.</p>
          )}
        </section>

        <section className={PANEL}>
          <BoxHead title="Staff" />
          <div className="divide-y divide-white/[0.05]">
            {staff.map((m) => {
              const name = m.playerName || m.username;
              return (
                <div key={m.discordId} className="flex items-center gap-[0.6875rem] px-4 py-2.5">
                  <PlayerAvatar name={name} src={m.avatar} size={30} online={isOnline({ name })} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-semibold text-[#ededed]">{name}</b>
                    <small className="block truncate text-xs text-[#8a8a8a]">{permsText(m.role)}</small>
                  </span>
                  <RoleChip roleId={m.role} name={roleOf(m.role)?.name ?? m.role} color={club.accentColor} />
                </div>
              );
            })}
          </div>
        </section>

        <section className={PANEL}>
          <BoxHead title="Online">
            {online.length} of {club.members.length}
          </BoxHead>
          <div className="flex flex-wrap gap-[0.4375rem] px-4 pb-3.5 pt-3">
            {online.length ? (
              online.map((m) => {
                const name = m.playerName || m.username;
                return (
                  <span
                    key={m.discordId}
                    className="inline-flex items-center gap-[0.4375rem] rounded-full border border-white/[0.05] bg-[#191919] py-[3px] pl-[3px] pr-2.5 text-[0.8125rem] text-[#ededed]"
                  >
                    <PlayerAvatar name={name} src={m.avatar} size={22} online />
                    {name}
                  </span>
                );
              })
            ) : (
              <span className="text-sm text-[#8a8a8a]">Nobody is online.</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
