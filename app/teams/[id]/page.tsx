import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, CalendarDays, Crown, Lock, Swords, Trophy } from "lucide-react";
import { ClubMark } from "@/components/club-identity";
import { Flag } from "@/components/flag";
import { TeamCell } from "@/components/league-standings";
import { PlayerCard } from "@/components/player-card";
import { RankBadge } from "@/components/rank-badge";
import { TeamLeague } from "@/components/team-league";
import { TeamMapPrefs } from "@/components/team-map-prefs";
import { TeamPerformanceChart } from "@/components/team-performance-chart";
import { TeamHeaderActions, TeamSettings } from "@/components/team-settings";
import { getSession } from "@/lib/auth";
import { countryName, flagPath } from "@/lib/countries";
import { isMatchStaff } from "@/lib/discord-party-voice";
import { teamAccessMap, type TeamLeagueSeason } from "@/lib/league";
import { ordinal } from "@/lib/league-standings";
import { regionMeta } from "@/lib/regions";
import { teamPageData, type MemberCard } from "@/lib/team-page";
import { ROLE_LIMITS, slotCounts } from "@/lib/team-roster";
import type { TeamMatch } from "@/lib/team-stats";

export const dynamic = "force-dynamic";

type Tab = "overview" | "stats" | "league" | "settings";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "stats", label: "Stats" },
  { key: "league", label: "League" },
  { key: "settings", label: "Settings" },
];
const ROUND: Record<string, string> = { semi1: "Semi-final", semi2: "Semi-final", final: "Final", third: "Third place" };

function day(ts: number | null) {
  return ts ? new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
}

