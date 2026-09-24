/**
 * Find Teammates cards (docs/LEAGUE_UI_PLAN.md step 7, ESEA "Find team" /
 * "Find player" style). Server-safe; the buttons are client components.
 */
import Link from "next/link";
import { Check, Globe2, Lock } from "lucide-react";
import { ClubMark } from "@/components/club-identity";
import { Flag } from "@/components/flag";
import { ApplyButton, MessageButton } from "@/components/league-find";
import { countryName, flagPath } from "@/lib/countries";
import type { PlayerPostView, TeamPostView } from "@/lib/league-find";
import { DAYS, LANGUAGES, ROLES, TARGET_DIVISIONS, TIMES, labelOf } from "@/lib/league-find-rules";
import { shortSpan } from "@/lib/league-standings";

const MAX_MEMBERS = 7;

function RoleChips({ roles, tone }: { roles: string[]; tone: "want" | "play" }) {
  if (!roles.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((r) => (
        <span
          key={r}
          className={`rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
            tone === "want" ? "border-[#ff5500]/40 bg-[#ff5500]/10 text-[#ff8a4d]" : "border-white/15 bg-white/[0.05] text-white/80"
          }`}
        >
          {labelOf(ROLES, r)}
        </span>
      ))}
    </div>
  );
}

function Schedule({ days, times }: { days: string[]; times: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="flex gap-1" aria-label={`Practice days: ${days.join(", ") || "not set"}`}>
        {DAYS.map(([c, n]) => (
          <span
            key={c}
            title={c.toUpperCase()}
            className={`grid h-5 w-5 place-items-center rounded text-[10px] font-black ${
              days.includes(c) ? "bg-[#ff5500] text-white" : "bg-white/[0.06] text-white/35"
            }`}
          >
            {n}
          </span>
        ))}
      </div>
      {times.length ? (
        <span className="text-[11px] text-white/60">{times.map((t) => labelOf(TIMES, t)).join(" · ")}</span>
      ) : null}
    </div>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 text-[11px] text-white/60">{children}</span>;
}

function Slots({ starters, subs }: { starters: number; subs: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`${starters} starters, ${subs} subs of ${MAX_MEMBERS}`}>
      <div className="flex gap-0.5">
        {Array.from({ length: MAX_MEMBERS }, (_, i) => (
          <span
            key={i}
            className={`h-3.5 w-2 rounded-[2px] ${i < starters ? "bg-[#ff5500]" : i < starters + subs ? "bg-white/50" : "bg-white/[0.1]"}`}
          />
        ))}
      </div>
      <span className="text-[11px] font-bold tabular-nums text-white/70">
        {starters + subs}/{MAX_MEMBERS}
      </span>
    </div>
  );
}

const ago = (ts: number) => `${shortSpan(ts)} ago`;

export function TeamPostCard({ post: p, seasonId, loggedIn }: { post: TeamPostView; seasonId: number; loggedIn: boolean }) {
  const range =
    p.minElo !== null || p.maxElo !== null
      ? `${p.minElo?.toLocaleString() ?? "Any"} – ${p.maxElo?.toLocaleString() ?? "any"} Elo`
      : "Any Elo";
  return (
    <article
      className={`flex flex-col rounded-xl border bg-[#121212] p-4 ${p.mine ? "border-[#ff5500]/40" : "border-white/[0.08]"}`}
    >
      <header className="flex items-start justify-between gap-3">
        <Link href={`/teams/${p.team.id}`} className="group flex min-w-0 items-center gap-3">
          <ClubMark tag={p.team.tag} accentColor={p.team.accentColor} logoUrl={p.team.logoUrl} size={44} />
          <div className="min-w-0">
            <div className="truncate text-base font-black text-white group-hover:underline">{p.team.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white/75">
                {p.inviteOnly ? <Lock className="h-3 w-3 text-[#ff5500]" /> : null}
                {p.divisionLabel}
              </span>
              {p.signedUp ? (
                <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-hl-green">
                  <Check className="h-3 w-3" /> Signed up
                </span>
              ) : null}
            </div>
          </div>
        </Link>
        <Slots starters={p.starters} subs={p.subs} />
      </header>

      <h3 className="mt-3 text-sm font-black text-white">{p.title}</h3>
      {p.body ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-white/65">{p.body}</p> : null}

      <div className="mt-3 space-y-2.5">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">Looking for</div>
          <RoleChips roles={p.roles} tone="want" />
        </div>
        <Schedule days={p.days} times={p.times} />
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <Meta>{range}</Meta>
          {p.seedElo ? <Meta>Team avg {p.seedElo.toLocaleString()}</Meta> : null}
          {p.language ? (
            <Meta>
              <Globe2 className="h-3 w-3" /> {labelOf(LANGUAGES, p.language)}
            </Meta>
          ) : null}
        </div>
      </div>

      <div className="flex-1" />
      <footer className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[11px] text-white/40">Updated {ago(p.updatedAt)}</span>
        <ApplyButton seasonId={seasonId} post={p} loggedIn={loggedIn} />
      </footer>
    </article>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- player avatars come from Roblox/Discord CDNs
    return <img src={src} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-white/[0.06] object-cover" />;
  }
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-sm font-black text-white/70">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function PlayerPostCard({ post: p, seasonId, loggedIn }: { post: PlayerPostView; seasonId: number; loggedIn: boolean }) {
  return (
    <article
      className={`flex flex-col rounded-xl border bg-[#121212] p-4 ${p.mine ? "border-[#ff5500]/40" : "border-white/[0.08]"}`}
    >
      <header className="flex items-center gap-3">
        <Avatar src={p.avatar} name={p.playerName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/profile?player=${encodeURIComponent(p.playerName)}`} className="truncate text-base font-black text-white hover:underline">
              {p.playerName}
            </Link>
            {p.country ? <Flag src={flagPath(p.country)} name={countryName(p.country)} className="h-3.5 w-5" /> : null}
          </div>
          <div className="mt-0.5 text-[11px] text-white/60">
            {p.elo ? `${p.elo.toLocaleString()} Elo` : "Unranked"}
            {p.rank ? ` · ${p.rank}` : ""}
            {p.signedUpWith ? <span className="text-hl-green"> · on {p.signedUpWith}</span> : null}
          </div>
        </div>
      </header>

      <h3 className="mt-3 text-sm font-black text-white">{p.title}</h3>
      {p.body ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-white/65">{p.body}</p> : null}

      <div className="mt-3 space-y-2.5">
        <RoleChips roles={p.roles} tone="play" />
        {p.divisions.length ? (
          <div className="text-[11px] text-white/60">
            <span className="text-white/45">Aiming for </span>
            {p.divisions.map((d) => labelOf(TARGET_DIVISIONS, d)).join(", ")}
          </div>
        ) : null}
        <Schedule days={p.days} times={p.times} />
        {p.language ? (
          <Meta>
            <Globe2 className="h-3 w-3" /> {labelOf(LANGUAGES, p.language)}
          </Meta>
        ) : null}
      </div>

      <div className="flex-1" />
      <footer className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[11px] text-white/40">Updated {ago(p.updatedAt)}</span>
        <MessageButton seasonId={seasonId} post={p} loggedIn={loggedIn} />
      </footer>
    </article>
  );
}
