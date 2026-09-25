import Link from "next/link";
import { notFound } from "next/navigation";
import { FindFilterBar, FindTip, MyRecruitingPanel, QuickPostButton } from "@/components/league-find";
import { PlayerPostCard, TeamPostCard } from "@/components/league-find-cards";
import { CountryCell, Empty, TeamCell } from "@/components/league-standings";
import { getSession } from "@/lib/auth";
import { UPCOMING_STATUSES, getSeason } from "@/lib/league";
import { listPlayerPosts, listTeamPosts, myRecruiting } from "@/lib/league-find";
import { parseFindFilters, playerPostMatches, teamPostMatches, type FindTab } from "@/lib/league-find-rules";
import { leagueTeams } from "@/lib/league-teams";

export const dynamic = "force-dynamic";

/**
 * Find Teammates (docs/LEAGUE_UI_PLAN.md step 7; FACEIT layout, LEAGUE_V2_PLAN
 * D2/D3), upcoming seasons only: Find team (recruiting teams, with their roster
 * cards) · Find player (free agents) · Registered, with division / language /
 * role / skill-level filters, plus the viewer's own recruiting.
 */
export default async function FindTeammatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ season: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { season: raw } = await params;
  const season = /^\d+$/.test(raw) ? await getSeason(Number(raw)) : null;
  if (!season) notFound();
  if (!UPCOMING_STATUSES.includes(season.status)) {
    return <Empty>Recruiting is closed — rosters for {season.name} are locked.</Empty>;
  }

  const filters = parseFindFilters(await searchParams);
  const session = await getSession();
  const viewerId = session?.discordId ?? null;
  const [teamPosts, playerPosts, registered] = [
    await listTeamPosts(season.id, viewerId),
    await listPlayerPosts(season.id, viewerId),
    (await leagueTeams(season.id, viewerId)).filter((t) => t.status !== "ineligible"),
  ];
  const mine = session
    ? await myRecruiting(
        season.id,
        {
          discordId: session.discordId,
          playerName: session.playerName ?? null,
          username: session.discordUsername || session.username,
          avatar: session.avatar ?? null,
        },
        { teams: teamPosts, players: playerPosts }
      )
    : null;

  const teams = teamPosts.filter((p) => teamPostMatches(p, filters));
  const players = playerPosts.filter((p) => playerPostMatches(p, filters));
  const base = `/league/${season.id}/find`;
  const tabHref = (tab: FindTab) => (tab === "teams" ? base : `${base}?tab=${tab}`);
  const tabs: { key: FindTab; label: string; count: number }[] = [
    { key: "teams", label: "Find team", count: teamPosts.length },
    { key: "players", label: "Find player", count: playerPosts.length },
    { key: "registered", label: "Registered", count: registered.length },
  ];

  return (
    <div className="space-y-6">
      {mine ? (
        <MyRecruitingPanel seasonId={season.id} data={mine} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#121212] px-4 py-3 text-sm text-white/70">
          Log in to post your team or yourself, apply to teams and message players.
          <Link href="/login" className="font-black uppercase tracking-wide text-[#ff5500] hover:text-white">
            Log in
          </Link>
        </div>
      )}

      <nav aria-label="Find Teammates" className="flex gap-6 border-b border-white/[0.08]">
        {tabs.map((t) => {
          const on = t.key === filters.tab;
          return (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-black ${
                on ? "border-[#ff5500] text-white" : "border-transparent text-white/60 hover:text-white"
              }`}
            >
              {t.label}
              <span className={`rounded px-1.5 text-[10px] ${on ? "bg-[#ff5500]/20 text-[#ff5500]" : "bg-white/10 text-white/60"}`}>
                {t.count}
              </span>
            </Link>
          );
        })}
      </nav>

      {filters.tab !== "registered" ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <FindFilterBar base={base} filters={filters} />
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/55">
                {filters.tab === "teams"
                  ? `${teams.length} team${teams.length === 1 ? "" : "s"} displayed`
                  : `${players.length} player${players.length === 1 ? "" : "s"} displayed`}
              </span>
              <QuickPostButton kind={filters.tab === "teams" ? "team" : "player"} seasonId={season.id} data={mine} />
            </div>
          </div>
          {filters.tab === "teams" ? (
            <FindTip id="teams">
              Teams have up to 5 main-roster players, 6 substitutes and 1 coach. Apply to a team: the captain gets a DM, and if
              they accept you get a team invite.
            </FindTip>
          ) : (
            <FindTip id="players">
              Post your profile so captains can find you. Messages reach you as a Discord DM with the sender&apos;s Discord name.
            </FindTip>
          )}
        </>
      ) : null}

      {filters.tab === "teams" ? (
        teams.length ? (
          <div className="space-y-3">
            {teams.map((p) => (
              <TeamPostCard key={p.id} post={p} seasonId={season.id} loggedIn={!!session} />
            ))}
          </div>
        ) : (
          <Empty>{teamPosts.length ? "No teams match these filters." : "No teams are recruiting yet. Captains: post yours above."}</Empty>
        )
      ) : filters.tab === "players" ? (
        players.length ? (
          <div className="space-y-3">
            {players.map((p) => (
              <PlayerPostCard key={p.id} post={p} seasonId={season.id} loggedIn={!!session} />
            ))}
          </div>
        ) : (
          <Empty>{playerPosts.length ? "No players match these filters." : "No players are looking for a team yet."}</Empty>
        )
      ) : registered.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {registered.map((t) => (
            <div
              key={t.team.id}
              className={`flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
                t.mine ? "border-[#ff5500]/40 bg-[#ff5500]/[0.06]" : "border-white/[0.08] bg-[#121212]"
              }`}
            >
              <div className="min-w-0">
                <TeamCell team={t.team} mine={t.mine} size={26} />
                <div className="mt-0.5 pl-9 text-[11px] text-white/50">
                  {t.access} · {t.players.length} players
                </div>
              </div>
              <CountryCell code={t.country} />
            </div>
          ))}
        </div>
      ) : (
        <Empty>No teams have signed up yet.</Empty>
      )}
    </div>
  );
}