function Panel({ title, aside, children, className = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-white/[0.08] bg-[#121212] p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-black text-white">{title}</h2>
        {aside ? <div className="text-xs text-white/55">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Form({ results }: { results: ("W" | "L")[] }) {
  if (!results.length) return <span className="text-xs text-white/45">No results yet</span>;
  return (
    <span className="flex gap-1" aria-label={`Recent results: ${results.join(" ")}`}>
      {results.map((r, i) => (
        <span
          key={i}
          className={`grid h-6 w-6 place-items-center rounded text-[11px] font-black ${r === "W" ? "bg-hl-green/15 text-hl-green" : "bg-hl-red/15 text-hl-red"}`}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#121212] px-4 py-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">{label}</div>
      <div className="mt-1.5 text-xl font-black text-white">{children}</div>
    </div>
  );
}

/** A bench / coach row: avatar in its rank ring, name, flag, rank + Elo. */
function MemberRow({ m }: { m: MemberCard }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full p-[2px]"
        style={{ background: `conic-gradient(${m.ringColor} ${Math.round(m.progress * 360)}deg, rgba(255,255,255,0.12) 0deg)` }}
      >
        <span className="grid h-full w-full place-items-center overflow-hidden rounded-full border-2 border-[#121212] bg-[#222] text-[10px] font-black text-white/70">
          {m.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- Roblox/Discord avatar CDNs
            <img src={m.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            m.name.slice(0, 2).toUpperCase()
          )}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {m.playerName ? (
            <Link href={`/profile?player=${encodeURIComponent(m.playerName)}`} className="truncate text-sm font-bold text-white hover:underline">
              {m.name}
            </Link>
          ) : (
            <span className="truncate text-sm font-bold text-white">{m.name}</span>
          )}
          {m.verified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-hl-green" aria-label="Linked HyperLeague player" /> : null}
          {m.country ? <Flag src={flagPath(m.country)} name={countryName(m.country)} className="h-3 w-4 shrink-0" /> : null}
        </span>
        <span className="text-[11px] text-white/50">{m.coach ? "Coach" : "Substitute"}</span>
      </span>
      <span className="flex items-center gap-2">
        <RankBadge rank={m.rank} size="sm" showGlow={false} className="!h-6 !w-6" />
        <span className="w-14 text-right text-xs font-bold tabular-nums text-white/75">
          {m.elo !== null ? m.elo.toLocaleString("en-US") : "—"}
        </span>
      </span>
    </li>
  );
}

function MatchRows({ matches }: { matches: TeamMatch[] }) {
  if (!matches.length) return <p className="py-6 text-center text-sm text-white/50">No league matches yet.</p>;
  const th = "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm md:min-w-[720px]">
        <thead>
          <tr className="border-b border-white/[0.08] text-left">
            <th className={`${th} hidden pl-0 sm:table-cell`}>Date</th>
            <th className={`${th} hidden md:table-cell`}>Competition</th>
            <th className={`${th} pl-0 sm:pl-3`}>Opponent</th>
            <th className={`${th} text-center`}>Result</th>
            <th className={`${th} text-center`}>Score</th>
            <th className={`${th} hidden pr-0 lg:table-cell`}>Map</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => (
            <tr key={m.id} className="border-t border-white/[0.05] first:border-t-0 hover:bg-white/[0.02]">
              <td className="hidden whitespace-nowrap py-2.5 pr-3 text-xs text-white/65 sm:table-cell">{day(m.date)}</td>
              <td className="hidden px-3 py-2.5 md:table-cell">
                <Link href={`/league/match/${m.id}`} className="block text-xs font-bold text-white hover:text-[#ff5500]">
                  {m.seasonName}
                  <span className="block font-semibold text-white/50">
                    {m.division ?? "League"} · {m.round ? ROUND[m.round] ?? m.round : "Regular season"}
                  </span>
                </Link>
              </td>
              <td className="max-w-0 py-2.5 pr-2 sm:px-3 md:max-w-none">
                <TeamCell team={m.opponent} size={24} />
              </td>
              <td className="px-2 py-2.5 text-center">
                {m.result ? (
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-[11px] font-black ${
                      m.result === "W" ? "bg-hl-green/15 text-hl-green" : "bg-hl-red/15 text-hl-red"
                    }`}
                  >
                    {m.result === "W" ? "Win" : "Loss"}
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-white/45">Upcoming</span>
                )}
              </td>
              <td className="px-2 py-2.5 text-center tabular-nums">
                <Link href={`/league/match/${m.id}`} className="font-bold text-white hover:text-[#ff5500]" aria-label={`Match page vs ${m.opponent.name}`}>
                  {m.forfeit ? (m.result === "W" ? "W – FF" : "FF – W") : m.scoreFor !== null && m.result ? `${m.scoreFor} – ${m.scoreAgainst}` : "vs"}
                </Link>
              </td>
              <td className="hidden py-2.5 pl-3 text-xs text-white/65 lg:table-cell">{m.maps.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stageOf(s: TeamLeagueSeason, matches: TeamMatch[]): string {
  if (!s.placed) return s.seasonStatus === "finished" ? "Not placed" : "Signed up";
  if (s.seasonStatus === "finished") return "Finished";
  if (s.seasonStatus === "playoffs") return matches.some((m) => m.stage === "playoff") ? "Playoffs" : "Regular season (done)";
  if (s.seasonStatus === "drawn") return "Drawn · starting soon";
  return "Regular season";
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const session = await getSession();
  const viewerId = session?.discordId ?? null;
  const [data, staff, access] = await Promise.all([
    teamPageData(id, viewerId),
    viewerId ? isMatchStaff(viewerId).catch(() => false) : Promise.resolve(false),
    teamAccessMap([id]).catch(() => new Map<string, string>()),
  ]);
  if (!data) notFound();
  const { team, roster, summary } = data;
  const captain = viewerId === team.captainId;
  const me = team.members.find((m) => m.discordId === viewerId);
  const canSettings = captain || staff;
  const asked = typeof q.tab === "string" ? (q.tab as Tab) : "overview";
  const tab: Tab = TABS.some((t) => t.key === asked) && (asked !== "settings" || canSettings) ? asked : "overview";
  const base = `/teams/${team.id}`;
  const statusCode = access.get(team.id) ?? null;
  // The latest season it played (placed in a division); a season it only signed up for comes second.
  const latest = data.seasons.find((s) => s.placed) ?? data.seasons[0] ?? null;

  const starters: (MemberCard | null)[] = [...roster.starters];
  while (starters.length < ROLE_LIMITS.starter) starters.push(null);

  return (
    <div className="hl-page space-y-5">
      <Link href="/teams" className="text-xs font-bold text-hl-gold hover:underline">
        ← All teams
      </Link>

      {/* Header: banner, logo, NAME (TAG) + flag, badges, actions, tabs. */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d0d0d]">
        <div className="relative h-36 overflow-hidden sm:h-52">
          {team.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- captain-provided banner URL
            <img src={team.bannerUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ background: `radial-gradient(circle at 75% 30%, ${team.accentColor}66, transparent 60%), linear-gradient(120deg, #1a1a1a, #0b0b0b 70%)` }}
            >
              <span
                className="absolute -bottom-6 right-4 select-none whitespace-nowrap text-[96px] font-black uppercase leading-none tracking-tight text-transparent sm:text-[150px]"
                style={{ WebkitTextStroke: "2px rgba(255,255,255,0.08)" }}
              >
                {team.tag || team.name}
              </span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0d0d0d] to-transparent" />
        </div>
        {/* Phones: logo, then name and badges, then the buttons (stacked, so the name isn't cut). */}
        <div className="relative -mt-12 flex flex-col gap-3 px-4 pb-4 sm:-mt-14 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4 sm:px-7">
          <div className="w-fit rounded-full border-4 border-[#0d0d0d] bg-[#0d0d0d]">
            <ClubMark tag={team.tag} accentColor={team.accentColor} logoUrl={team.logoUrl} size={96} className="!rounded-full" />
          </div>
          <div className="min-w-0 pb-1 sm:flex-1">
            <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xl font-black text-white sm:text-3xl">
              <span className="min-w-0 break-words">{team.name}</span>
              <span className="text-white/45">({team.tag})</span>
              {data.country ? <Flag src={flagPath(data.country)} name={countryName(data.country)} className="h-4 w-6" /> : null}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md border border-[#ff5500]/40 bg-[#ff5500]/10 px-2 py-0.5 text-[11px] font-black text-[#ff8a4d]">
                <Swords className="h-3 w-3" /> HyperLeague
              </span>
              <span className="rounded-md border border-white/15 px-2 py-0.5 text-[11px] font-bold text-white/75">{regionMeta(team.region).label}</span>
              {data.status ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-0.5 text-[11px] font-bold text-white/75">
                  {data.status.bySkill ? null : <Lock className="h-3 w-3 text-[#ff5500]" />}
                  {data.status.name}
                  {data.status.bySkill ? " (by skill)" : " status"}
                </span>
              ) : null}
              {data.titles.length ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-hl-gold/30 px-2 py-0.5 text-[11px] font-bold text-hl-gold">
                  <Trophy className="h-3 w-3" /> {data.titles.length} title{data.titles.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          </div>
          <TeamHeaderActions teamId={team.id} invited={me?.status === "invited"} member={me?.status === "accepted"} captain={captain} />
        </div>
        <nav aria-label="Team" className="flex gap-6 overflow-x-auto border-t border-white/[0.06] px-4 sm:px-7">
          {TABS.filter((t) => t.key !== "settings" || canSettings).map((t) => {
            const on = t.key === tab;
            return (
              <Link
                key={t.key}
                href={t.key === "overview" ? base : `${base}?tab=${t.key}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 py-3 text-sm font-black uppercase tracking-wide ${
                  on ? "border-[#ff5500] text-white" : "border-transparent text-white/55 hover:text-white"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </section>

      {tab === "overview" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <Panel title="Game">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2.5">
                <span className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#ff5500]/15 text-[#ff5500]">
                    <Swords className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-black text-white">HyperLeague · Team League</span>
                    <span className="block text-[11px] text-white/55">
                      {summary.played ? `${summary.won}W – ${summary.played - summary.won}L · ${summary.winRate}% win rate` : "No league matches yet"}
                    </span>
                  </span>
                </span>
                <Form results={summary.recent} />
              </div>
            </Panel>

            <Panel title="Team members" aside={`${roster.starters.length + roster.subs.length + (roster.coach ? 1 : 0)} of ${ROLE_LIMITS.starter + ROLE_LIMITS.sub + ROLE_LIMITS.coach}`}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
                Main roster · {roster.starters.length}/{ROLE_LIMITS.starter}
              </div>
              <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2">
                {starters.map((c, i) =>
                  c?.playerName ? (
                    <Link key={i} href={`/profile?player=${encodeURIComponent(c.playerName)}`} aria-label={`${c.name}'s profile`}>
                      <PlayerCard card={c} size="md" highlight={c.me} />
                    </Link>
                  ) : (
                    <PlayerCard key={i} card={c} size="md" highlight={!!c?.me} />
                  )
                )}
              </div>
              <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
                    Substitutes · {roster.subs.length}/{ROLE_LIMITS.sub}
                  </div>
                  {roster.subs.length ? (
                    <ul className="divide-y divide-white/[0.05]">{roster.subs.map((m) => <MemberRow key={m.discordId} m={m} />)}</ul>
                  ) : (
                    <p className="py-2 text-xs text-white/45">No substitutes.</p>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">Coach · {roster.coach ? 1 : 0}/{ROLE_LIMITS.coach}</div>
                  {roster.coach ? <ul><MemberRow m={roster.coach} /></ul> : <p className="py-2 text-xs text-white/45">No coach.</p>}
                </div>
              </div>
            </Panel>
          </div>

          <div className="min-w-0 space-y-5">
            <Panel title="About">
              <p className="whitespace-pre-line text-sm leading-relaxed text-white/70">
                {team.description || (captain ? "Tell players about your team in Settings." : "This team hasn't written anything yet.")}
              </p>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/45">
                <Crown className="h-3 w-3 text-hl-gold" /> Captain: {team.captainName}
              </p>
            </Panel>

            <Panel title="League">
              {latest ? (
                <Link href={`${base}?tab=league`} className="group flex items-center gap-3">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-4 border-[#ff5500]/60 text-lg font-black text-[#ff5500]">
                    {latest.season.match(/\d+/)?.[0] ?? "HL"}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black uppercase text-white group-hover:underline">
                      {latest.finalPlace ? `${ordinal(latest.finalPlace)}${latest.teams ? ` of ${latest.teams}` : ""}` : stageOf(latest, data.matches.filter((m) => m.seasonId === latest.seasonId))}
                      <span className="text-white/35"> | </span>
                      {latest.won}W – {latest.lost}L
                    </span>
                    <span className="block truncate text-xs text-white/55">
                      HyperLeague {latest.season}
                      {latest.division ? ` · ${latest.division}` : ""}
                    </span>
                  </span>
                </Link>
              ) : (
                <p className="text-sm text-white/55">
                  Not in a league season yet.{" "}
                  <Link href="/league" className="font-bold text-[#ff5500] hover:underline">
                    See the League
                  </Link>
                </p>
              )}
            </Panel>

            <Panel title="Titles" aside={data.titles.length ? `${data.titles.length}` : undefined}>
              {data.titles.length ? (
                <ul className="space-y-2">
                  {data.titles.map((t) => (
                    <li key={t.id} className="flex items-start gap-2 text-sm font-bold text-white">
                      <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-hl-gold" />
                      <span>
                        {t.title}
                        <span className="block text-[11px] font-semibold text-white/45">{day(t.awardedAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-white/50">League champions get one automatically; Match Staff award titles for tournament wins.</p>
              )}
            </Panel>
          </div>
        </div>
      ) : tab === "stats" ? (
        <div className="space-y-5">
          <section>
            <h2 className="mb-3 text-base font-black text-white">Main statistics</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Total played">{summary.played}</Tile>
              <Tile label="Win rate">{summary.played ? `${summary.winRate}%` : "—"}</Tile>
              <Tile label="Longest win streak">{summary.longestStreak}</Tile>
              <Tile label="Recent results">
                <Form results={summary.recent} />
              </Tile>
            </div>
          </section>
          <Panel title="Game preferences" aside="Maps from league scoreboards">
            <TeamMapPrefs team={summary.maps} players={summary.playerMaps} />
          </Panel>
          <Panel title="Performance statistics" aside="Per league match with a scoreboard">
            <TeamPerformanceChart data={summary.performance} />
          </Panel>
          <Panel title="Match history" aside={`${data.matches.length} league match${data.matches.length === 1 ? "" : "es"}`}>
            <MatchRows matches={data.matches} />
          </Panel>
        </div>
      ) : tab === "league" ? (
        <LeagueTab data={data} q={q} base={base} regionLabel={regionMeta(team.region).label} />
      ) : (
        <TeamSettings
          team={{
            id: team.id,
            name: team.name,
            tag: team.tag,
            region: team.region,
            logoUrl: team.logoUrl,
            bannerUrl: team.bannerUrl ?? null,
            accentColor: team.accentColor,
            description: team.description ?? null,
          }}
          members={[...roster.starters, ...roster.subs, ...(roster.coach ? [roster.coach] : []), ...roster.invited]}
          captain={captain}
          staff={staff}
          statusCode={statusCode}
          slots={slotCounts(team.members)}
        />
      )}
    </div>
  );
}

function LeagueTab({
  data,
  q,
  base,
  regionLabel,
}: {
  data: Awaited<ReturnType<typeof teamPageData>> & object;
  q: Record<string, string | string[] | undefined>;
  base: string;
  regionLabel: string;
}) {
  const wanted = typeof q.season === "string" ? Number(q.season) : null;
  const season =
    data.seasons.find((s) => s.seasonId === wanted) ?? data.seasons.find((s) => s.placed) ?? data.seasons[0] ?? null;
  const matches = season ? data.matches.filter((m) => m.seasonId === season.seasonId) : [];
  return (
    <div className="space-y-5">
      <TeamLeague status={data.status} seasons={data.seasons} records={false} />
      <section className="rounded-xl border border-white/[0.08] bg-[#121212] p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-black text-white">Season records</h2>
          {season ? (
            <Link href={`/league/${season.seasonId}`} className="text-xs font-black uppercase tracking-wide text-[#ff5500] hover:text-white">
              Season page
            </Link>
          ) : null}
        </div>
        {season ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Season">
              {data.seasons.map((s) => {
                const on = s.seasonId === season.seasonId;
                return (
                  <Link
                    key={s.seasonId}
                    href={`${base}?tab=league&season=${s.seasonId}`}
                    scroll={false}
                    aria-current={on ? "true" : undefined}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-black ${
                      on ? "border-[#ff5500] bg-[#ff5500]/15 text-white" : "border-white/[0.12] text-white/65 hover:text-white"
                    }`}
                  >
                    {s.season}
                    {s.finalPlace === 1 ? <Trophy className="h-3 w-3 text-hl-gold" /> : null}
                  </Link>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Tile label="Region">{regionLabel}</Tile>
              <Tile label="Division">
                {season.division && season.divisionId ? (
                  <Link href={`/league/${season.seasonId}/standings?division=${season.divisionId}`} className="hover:text-[#ff5500]">
                    {season.division}
                  </Link>
                ) : (
                  season.division ?? "—"
                )}
              </Tile>
              <Tile label="Stage">{stageOf(season, matches)}</Tile>
              <Tile label="Score">
                <span className="text-hl-green">{season.won}W</span>
                <span className="text-white/35"> – </span>
                <span className="text-hl-red">{season.lost}L</span>
              </Tile>
              <Tile label="Placement">
                {season.finalPlace ? `${ordinal(season.finalPlace)}${season.teams ? ` of ${season.teams}` : ""}` : "—"}
              </Tile>
            </div>
            <div className="mt-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-black text-white">
                <CalendarDays className="h-4 w-4 text-white/55" /> Matches
              </h3>
              <MatchRows matches={matches} />
            </div>
          </>
        ) : (
          <p className="text-sm text-white/55">
            This team hasn&apos;t played a league season yet.{" "}
            <Link href="/league" className="font-bold text-[#ff5500] hover:underline">
              See the League
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
