/**
 * Upcoming season hero (docs/LEAGUE_UI_PLAN.md step 6, ESEA-style): big
 * season art, headline, JOIN NOW + FIND TEAMMATES (count), fact strips and five
 * player cards (your team's players once it's signed up). Server-safe.
 */
import Link from "next/link";
import { Check, Coins, UserRound, Users } from "lucide-react";
import { LeagueJoinButton } from "@/components/league-join";
import type { Season } from "@/lib/league";
import { STATUS_HEADLINE, seasonNumber } from "@/lib/league-shell";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-l border-white/15 pl-3 first:border-l-0 first:pl-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">{label}</div>
      <div className="mt-0.5 text-sm font-black text-white">{children}</div>
    </div>
  );
}

function fmtDay(ts: number) {
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Five tall cards, fanned; filled with your team's players, else silhouettes. */
function PlayerCards({ players, team }: { players: string[]; team: string | null }) {
  const slots = Array.from({ length: 5 }, (_, i) => players[i] ?? null);
  const tilt = [-9, -4.5, 0, 4.5, 9];
  const lift = [22, 8, 0, 8, 22];
  return (
    <div aria-hidden={!team} className="relative flex h-[270px] items-end justify-center">
      {slots.map((name, i) => (
        <div
          key={i}
          className="relative -mx-3 flex h-[210px] w-[118px] flex-col items-center justify-end overflow-hidden rounded-xl border border-white/[0.12] bg-gradient-to-b from-[#262626] to-[#111] shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
          style={{ transform: `translateY(${lift[i]}px) rotate(${tilt[i]}deg)`, zIndex: i === 2 ? 3 : i === 1 || i === 3 ? 2 : 1 }}
        >
          <span className="absolute inset-x-0 top-0 h-1 bg-[#ff5500]/70" />
          <UserRound className={`mb-auto mt-8 h-20 w-20 ${name ? "text-[#ff5500]/80" : "text-white/15"}`} strokeWidth={1.25} />
          <div className="w-full border-t border-white/[0.08] bg-black/40 px-2 py-2 text-center">
            <div className={`truncate text-[11px] font-black ${name ? "text-white" : "text-white/35"}`}>
              {name ?? `Player ${i + 1}`}
            </div>
          </div>
        </div>
      ))}
      {team ? (
        <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#ff5500]/50 bg-[#1a120d] px-3 py-1 text-[11px] font-black uppercase tracking-wide text-[#ff5500]">
          {team}
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
  findCount,
}: {
  season: Season;
  /** Teams signed up so far. */
  teams: number;
  prizePerPlayer: number;
  loggedIn: boolean;
  /** The viewer's signed-up team, if any. */
  myTeam: { name: string; players: string[]; captain: boolean } | null;
  /** Open posts on the Find Teammates board. */
  findCount: number;
}) {
  const number = seasonNumber(season.name);
  const open = season.status === "signup";

  return (
    <section className="relative mb-6 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0d0d0d]">
      {season.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- staff-provided external banner
        <img src={season.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
      ) : (
        <div aria-hidden className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_45%,rgba(255,85,0,0.32),transparent_55%),linear-gradient(120deg,#151515,#0b0b0b_60%)]" />
          <span
            className="absolute -bottom-8 right-[-2%] select-none text-[180px] font-black uppercase leading-none tracking-tight text-transparent lg:text-[230px]"
            style={{ WebkitTextStroke: "2px rgba(255,255,255,0.07)" }}
          >
            {number ? `S${number}` : "League"}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] via-[#0d0d0d]/80 to-transparent" />

      <div className="relative grid items-center gap-8 px-5 py-8 sm:px-9 sm:py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${
              open ? "border-[#ff5500]/50 bg-[#ff5500]/10 text-[#ff5500]" : "border-white/15 bg-white/[0.05] text-white/70"
            }`}
          >
            {open ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5500]" /> : null}
            {STATUS_HEADLINE[season.status]}
          </span>
          <div className="mt-3 text-sm font-bold uppercase tracking-[0.14em] text-white/60">HyperLeague — {season.name}</div>
          <h1 className="mt-1 text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl">
            Build your team.
            <br />
            <span className="text-[#ff5500]">Win your division.</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/70">
            Sign your team up for {season.weeks} weeks of weekly official matches against teams of your level, best-of-3
            playoffs for the top 4, team titles and HL Coin prizes. Free entry — league games never change your ranked Elo.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
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

          <div className="mt-8 flex flex-wrap gap-x-4 gap-y-3">
            <Fact label="Prize pool">
              <span className="inline-flex items-center gap-1">
                <Coins className="h-3.5 w-3.5 text-hl-gold" />
                {prizePerPlayer.toLocaleString()} / player
              </span>
            </Fact>
            <Fact label="Format">BO1 · BO3 playoffs</Fact>
            <Fact label="Entry">Free</Fact>
            <Fact label="Teams">
              <Link href={`/league/${season.id}/teams`} className="hover:text-[#ff5500] hover:underline">
                {teams.toLocaleString()} signed up
              </Link>
            </Fact>
            {season.signupClose ? <Fact label="Registration closes">{fmtDay(season.signupClose)}</Fact> : null}
            {season.startDate ? <Fact label="Season start">{fmtDay(season.startDate)}</Fact> : null}
          </div>
        </div>

        <div className="hidden lg:block">
          <PlayerCards players={myTeam?.players ?? []} team={myTeam?.name ?? null} />
        </div>
      </div>
    </section>
  );
}
