import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Info, Lock, Swords, Users } from "lucide-react";
import { CountryCell, TeamCell } from "@/components/league-standings";
import { LeagueTimeline } from "@/components/league-timeline";
import { LeagueUpcomingHero } from "@/components/league-upcoming-hero";
import { getSession } from "@/lib/auth";
import { findCount } from "@/lib/league-find";
import { leagueTeams, type LeagueTeamRow } from "@/lib/league-teams";
import {
  ACCESS_CODES,
  PRIZES,
  UPCOMING_STATUSES,
  getSeason,
  seasonDivisions,
  seasonEntries,
  seasonEventTimes,
  viewerNextMatch,
} from "@/lib/league";
import { seasonTimeline, timelineWindow } from "@/lib/league-timeline";

export const dynamic = "force-dynamic";

const DEFAULT_DESCRIPTION =
  "HyperLeague's team league is where organised teams play weekly official matches against teams of their level: " +
  "a six-week regular season inside your division, best-of-3 playoffs for the top 4, team titles and HL Coin prizes. " +
  "Pro, Advanced, Main, Intermediate and Entry are invite-only; every other team plays in the Open division of its skill. " +
  "League games never change your ranked Elo.";

const ROUND_LABEL: Record<string, string> = {
  semi1: "Semi-final",
  semi2: "Semi-final",
  final: "Final",
  third: "Third-place match",
};

function Information({
  notice,
  description,
  rulesHref,
}: {
  notice: string | null;
  description: string | null;
  rulesHref: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-black text-white">Information</h2>
      {notice ? (
        <div className="mb-3 flex items-start gap-3 rounded-xl border border-white/[0.08] bg-[#181818] px-4 py-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-white" />
          <div className="text-sm font-bold text-white">{notice}</div>
        </div>
      ) : null}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/75">{description || DEFAULT_DESCRIPTION}</p>
      <p className="mt-2 text-sm text-white/75">
        Rules and scoring are on the{" "}
        <Link href={rulesHref} className="font-bold text-[#ff5500] hover:underline">
          Rules
        </Link>{" "}
        tab. Questions? Ask Match Staff on Discord.
      </p>
    </section>
  );
}

/** A preview of the teams signed up so far (A–Z), with a link to the Teams tab. */
function SignedUpTeams({ seasonId, teams }: { seasonId: number; teams: LeagueTeamRow[] }) {
  const PREVIEW = 12;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black text-white">
          Signed up <span className="text-white/45">({teams.length})</span>
        </h2>
        {teams.length ? (
          <Link
            href={`/league/${seasonId}/teams`}
            className="text-xs font-black uppercase tracking-wide text-[#ff5500] hover:text-white"
          >
            View all
          </Link>
        ) : null}
      </div>
      {teams.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/[0.12] px-4 py-8 text-center text-sm text-white/55">
          No teams yet — be the first to join.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {teams.slice(0, PREVIEW).map((t) => (
            <div
              key={t.team.id}
              className={`flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
                t.mine ? "border-[#ff5500]/40 bg-[#ff5500]/[0.06]" : "border-white/[0.08] bg-[#121212]"
              }`}
            >
              <TeamCell team={t.team} mine={t.mine} size={26} />
              <CountryCell code={t.country} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function SeasonOverviewPage({ params }: { params: Promise<{ season: string }> }) {
  const { season: raw } = await params;
  const season = /^\d+$/.test(raw) ? await getSeason(Number(raw)) : null;
  if (!season) notFound();

  const all = seasonTimeline(season, await seasonEventTimes(season.id));
  const strip = timelineWindow(all);
  const info = (
    <Information
      notice={season.notice ?? null}
      description={season.description ?? null}
      rulesHref={`/league/${season.id}/rules`}
    />
  );

  const session = await getSession();

  // Upcoming season (plan step 6): the JOIN NOW hero replaces the layout's hero here.
  if (UPCOMING_STATUSES.includes(season.status)) {
    const teams = (await leagueTeams(season.id, session?.discordId ?? null)).filter((t) => t.status !== "ineligible");
    const mine = teams.find((t) => t.mine) ?? null;
    return (
      <div className="space-y-8">
        <LeagueUpcomingHero
          season={season}
          teams={teams.length}
          prizePerPlayer={PRIZES[0]}
          loggedIn={!!session}
          myTeam={mine ? { name: mine.team.name, players: mine.players, captain: mine.captain } : null}
          findCount={await findCount(season.id)}
        />
        <LeagueTimeline strip={strip} all={all} />
        <SignedUpTeams seasonId={season.id} teams={teams} />
        {info}
      </div>
    );
  }

  const next = session ? await viewerNextMatch(season.id, session.discordId) : null;
  const [divisions, entries] = [await seasonDivisions(season.id), await seasonEntries(season.id)];
  const base = `/league/${season.id}`;

  return (
    <div className="space-y-8">
      <LeagueTimeline strip={strip} all={all} />

      {next ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#ff5500]/40 bg-[#1a120d] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-[#ff5500]">
              Your next match · {next.round ? ROUND_LABEL[next.round] : `Week ${next.week}`}
              {next.division ? ` · ${next.division}` : ""}
            </div>
            <div className="mt-1 truncate text-lg font-black text-white">
              {next.mine} <span className="text-white/50">vs</span> {next.opponent}
            </div>
            <div className="text-xs text-white/60" suppressHydrationWarning>
              {next.scheduledAt
                ? new Date(next.scheduledAt).toLocaleString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : next.status === "proposed"
                  ? "A time was proposed — the captains need to agree"
                  : "No time agreed yet — captains, pick one on the match page"}
            </div>
          </div>
          <Link
            href={`/league/match/${next.id}`}
            className="find-match-btn inline-flex h-10 items-center gap-1 rounded-xl px-5 text-xs font-black header-caps text-hl-base"
          >
            <Swords className="h-4 w-4" /> Match page
          </Link>
        </section>
      ) : null}

      {divisions.length ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-black text-white">Divisions</h2>
            <Link href={`${base}/standings`} className="text-xs font-black uppercase tracking-wide text-[#ff5500] hover:text-white">
              Standings
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {divisions.map((d) => {
              const teams = entries.filter((e) => e.divisionId === d.id && e.status === "active").length;
              const inviteOnly = (d.code ?? "").split("+").some((c) => ACCESS_CODES.includes(c));
              return (
                <Link
                  key={d.id}
                  href={`${base}/standings?division=${d.id}`}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#121212] px-4 py-3 transition-colors hover:border-[#ff5500]/50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-white">{d.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/55">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" /> {teams} teams
                      </span>
                      <span className="inline-flex items-center gap-1">
                        {inviteOnly ? <Lock className="h-3 w-3" /> : null}
                        {inviteOnly ? "Invite-only" : "Open"}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/40 group-hover:text-[#ff5500]" />
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {info}
    </div>
  );
}
