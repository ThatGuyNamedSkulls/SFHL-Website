/**
 * Standings tab pieces (docs/LEAGUE_UI_PLAN.md step 4, ESEA-style): the stage
 * stepper, the stage outcome cards, the regular-season table with its
 * promotion/playoff/relegation zones, the playoff bracket and the final
 * results. Server-safe (no hooks); times go through <LocalTime> so they show
 * in the viewer's time zone.
 */
import Link from "next/link";
import { Check, ChevronsDown, ChevronsUp, Clock, Coins, Info, Minus, Trophy } from "lucide-react";
import { ClubMark } from "@/components/club-identity";
import { Flag } from "@/components/flag";
import { LocalTime } from "@/components/local-time";
import { MovePill } from "@/components/league-move-pill";
import { countryName, flagPath } from "@/lib/countries";
import type { LeagueView } from "@/lib/league";
import {
  PLAYOFF_LINE,
  downText,
  lowerFirst,
  ordinal,
  regularZone,
  stageNote,
  tiebrokenTeams,
  upText,
  type DivisionMoves,
  type Outcome,
  type Stage,
  type StageKey,
  type Zone,
} from "@/lib/league-standings";

export { MovePill, ordinal };
export type DivisionView = LeagueView["divisions"][number];
type MatchSummary = DivisionView["weeks"][number]["matches"][number];
type TeamBadge = MatchSummary["teamA"];
export type Countries = Record<string, string | null>;

const ZONE_BAR: Record<Exclude<Zone, null>, string> = {
  promotion: "bg-hl-green",
  playoffs: "bg-[#ff5500]",
  relegation: "bg-hl-red",
};

/** Match weeks run Monday–Sunday in UTC, so their dates are shown in UTC too. */
function utcDay(ts: number) {
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function done(m: { status: string }) {
  return m.status === "final" || m.status === "forfeit";
}

// --- shared bits -----------------------------------------------------------------------------

export function TeamCell({ team, mine, size = 28 }: { team: TeamBadge; mine?: boolean; size?: number }) {
  return (
    <Link href={`/teams/${team.id}`} className="group flex min-w-0 items-center gap-2.5">
      <ClubMark tag={team.tag} accentColor={team.accentColor} logoUrl={team.logoUrl} size={size} />
      <span className={`truncate text-sm font-bold group-hover:underline ${mine ? "text-[#ff5500]" : "text-white"}`}>
        {team.name}
      </span>
      {team.tag ? <span className="hidden shrink-0 text-[11px] text-white/45 sm:inline">[{team.tag}]</span> : null}
    </Link>
  );
}

export function CountryCell({ code }: { code: string | null | undefined }) {
  if (!code) return <span className="text-white/35">—</span>;
  return (
    <span className="inline-flex items-center gap-2" title={countryName(code)}>
      <Flag src={flagPath(code)} name={countryName(code)} className="h-3.5 w-5" />
      <span className="text-xs font-bold uppercase text-white/70">{code}</span>
    </span>
  );
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-black text-white">{children}</h2>
      {aside ? <div className="text-xs text-white/55">{aside}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.12] px-4 py-10 text-center text-sm text-white/55">
      {children}
    </div>
  );
}

// --- stage stepper ---------------------------------------------------------------------------

