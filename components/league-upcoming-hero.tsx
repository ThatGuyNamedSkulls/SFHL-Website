/**
 * Upcoming season hero (docs/LEAGUE_UI_PLAN.md step 6; centred like FACEIT,
 * docs/LEAGUE_V2_PLAN.md C5): the season emblem in the middle, facts in the top
 * corners, five player cards (your team's main roster, you in the middle), then
 * the headline, JOIN NOW + FIND TEAMMATES (count). Phones get the facts in a
 * grid under the buttons. Server-safe.
 */
import Link from "next/link";
import { Check, Coins, Users } from "lucide-react";
import { LeagueJoinButton } from "@/components/league-join";
import { PlayerCard } from "@/components/player-card";
import type { Season } from "@/lib/league";
import type { Lineup, LineupCard } from "@/lib/league-lineup";
import { STATUS_HEADLINE, seasonNumber } from "@/lib/league-shell";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">{label}</div>
      <div className="mt-0.5 text-sm font-black text-white">{children}</div>
    </div>
  );
}

function fmtDay(ts: number) {
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A lineup slot, fanned out: the outer cards tilt and drop a little (FACEIT-style card, D1). */
function FannedCard({ card, index }: { card: LineupCard | null; index: number }) {
  const tilt = [-8, -4, 0, 4, 8][index];
  const lift = [22, 8, 0, 8, 22][index];
  const middle = index === 2;
  return (
    <div
      className="-mx-2.5"
      style={{ transform: `translateY(${lift}px) rotate(${tilt}deg)`, zIndex: middle ? 3 : index === 1 || index === 3 ? 2 : 1 }}
    >
      <PlayerCard card={card} highlight={middle && !!card} />
    </div>
  );
}

/** Five fanned cards: your team's main roster, you in the middle (docs/LEAGUE_V2_PLAN.md C1). */
function PlayerCards({ lineup }: { lineup: Lineup | null }) {
  const slots = lineup?.cards ?? [null, null, null, null, null];
  return (
    <div className="relative flex h-[300px] items-end justify-center" aria-label={lineup ? `${lineup.team.name} lineup` : undefined}>
      {slots.map((card, i) => (
        <FannedCard key={i} card={card} index={i} />
      ))}
      {lineup ? (
        <div className="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap">
          <Link
            href={`/teams/${lineup.team.id}`}
            className="rounded-full border border-[#ff5500]/50 bg-[#1a120d] px-3 py-1 text-[11px] font-black uppercase tracking-wide text-[#ff5500] hover:bg-[#2a170c]"
          >
            {lineup.team.name}
          </Link>
          {!lineup.signedUp ? <span className="text-[10px] font-bold text-white/50">Not signed up yet</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function LeagueUpcomingHero({
  season,
  teams,
  prizePerPlayer,
  loggedIn,
  myTeam,
  lineup,
  findCount,
}: {
  season: Season;
  /** Teams signed up so far. */
  teams: number;
  prizePerPlayer: number;
  loggedIn: boolean;
  /** The viewer's signed-up team, if any. */
  myTeam: { name: string; captain: boolean } | null;
  /** The viewer's team (signed up or not) for the player cards. */
  lineup: Lineup | null;
  /** Open posts on the Find Teammates board. */
  findCount: number;
}) {
  const number = seasonNumber(season.name);
  const open = season.status === "signup";

  const left = [
    <Fact key="prize" label="Prize pool">
      <span className="inline-flex items-center gap-1">
        <Coins className="h-3.5 w-3.5 text-hl-gold" />
        {prizePerPlayer.toLocaleString()} / player
      </span>
    </Fact>,
    <Fact key="format" label="Format">
      BO1 · BO3 playoffs
    </Fact>,
    <Fact key="entry" label="Entry">
      Free
    </Fact>,
  ];
  const right = [
    <Fact key="teams" label="Teams">
      <Link href={`/league/${season.id}/teams`} className="hover:text-[#ff5500] hover:underline">
        {teams.toLocaleString()} signed up
      </Link>
    </Fact>,
    season.signupClose ? (
      <Fact key="close" label="Registration closes">
        {fmtDay(season.signupClose)}
      </Fact>
    ) : null,
    season.startDate ? (
      <Fact key="start" label="Season start">
        {fmtDay(season.startDate)}
      </Fact>
    ) : null,
  ];

  return (
    <section className="relative mb-6 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0d0d0d]">
      {season.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- staff-provided external banner
        <img src={season.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
      ) : (
        <div aria-hidden className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,rgba(255,85,0,0.26),transparent_58%),linear-gradient(180deg,#151515,#0b0b0b_70%)]" />
          <span
            className="absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-1/2 select-none whitespace-nowrap text-[190px] font-black uppercase leading-none tracking-tight text-transparent lg:text-[300px]"
            style={{ WebkitTextStroke: "2px rgba(255,255,255,0.05)" }}
          >
            {number ? `Season ${number}` : "League"}
          </span>
        </div>
      )}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#0d0d0d] via-[#0d0d0d]/85 to-transparent" />

      {/* Wide screens: the facts sit in the top corners, like FACEIT. */}
      <div className="absolute left-9 top-9 z-10 hidden space-y-4 lg:block">{left}</div>
      <div className="absolute right-9 top-9 z-10 hidden space-y-4 text-right lg:block">{right}</div>

      <div className="relative flex flex-col items-center px-5 pb-8 pt-7 text-center sm:px-9 sm:pb-10">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${
            open ? "border-[#ff5500]/50 bg-[#ff5500]/10 text-[#ff5500]" : "border-white/15 bg-white/[0.05] text-white/70"
          }`}
        >
          {open ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5500]" /> : null}
          {STATUS_HEADLINE[season.status]}
        </span>
        <span
          aria-hidden
          className="mt-4 grid h-[76px] w-[76px] place-items-center rounded-full border-[6px] border-[#ff5500]/70 bg-[#0d0d0d]/60 text-[34px] font-black leading-none text-[#ff5500] shadow-[0_0_40px_rgba(255,85,0,0.25)] sm:h-[92px] sm:w-[92px] sm:text-[42px]"
        >
          {number ?? "HL"}
        </span>

        {/* Phones get the same cards, scaled down (the negative margin takes back the space scaling leaves). */}
        <div className="-mb-[122px] mt-2 flex w-full min-w-0 justify-center overflow-hidden sm:mb-0 sm:overflow-visible">
          <div className="origin-top scale-[0.58] sm:scale-100">
            <PlayerCards lineup={lineup} />
          </div>
        </div>

        <div className="mt-8 text-sm font-bold uppercase tracking-[0.14em] text-white/60 sm:mt-12">HyperLeague — {season.name}</div>
        <h1 className="mt-1 text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl">
          Build your team. <span className="text-[#ff5500]">Win your division.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/70">
          Sign your team up for {season.weeks} weeks of weekly official matches against teams of your level, best-of-3
          playoffs for the top 4, team titles and HL Coin prizes. Free entry — Open10 and above also earn Pro ladder Elo, and
          your ranked Elo never changes.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {myTeam && !myTeam.captain ? (
            <span className="inline-flex h-12 items-center gap-2 rounded-xl border border-hl-green/40 bg-hl-green/10 px-5 text-sm font-black text-hl-green">
              <Check className="h-4 w-4" /> You&apos;re in with {myTeam.name}
            </span>
          ) : (
            <LeagueJoinButton
              seasonId={season.id}
              loggedIn={loggedIn}
              open={open}
              label={myTeam ? "Manage sign-up" : "Join now"}
            />
          )}
          <Link
            href={`/league/${season.id}/find`}
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-6 text-sm font-black uppercase tracking-[0.08em] text-white hover:border-white/35"
          >
            <Users className="h-4 w-4" /> Find teammates
            <span className="rounded bg-[#ff5500]/20 px-1.5 py-0.5 text-[11px] tracking-wide text-[#ff5500]">{findCount}</span>
          </Link>
        </div>

        {/* Phones and tablets: the corner facts go under the buttons. */}
        <div className="mt-8 grid w-full max-w-xl grid-cols-2 gap-4 text-left sm:grid-cols-3 lg:hidden">
          {left}
          {right}
        </div>
      </div>
    </section>
  );
}
