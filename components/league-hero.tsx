/**
 * Season hero (ESEA-style banner): status, title, organizer, a strip of key
 * facts and big "SEASON N" art. A staff-set banner image replaces the
 * generated art. Server-safe (no hooks).
 */
import { Coins } from "lucide-react";
import type { Season } from "@/lib/league";
import { STATUS_HEADLINE, seasonNumber } from "@/lib/league-shell";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sm:border-l sm:border-white/15 sm:pl-3 sm:first:border-l-0 sm:first:pl-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">{label}</div>
      <div className="mt-0.5 text-sm font-black text-white">{children}</div>
    </div>
  );
}

function fmtDay(ts: number) {
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Phones, on every tab but Overview: one slim line instead of the full banner. */
export function LeagueHeroCompact({ season }: { season: Season }) {
  const tone =
    season.status === "cancelled" ? "text-white/50" : season.status === "finished" ? "text-white/70" : "text-[#ff5500]";
  return (
    <section className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[radial-gradient(circle_at_85%_50%,rgba(255,85,0,0.2),transparent_60%),#0d0d0d] px-4 py-3">
      <h1 className="min-w-0 truncate text-base font-black text-white">HyperLeague — {season.name}</h1>
      <span className={`shrink-0 text-[10px] font-black uppercase tracking-[0.12em] ${tone}`}>{STATUS_HEADLINE[season.status]}</span>
    </section>
  );
}

export function LeagueHero({
  season,
  facts,
}: {
  season: Season;
  facts: { teams: number; divisions: number; prizePerPlayer: number };
}) {
  const number = seasonNumber(season.name);
  const live = season.status === "regular" || season.status === "playoffs" || season.status === "drawn";
  const headlineTone =
    season.status === "cancelled" ? "text-white/50" : season.status === "finished" ? "text-white/70" : "text-[#ff5500]";

  return (
    <section className="relative mb-6 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0d0d0d]">
      {season.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- staff-provided external banner
        <img src={season.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
      ) : (
        <div aria-hidden className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_40%,rgba(255,85,0,0.28),transparent_55%),linear-gradient(120deg,#141414,#0b0b0b_60%)]" />
          <div className="absolute -right-6 top-1/2 hidden -translate-y-1/2 select-none md:block">
            <div className="flex items-center gap-4">
              <span
                className="text-[110px] font-black uppercase leading-none tracking-tight text-transparent lg:text-[140px]"
                style={{ WebkitTextStroke: "2px rgba(255,255,255,0.14)" }}
              >
                {number ? "Season" : "League"}
              </span>
              {number ? (
                <span className="grid h-[150px] w-[150px] place-items-center rounded-full border-[10px] border-[#ff5500]/35 text-[84px] font-black leading-none text-[#ff5500]/45 lg:h-[180px] lg:w-[180px] lg:text-[100px]">
                  {number}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] via-[#0d0d0d]/85 to-transparent" />

      <div className="relative px-5 py-7 sm:px-8 sm:py-9">
        <div className={`text-[12px] font-black uppercase tracking-[0.14em] ${headlineTone}`}>
          {STATUS_HEADLINE[season.status]}
        </div>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-4xl">
          HyperLeague — {season.name}
        </h1>
        <div className="mt-1 text-sm text-white/70">
          Organized by <span className="font-bold text-white">HyperLeague</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 min-[400px]:grid-cols-3 sm:flex sm:flex-wrap">
          <Fact label="Prize pool">
            <span className="inline-flex items-center gap-1">
              <Coins className="h-3.5 w-3.5 text-hl-gold" />
              {facts.prizePerPlayer.toLocaleString()} / player
            </span>
          </Fact>
          <Fact label="Format">BO1 · BO3 playoffs</Fact>
          <Fact label="Teams">{facts.teams.toLocaleString()}</Fact>
          {live || season.status === "finished" ? <Fact label="Divisions">{facts.divisions}</Fact> : null}
          {season.startDate ? (
            <Fact label="Start date">{fmtDay(season.startDate)}</Fact>
          ) : season.signupClose && season.status === "signup" ? (
            <Fact label="Registration closes">{fmtDay(season.signupClose)}</Fact>
          ) : null}
          <Fact label="Entry">Free</Fact>
        </div>
      </div>
    </section>
  );
}