function StageIcon({ state }: { state: Stage["state"] }) {
  if (state === "done") {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#ff5500] text-white">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === "live") {
    return (
      <span className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[#ff5500]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff5500]" />
      </span>
    );
  }
  if (state === "none") {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/20 text-white/40">
        <Minus className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/25 text-white/55">
      <Clock className="h-3.5 w-3.5" />
    </span>
  );
}

export function StageStepper({
  stages,
  active,
  hrefFor,
}: {
  stages: Stage[];
  active: StageKey;
  hrefFor: (key: StageKey) => string;
}) {
  return (
    <ol className="flex w-full items-stretch overflow-x-auto rounded-xl border border-white/[0.08] bg-[#121212] lg:w-auto">
      {stages.map((s, i) => {
        const on = s.key === active;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-stretch lg:flex-none">
            {i > 0 ? <span aria-hidden className="my-3 w-px shrink-0 bg-white/[0.08]" /> : null}
            <Link
              href={hrefFor(s.key)}
              scroll={false}
              aria-current={on ? "step" : undefined}
              className={`flex min-w-0 flex-1 items-center gap-3 border-b-2 px-2.5 py-3 transition-colors sm:min-w-[150px] sm:px-4 ${
                on ? "border-[#ff5500] bg-white/[0.03]" : "border-transparent hover:bg-white/[0.03]"
              }`}
            >
              <span className="hidden sm:block">
                <StageIcon state={s.state} />
              </span>
              <span className="min-w-0">
                <span className={`block truncate text-xs font-black sm:text-sm ${on ? "text-white" : "text-white/80"}`}>
                  {s.label}
                </span>
                <span className="block truncate text-[11px] text-white/55">{stageNote(s)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

// --- stage outcomes (league v2) ----------------------------------------------------------------

const OUTCOME_TONE: Record<Outcome["tone"], { box: string; icon: string }> = {
  green: { box: "border-hl-green/30 bg-hl-green/[0.06]", icon: "bg-hl-green/15 text-hl-green" },
  red: { box: "border-hl-red/30 bg-hl-red/[0.06]", icon: "bg-hl-red/15 text-hl-red" },
  orange: { box: "border-[#ff5500]/30 bg-[#ff5500]/[0.06]", icon: "bg-[#ff5500]/15 text-[#ff5500]" },
  gold: { box: "border-hl-gold/25 bg-hl-gold/[0.05]", icon: "bg-hl-gold/15 text-hl-gold" },
  neutral: { box: "border-white/[0.1] bg-[#121212]", icon: "bg-white/[0.06] text-white/60" },
};

function OutcomeIcon({ kind }: { kind: Outcome["kind"] }) {
  const cls = "h-4 w-4";
  if (kind === "up") return <ChevronsUp className={cls} />;
  if (kind === "down") return <ChevronsDown className={cls} />;
  if (kind === "prize") return <Coins className={cls} />;
  if (kind === "info") return <Info className={cls} />;
  return <Trophy className={cls} />;
}

/** FACEIT-style "stage outcomes": what each place gets, above the stage's table or bracket. */
export function StageOutcomes({ outcomes }: { outcomes: Outcome[] }) {
  if (!outcomes.length) return null;
  return (
    <section aria-label="Stage outcomes" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {outcomes.map((o) => {
        const tone = OUTCOME_TONE[o.tone];
        return (
          <div key={o.kind} className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 ${tone.box}`}>
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone.icon}`}>
              <OutcomeIcon kind={o.kind} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-black leading-tight text-white">{o.title}</div>
              <div className="mt-0.5 text-xs font-bold text-white/70">{o.places}</div>
              {o.note ? <div className="mt-0.5 text-[11px] leading-snug text-white/50">{o.note}</div> : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

// --- regular season --------------------------------------------------------------------------

/** A full-width strip over a zone of the table ("PROMOTIONS", "RELEGATIONS"). */
function ZoneBand({ zone, moves, cols }: { zone: Exclude<Zone, null>; moves: DivisionMoves; cols: number }) {
  const [label, aside, cls] =
    zone === "promotion"
      ? [
          "Promotions",
          moves.up >= PLAYOFF_LINE
            ? `${upText(moves).short} · via the playoffs`
            : `${moves.up === 1 ? "Playoff champion" : `Top ${moves.up} after the playoffs`} · ${lowerFirst(upText(moves).short)}`,
          "bg-hl-green/[0.08] text-hl-green",
        ]
      : zone === "relegation"
        ? ["Relegations", downText(moves).short, "bg-hl-red/[0.08] text-hl-red"]
        : ["Playoffs", `Top ${PLAYOFF_LINE} · best of 3`, "bg-[#ff5500]/[0.07] text-[#ff5500]"];
  return (
    <tr className="border-t border-white/[0.06] first:border-t-0">
      <td colSpan={cols} className={`px-4 py-1.5 sm:px-5 ${cls}`}>
        <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.14em]">
          <span className="inline-flex items-center gap-1.5">
            {zone === "promotion" ? <ChevronsUp className="h-3.5 w-3.5" /> : zone === "relegation" ? <ChevronsDown className="h-3.5 w-3.5" /> : <Trophy className="h-3 w-3" />}
            {label}
          </span>
          <span className="truncate text-right font-bold normal-case tracking-normal opacity-80">{aside}</span>
        </div>
      </td>
    </tr>
  );
}

export function RegularTable({
  div,
  countries,
  myTeamIds,
  moves,
}: {
  div: DivisionView;
  countries: Countries;
  myTeamIds: string[];
  moves: DivisionMoves;
}) {
  const tied = tiebrokenTeams(div.standings);
  const n = div.standings.length;
  const zones = div.standings.map((_, i) => regularZone(i, n, moves));
  const th = "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50";
  return (
    <section>
      <SectionTitle aside={`${div.standings.length} teams · ${div.format === "swiss" ? "Swiss · " : ""}win = 3 pts`}>
        Regular season
      </SectionTitle>
      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#121212]">
        <table className="w-full text-sm sm:min-w-[640px]">
          <thead>
            <tr className="border-b border-white/[0.08] text-left">
              <th className={`${th} w-10 pl-4 sm:w-12 sm:pl-5`}>#</th>
              <th className={th}>Team</th>
              <th className={`${th} hidden w-28 sm:table-cell`}>Country</th>
              <th className={`${th} hidden w-20 text-center sm:table-cell`}>Matches</th>
              <th className={`${th} w-11 text-center sm:w-16`}>Won</th>
              <th className={`${th} w-11 text-center sm:w-16`}>Lost</th>
              <th className={`${th} hidden w-16 text-center sm:table-cell`}>+/-</th>
              <th className={`${th} w-12 pr-4 text-right sm:w-20 sm:pr-5`}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {div.standings.map((row, i) => {
              const mine = myTeamIds.includes(row.teamId);
              const zone = zones[i];
              const band = zone && zone !== zones[i - 1] ? <ZoneBand key={`band-${zone}`} zone={zone} moves={moves} cols={8} /> : null;
              return [
                band,
                <tr
                  key={row.teamId}
                  className={`border-t border-white/[0.05] first:border-t-0 ${mine ? "bg-[#ff5500]/[0.07]" : "hover:bg-white/[0.02]"}`}
                >
                  <td className="relative py-2.5 pl-5 pr-3">
                    <span
                      aria-hidden
                      className={`absolute inset-y-1 left-0 w-[3px] rounded-r ${zone ? ZONE_BAR[zone] : "bg-white/10"}`}
                    />
                    <span className={`font-black tabular-nums ${zone && zone !== "relegation" ? "text-white" : "text-white/55"}`}>{i + 1}</span>
                  </td>
                  <td className="w-full max-w-0 px-2 py-2.5 sm:w-auto sm:max-w-none sm:px-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <TeamCell team={row.team} mine={mine} />
                      {tied.has(row.teamId) ? (
                        <span
                          title="Level on points: ordered by head-to-head, then round difference, then rounds won."
                          className="shrink-0 cursor-help rounded border border-white/15 px-1 text-[9px] font-black leading-[14px] text-white/60"
                        >
                          TB
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="hidden px-3 py-2.5 sm:table-cell">
                    <CountryCell code={countries[row.teamId]} />
                  </td>
                  <td className="hidden px-3 py-2.5 text-center tabular-nums sm:table-cell text-white/80">{row.played}</td>
                  <td className="px-1 py-2.5 text-center sm:px-3 tabular-nums text-white/80">{row.won}</td>
                  <td className="px-1 py-2.5 text-center sm:px-3 tabular-nums text-white/80">{row.lost}</td>
                  <td
                    className={`hidden px-3 py-2.5 text-center tabular-nums sm:table-cell ${
                      row.rd > 0 ? "text-hl-green" : row.rd < 0 ? "text-hl-red" : "text-white/60"
                    }`}
                  >
                    {row.rd > 0 ? `+${row.rd}` : row.rd}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right sm:pl-3 sm:pr-5 font-black tabular-nums text-white">{row.points}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-white/55">
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded border border-white/15 px-1 text-[9px] font-black leading-[14px] text-white/60">TB</span>
          {div.format === "swiss"
            ? "Placed by tiebreak (opponents' points → round difference → rounds won)"
            : "Placed by tiebreak (head-to-head → round difference → rounds won)"}
        </span>
      </div>
    </section>
  );
}

function ScheduleLine({ m }: { m: MatchSummary }) {
  const over = done(m);
  const aWon = over && m.winner === m.teamA.id;
  const bWon = over && m.winner === m.teamB.id;
  let middle: React.ReactNode;
  if (m.status === "forfeit") middle = aWon ? "W – FF" : "FF – W";
  else if (over) middle = `${m.scoreA ?? 0} – ${m.scoreB ?? 0}`;
  else middle = "vs";
  let sub: React.ReactNode = `BO${m.bo}`;
  if (m.status === "live") sub = <span className="font-bold text-[#ff5500]">Live</span>;
  else if (m.status === "reported" || m.status === "disputed") sub = "Result pending";
  else if (!over && m.scheduledAt) sub = <LocalTime ts={m.scheduledAt} />;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] items-center gap-2 rounded-lg border px-3 py-2 ${
        m.mine ? "border-[#ff5500]/35 bg-[#ff5500]/[0.06]" : "border-white/[0.06] bg-[#181818]"
      }`}
    >
      <div className={`flex justify-end ${bWon ? "opacity-50" : ""}`}>
        <TeamCell team={m.teamA} size={22} />
      </div>
      <Link href={`/league/match/${m.id}`} className="rounded-md py-0.5 text-center hover:bg-white/[0.05]" title="Match page">
        <div className={`text-sm font-black tabular-nums ${over ? "text-white" : "text-white/55"}`}>{middle}</div>
        <div className="text-[10px] text-white/50">{sub}</div>
      </Link>
      <div className={aWon ? "opacity-50" : ""}>
        <TeamCell team={m.teamB} size={22} />
      </div>
    </div>
  );
}

export function RegularSchedule({ div }: { div: DivisionView }) {
  const weeks = div.weeks
    .map((w) => ({ ...w, matches: w.matches.filter((m) => !m.round), byes: div.byes.filter((b) => b.week === w.week) }))
    .filter((w) => w.matches.length || w.byes.length);
  return (
    <section>
      <SectionTitle>Matches</SectionTitle>
      {weeks.length === 0 ? (
        <Empty>The schedule is published when Match Staff start the season.</Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {weeks.map((w) => (
            <div key={w.week} className="rounded-xl border border-white/[0.08] bg-[#121212] p-4">
              <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wide text-white">
                  Week {w.week}
                  {w.start && w.end ? (
                    <span className="ml-2 font-semibold normal-case tracking-normal text-white/50">
                      {utcDay(w.start)} – {utcDay(w.end)}
                    </span>
                  ) : null}
                </span>
                {w.defaultSlot ? (
                  <span className="text-[10px] text-white/45">
                    No agreed time → <LocalTime ts={w.defaultSlot} />
                  </span>
                ) : null}
              </div>
              <div className="space-y-1.5">
                {w.matches.map((m) => (
                  <ScheduleLine key={m.id} m={m} />
                ))}
                {w.byes.map((b) => (
                  <div
                    key={b.team.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-white/[0.1] px-3 py-2"
                  >
                    <TeamCell team={b.team} size={22} />
                    <span className="shrink-0 text-[11px] font-bold text-white/50">Bye · counts as a win</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --- playoffs --------------------------------------------------------------------------------

type Slot = { team: TeamBadge | null; seed: number | null; placeholder: string };

function BracketCard({
  title,
  match,
  slots,
  seeds,
  myTeamIds,
}: {
  title: string;
  match: MatchSummary | null;
  /** Shown when the match doesn't exist yet. */
  slots: [Slot, Slot];
  seeds: Map<string, number>;
  myTeamIds: string[];
}) {
  const over = match ? done(match) : false;
  const rows: (Slot & { score: string | null; won: boolean; lost: boolean })[] = match
    ? ([
        [match.teamA, match.scoreA],
        [match.teamB, match.scoreB],
      ] as const).map(([team, score]) => {
        const won = over && match.winner === team.id;
        return {
          team,
          seed: seeds.get(team.id) ?? null,
          placeholder: "",
          score: match.status === "forfeit" ? (won ? "W" : "FF") : over ? String(score ?? 0) : null,
          won,
          lost: over && !won,
        };
      })
    : slots.map((s) => ({ ...s, score: null, won: false, lost: false }));

  let footer: React.ReactNode = "Waiting for teams";
  if (match) {
    if (match.status === "live") footer = <span className="font-bold text-[#ff5500]">Live now</span>;
    else if (match.status === "reported" || match.status === "disputed") footer = "Result pending";
    else if (over) footer = "Finished";
    else if (match.scheduledAt) footer = <LocalTime ts={match.scheduledAt} />;
    else footer = "Time not agreed yet";
  }

  const body = (
    <>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">
        <span>{title}</span>
        <span>BO{match?.bo ?? 3}</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 px-3 py-2 ${i === 0 ? "border-b border-white/[0.04]" : ""} ${
            r.won ? "bg-[#ff5500]/[0.08]" : ""
          } ${r.lost ? "opacity-50" : ""}`}
        >
          <span className="w-5 shrink-0 text-center text-[11px] font-bold tabular-nums text-white/45">{r.seed ?? ""}</span>
          {r.team ? (
            <>
              <ClubMark tag={r.team.tag} accentColor={r.team.accentColor} logoUrl={r.team.logoUrl} size={22} />
              <span
                className={`min-w-0 flex-1 truncate text-sm font-bold ${
                  myTeamIds.includes(r.team.id) ? "text-[#ff5500]" : "text-white"
                }`}
              >
                {r.team.name}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs italic text-white/45">{r.placeholder}</span>
          )}
          <span className={`w-7 shrink-0 text-right text-sm font-black tabular-nums ${r.won ? "text-[#ff5500]" : "text-white/80"}`}>
            {r.score ?? ""}
          </span>
        </div>
      ))}
      <div className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-white/50">{footer}</div>
    </>
  );
  const cls = `block w-[260px] shrink-0 overflow-hidden rounded-lg border bg-[#181818] ${
    match?.mine ? "border-[#ff5500]/45" : "border-white/[0.1]"
  }`;
  return match ? (
    <Link href={`/league/match/${match.id}`} className={`${cls} transition-colors hover:border-white/30`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** The bracket's joining lines: two feeds on the left, one out on the right. */
function Connector() {
  return (
    <div aria-hidden className="relative">
      <span className="absolute left-0 top-1/4 h-1/2 w-1/2 rounded-r border-y border-r border-white/20" />
      <span className="absolute left-1/2 right-0 top-1/2 border-t border-white/20" />
    </div>
  );
}

function RoundHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-3 w-[260px]">
      <div className="text-sm font-black text-white">{title}</div>
      <div className="text-[11px] text-white/50">{sub}</div>
    </div>
  );
}

export function PlayoffBracket({
  div,
  state,
  myTeamIds,
}: {
  div: DivisionView;
  state: Stage["state"];
  myTeamIds: string[];
}) {
  if (state === "none") {
    return <Empty>This division had no playoffs.</Empty>;
  }
  const seeds = new Map(div.standings.map((r, i) => [r.teamId, i + 1]));
  const p = div.playoffs ?? { semi1: null, semi2: null, final: null, third: null };
  const seedSlot = (n: number): Slot => ({ team: null, seed: n, placeholder: `${ordinal(n)} of the regular season` });
  const from = (label: string): Slot => ({ team: null, seed: null, placeholder: label });

  return (
    <section>
      <SectionTitle aside={`Top ${PLAYOFF_LINE} · best of 3 · 1st v 4th, 2nd v 3rd`}>Playoffs</SectionTitle>
      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#121212] p-5">
        {/* Row 1: round headers. Row 2: cards; each semi sits in an equal half, so the
            connector's 25% / 75% marks meet their middles exactly. */}
        <div className="grid w-max grid-cols-[260px_40px_260px_81px_260px] grid-rows-[auto_1fr]">
          <RoundHeader title="Semi-finals" sub="2 matches · Best of 3" />
          <span />
          <RoundHeader title="Final" sub="1 match · Best of 3" />
          <span />
          <RoundHeader title="Third place" sub="1 match · Best of 3" />

          <div className="flex flex-col">
            <div className="flex flex-1 items-center py-3">
              <BracketCard title="Semi-final 1" match={p.semi1} slots={[seedSlot(1), seedSlot(4)]} seeds={seeds} myTeamIds={myTeamIds} />
            </div>
            <div className="flex flex-1 items-center py-3">
              <BracketCard title="Semi-final 2" match={p.semi2} slots={[seedSlot(2), seedSlot(3)]} seeds={seeds} myTeamIds={myTeamIds} />
            </div>
          </div>
          <Connector />
          <div className="flex items-center">
            <BracketCard
              title="Final"
              match={p.final}
              slots={[from("Winner of Semi-final 1"), from("Winner of Semi-final 2")]}
              seeds={seeds}
              myTeamIds={myTeamIds}
            />
          </div>
          <div aria-hidden className="mx-10 border-l border-white/[0.06]" />
          <div className="flex items-center">
            <BracketCard
              title="Third place"
              match={p.third}
              slots={[from("Loser of Semi-final 1"), from("Loser of Semi-final 2")]}
              seeds={seeds}
              myTeamIds={myTeamIds}
            />
          </div>
        </div>
      </div>
      {!div.playoffs ? (
        <p className="mt-2.5 text-[11px] text-white/55">
          The bracket fills in when Match Staff start the playoffs after the regular season.
        </p>
      ) : null}
    </section>
  );
}

// --- final results ---------------------------------------------------------------------------

const PODIUM = ["#f5c542", "#c9d1d9", "#d08a4a"];

export function FinalResults({
  div,
  countries,
  myTeamIds,
}: {
  div: DivisionView;
  countries: Countries;
  myTeamIds: string[];
}) {
  if (!div.places.length) {
    return <Empty>Final places and prizes appear here when Match Staff end the season.</Empty>;
  }
  const top = div.places.filter((p) => p.place <= 3);
  const groups = [
    { title: "Playoffs", sub: `1st–${ordinal(PLAYOFF_LINE)}`, rows: div.places.filter((p) => p.place <= PLAYOFF_LINE) },
    { title: "Regular season", sub: `${ordinal(PLAYOFF_LINE + 1)} and below`, rows: div.places.filter((p) => p.place > PLAYOFF_LINE) },
  ].filter((g) => g.rows.length);
  const th = "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50";

  return (
    <section className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {top.map((p) => (
          <div
            key={p.team.id}
            className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#121212] px-4 py-4"
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: PODIUM[p.place - 1] }} />
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: PODIUM[p.place - 1] }}>
              <Trophy className="h-3.5 w-3.5" /> {p.place === 1 ? "Champion" : `${ordinal(p.place)} place`}
            </div>
            <TeamCell team={p.team} mine={myTeamIds.includes(p.team.id)} size={32} />
            <div className="mt-2 inline-flex items-center gap-1 text-xs text-white/65">
              <Coins className="h-3.5 w-3.5 text-hl-gold" />
              {p.prize ? `${p.prize.toLocaleString()} HL Coins per player` : "No prize"}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#121212]">
        <table className="w-full text-sm sm:min-w-[560px]">
          <thead>
            <tr className="border-b border-white/[0.08] text-left">
              <th className={`${th} w-16 pl-5`}>Place</th>
              <th className={th}>Team</th>
              <th className={`${th} hidden w-28 sm:table-cell`}>Country</th>
              <th className={`${th} pr-5 text-right`}>Reward</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.title}>
              <tr className="border-t border-white/[0.08] bg-white/[0.02]">
                <td colSpan={4} className="px-5 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-white/70">
                  {g.title} <span className="ml-1 font-semibold normal-case tracking-normal text-white/45">{g.sub}</span>
                </td>
              </tr>
              {g.rows.map((p) => {
                const mine = myTeamIds.includes(p.team.id);
                return (
                  <tr key={p.team.id} className={`border-t border-white/[0.05] ${mine ? "bg-[#ff5500]/[0.07]" : ""}`}>
                    <td className="relative py-2.5 pl-5 pr-3 font-black tabular-nums" style={{ color: PODIUM[p.place - 1] ?? "rgba(255,255,255,.6)" }}>
                      {p.movement ? (
                        <span
                          aria-hidden
                          className={`absolute inset-y-1 left-0 w-[3px] rounded-r ${p.movement === "up" ? "bg-hl-green" : "bg-hl-red"}`}
                        />
                      ) : null}
                      {ordinal(p.place)}
                    </td>
                    <td className="px-3 py-2.5">
                      <TeamCell team={p.team} mine={mine} />
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <CountryCell code={countries[p.team.id]} />
                    </td>
                    <td className="py-2.5 pl-3 pr-5 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                        {p.movement ? <MovePill movement={p.movement} to={p.movedTo ?? ""} /> : null}
                        {p.prize ? (
                          <span className="inline-flex items-center gap-1 font-bold text-hl-gold">
                            <Coins className="h-3.5 w-3.5" /> {p.prize.toLocaleString()}
                          </span>
                        ) : !p.movement ? (
                          <span className="text-white/35">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
