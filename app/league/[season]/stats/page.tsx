import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { ClubMark } from "@/components/club-identity";
import { Flag } from "@/components/flag";
import { LeagueDivisionPicker } from "@/components/league-division-select";
import { Empty } from "@/components/league-standings";
import { getSession } from "@/lib/auth";
import { countryName, flagPath } from "@/lib/countries";
import { getSeason } from "@/lib/league";
import { seasonStats, statsDivisions } from "@/lib/league-stats";
import { parseSort, sortTotals, type SortKey } from "@/lib/league-stats-rules";
import { conferenceGroups, filterPicker, parseDivisionFilter } from "@/lib/league-standings";

export const dynamic = "force-dynamic";

const COLUMNS: { key: SortKey; label: string; title: string; fmt?: (n: number) => string }[] = [
  { key: "matches", label: "Matches", title: "League matches with a scoreboard" },
  { key: "wins", label: "Wins", title: "Matches won" },
  { key: "maps", label: "Maps", title: "Maps played" },
  { key: "kills", label: "K", title: "Kills" },
  { key: "deaths", label: "D", title: "Deaths" },
  { key: "assists", label: "A", title: "Assists" },
  { key: "kd", label: "K/D", title: "Kills per death", fmt: (n) => n.toFixed(2) },
  { key: "hs", label: "HS%", title: "Headshot % (weighted by kills)", fmt: (n) => n.toFixed(1) },
  { key: "mvps", label: "MVP", title: "MVPs" },
  { key: "rounds", label: "Rounds", title: "Rounds played" },
  { key: "kr", label: "K/R", title: "Kills per round", fmt: (n) => n.toFixed(2) },
  { key: "avgScore", label: "Score", title: "Average score per map" },
];

/**
 * Stats (docs/LEAGUE_UI_PLAN.md step 9): per-player totals from the
 * scoreboards Match Staff saved, per division or conference; every column
 * sorts. ?division= (an id, a split division's code, or none = all) · ?sort= · ?dir=asc
 */
export default async function SeasonStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ season: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { season: raw } = await params;
  const season = /^\d+$/.test(raw) ? await getSeason(Number(raw)) : null;
  if (!season) notFound();
  const [q, divisions, session] = await Promise.all([searchParams, statsDivisions(season.id), getSession()]);
  const groups = conferenceGroups(divisions);
  const filter = parseDivisionFilter(q.division, groups);
  const sort = parseSort(q.sort);
  const asc = q.dir === "asc";
  const rows = sortTotals(await seasonStats(season.id, filter.ids), sort, asc);
  const matchCount = new Map(divisions.map((d) => [d.id, d.matches]));
  const counted = (ids: number[]) => {
    const n = ids.reduce((sum, id) => sum + (matchCount.get(id) ?? 0), 0);
    return ` · ${n} match${n === 1 ? "" : "es"}`;
  };
  const base = `/league/${season.id}/stats`;
  const href = (patch: { sort?: SortKey; asc?: boolean }) => {
    const p = new URLSearchParams();
    const s = patch.sort ?? sort;
    const a = patch.asc ?? asc;
    if (filter.value) p.set("division", filter.value);
    if (s !== "kills") p.set("sort", s);
    if (a) p.set("dir", "asc");
    return p.size ? `${base}?${p}` : base;
  };
  const th = "px-2.5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em]";

  return (
    <div className="space-y-5">
      {divisions.length > 1 ? (
        <LeagueDivisionPicker
          base={base}
          keep={{ sort: sort === "kills" ? null : sort, dir: asc ? "asc" : null }}
          picker={filterPicker(groups, filter, counted)}
        />
      ) : null}

      {rows.length === 0 ? (
        <Empty>
          No scoreboards yet. Match Staff add them on each league match page after the result is final
          {divisions.length ? "" : " (once the divisions are drawn)"}.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#121212]">
          <table className="w-full min-w-[1040px] text-sm">
            <thead>
              <tr className="border-b border-white/[0.08] text-white/50">
                <th className={`${th} hidden w-12 pl-5 text-left sm:table-cell`}>#</th>
                {/* Phones: the player stays put while the numbers scroll. */}
                <th className={`${th} sticky left-0 z-10 bg-[#121212] pl-4 text-left sm:static sm:pl-2.5`}>Player</th>
                <th className={`${th} hidden text-left md:table-cell`}>Team</th>
                {COLUMNS.map((c) => {
                  const on = c.key === sort;
                  return (
                    <th key={c.key} className={`${th} text-right last:pr-5`} title={c.title} aria-sort={on ? (asc ? "ascending" : "descending") : undefined}>
                      <Link
                        href={href({ sort: c.key, asc: on ? !asc : false })}
                        scroll={false}
                        className={`inline-flex items-center gap-0.5 hover:text-white ${on ? "text-[#ff5500]" : ""}`}
                      >
                        {c.label}
                        {on ? asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
                      </Link>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const me = session?.discordId === r.discordId;
                return (
                  <tr key={r.discordId} className={`border-t border-white/[0.05] first:border-t-0 ${me ? "bg-[#ff5500]/[0.07]" : "hover:bg-white/[0.02]"}`}>
                    <td className={`hidden py-2.5 pl-5 pr-2 font-black tabular-nums sm:table-cell ${i < 3 ? "text-[#ff5500]" : "text-white/50"}`}>{i + 1}</td>
                    <td className="sticky left-0 z-10 bg-[#121212] py-2.5 pl-4 pr-2.5 sm:static sm:bg-transparent sm:pl-2.5">
                      <Link href={`/profile?player=${encodeURIComponent(r.name)}`} className="inline-flex items-center gap-2 font-bold text-white hover:underline">
                        {r.country ? <Flag src={flagPath(r.country)} name={countryName(r.country)} className="h-3.5 w-5" /> : null}
                        {r.name}
                      </Link>
                      {/* Phones: the team is a small logo here instead of its own column. */}
                      <span className="ml-2 inline-block align-middle md:hidden" title={r.team.name}>
                        <ClubMark tag={r.team.tag} accentColor={r.team.accentColor} logoUrl={r.team.logoUrl} size={16} />
                      </span>
                    </td>
                    <td className="hidden px-2.5 py-2.5 md:table-cell">
                      <Link href={`/teams/${r.team.id}`} className="inline-flex max-w-[180px] items-center gap-2 text-xs font-bold text-white/75 hover:text-white">
                        <ClubMark tag={r.team.tag} accentColor={r.team.accentColor} logoUrl={r.team.logoUrl} size={20} />
                        <span className="truncate">{r.team.name}</span>
                      </Link>
                    </td>
                    {COLUMNS.map((c) => (
                      <td
                        key={c.key}
                        className={`px-2.5 py-2.5 text-right tabular-nums last:pr-5 ${c.key === sort ? "font-black text-white" : "text-white/75"}`}
                      >
                        {c.fmt ? c.fmt(r[c.key]) : r[c.key].toLocaleString()}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-white/45">
        From the scoreboards Match Staff enter for each league match. League stats never change ranked stats or Elo.
      </p>
    </div>
  );
}
