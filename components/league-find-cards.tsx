/**
 * Find Teammates rows (docs/LEAGUE_V2_PLAN.md D2/D3, FACEIT "Find team" /
 * "Find player"): a team row shows its roster as player cards (5 main roster,
 * 6 subs, 1 coach) next to the post; a player row shows the player's card,
 * the post, and MESSAGE. Server-safe; the buttons are client components.
 */
import Link from "next/link";
import { Check, Globe2, Lock, Moon, Sun, Sunrise, Sunset, type LucideIcon } from "lucide-react";
import { ClubMark } from "@/components/club-identity";
import { Flag } from "@/components/flag";
import { ApplyButton, MessageButton } from "@/components/league-find";
import { PlayerCard } from "@/components/player-card";
import { countryName, flagPath } from "@/lib/countries";
import type { PlayerPostView, TeamPostView } from "@/lib/league-find";
import { DAYS, LANGUAGES, ROLES, TARGET_DIVISIONS, TIMES, labelOf, rangeLabel } from "@/lib/league-find-rules";
import { shortSpan } from "@/lib/league-standings";
import type { PlayerCardData } from "@/lib/player-card";
import { ROLE_LIMITS } from "@/lib/team-roster";

const TIME_ICON: Record<string, LucideIcon> = { morning: Sunrise, afternoon: Sun, evening: Sunset, night: Moon };
const ago = (ts: number) => `${shortSpan(ts)} ago`;

function Heading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
      <span>{children}</span>
      {aside ? <span className="tabular-nums text-white/40">{aside}</span> : null}
    </div>
  );
}

/** Every role, the post's ones lit (FACEIT shows the full grid). */
function RoleGrid({ roles, tone }: { roles: string[]; tone: "want" | "play" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ROLES.map(([code, name]) => {
        const on = roles.includes(code);
        return (
          <span
            key={code}
            className={`rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
              on
                ? tone === "want"
                  ? "border-[#ff5500]/50 bg-[#ff5500]/15 text-[#ff8a4d]"
                  : "border-white/30 bg-white/[0.1] text-white"
                : "border-white/[0.06] text-white/25"
            }`}
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}

function Schedule({ days, times }: { days: string[]; times: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex gap-1" aria-label={`Practice days: ${days.join(", ") || "not set"}`}>
        {DAYS.map(([c, n]) => (
          <span
            key={c}
            title={c.toUpperCase()}
            className={`grid h-6 w-6 place-items-center rounded text-[10px] font-black ${
              days.includes(c) ? "bg-[#ff5500] text-white" : "bg-white/[0.06] text-white/35"
            }`}
          >
            {n}
          </span>
        ))}
      </div>
      <div className="flex gap-1" aria-label={`Time of day: ${times.join(", ") || "not set"}`}>
        {TIMES.map(([c, n]) => {
          const Icon = TIME_ICON[c];
          const on = times.includes(c);
          return (
            <span
              key={c}
              title={n}
              className={`grid h-6 w-6 place-items-center rounded ${on ? "bg-white/[0.12] text-white" : "bg-white/[0.04] text-white/25"}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 text-[11px] text-white/60">{children}</span>;
}

/** A bench / coach slot: the avatar in its rank ring, or an empty dashed circle. */
function MiniSlot({ card }: { card: PlayerCardData | null }) {
  if (!card) return <span aria-hidden className="block h-9 w-9 shrink-0 rounded-full border border-dashed border-white/15" />;
  return (
    <span
      title={`${card.name} · ${card.elo !== null ? `${card.elo.toLocaleString("en-US")} Elo` : "Unranked"}`}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full p-[2px]"
      style={{ background: `conic-gradient(${card.ringColor} ${Math.round(card.progress * 360)}deg, rgba(255,255,255,0.12) 0deg)` }}
    >
      <span className="grid h-full w-full place-items-center overflow-hidden rounded-full border-2 border-[#0f0f0f] bg-[#222] text-[10px] font-black text-white/70">
        {card.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- Roblox/Discord avatar CDNs
          <img src={card.avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          card.name.slice(0, 2).toUpperCase()
        )}
      </span>
    </span>
  );
}

export function TeamPostCard({ post: p, seasonId, loggedIn }: { post: TeamPostView; seasonId: number; loggedIn: boolean }) {
  const starters: (PlayerCardData | null)[] = [...p.roster.starters];
  while (starters.length < ROLE_LIMITS.starter) starters.push(null);
  const subs: (PlayerCardData | null)[] = [...p.roster.subs];
  while (subs.length < ROLE_LIMITS.sub) subs.push(null);
  return (
    <article
      className={`overflow-hidden rounded-xl border bg-[#121212] lg:grid lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)] ${
        p.mine ? "border-[#ff5500]/40" : "border-white/[0.08]"
      }`}
    >
      {/* Left: the team and its roster. */}
      <div className="min-w-0 border-b border-white/[0.06] bg-[#0f0f0f] p-4 lg:border-b-0 lg:border-r">
        <Link href={`/teams/${p.team.id}`} className="group flex min-w-0 items-center gap-3">
          <ClubMark tag={p.team.tag} accentColor={p.team.accentColor} logoUrl={p.team.logoUrl} size={48} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-black text-white group-hover:underline">{p.team.name}</span>
              {p.country ? <Flag src={flagPath(p.country)} name={countryName(p.country)} className="h-3.5 w-5 shrink-0" /> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/80">
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

        <div className="mt-4">
          <Heading aside={`${p.slots.starter}/${ROLE_LIMITS.starter}`}>Team members</Heading>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {starters.map((c, i) => (
              <PlayerCard key={i} card={c} size="sm" />
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
          <div>
            <Heading aside={`${p.slots.sub}/${ROLE_LIMITS.sub}`}>Substitutes</Heading>
            <div className="flex gap-1.5">
              {subs.map((c, i) => (
                <MiniSlot key={i} card={c} />
              ))}
            </div>
          </div>
          <div>
            <Heading aside={`${p.slots.coach}/${ROLE_LIMITS.coach}`}>Coach</Heading>
            <MiniSlot card={p.roster.coach} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          <Meta>Wants {rangeLabel(p)}</Meta>
          {p.seedElo ? <Meta>Team avg {p.seedElo.toLocaleString("en-US")}</Meta> : null}
          {p.language ? (
            <Meta>
              <Globe2 className="h-3 w-3" /> {labelOf(LANGUAGES, p.language)}
            </Meta>
          ) : null}
        </div>
      </div>

      {/* Right: the post. */}
      <div className="flex min-w-0 flex-col p-4">
        <h3 className="text-base font-black text-white">{p.title}</h3>
        {p.body ? <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-white/65">{p.body}</p> : null}
        <div className="mt-4 space-y-3">
          <div>
            <Heading>Looking for</Heading>
            <RoleGrid roles={p.roles} tone="want" />
          </div>
          <div>
            <Heading>Practice</Heading>
            <Schedule days={p.days} times={p.times} />
          </div>
        </div>
        <div className="flex-1" />
        <footer className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[11px] text-white/40">Updated {ago(p.updatedAt)}</span>
          <ApplyButton seasonId={seasonId} post={p} loggedIn={loggedIn} />
        </footer>
      </div>
    </article>
  );
}

export function PlayerPostCard({ post: p, seasonId, loggedIn }: { post: PlayerPostView; seasonId: number; loggedIn: boolean }) {
  const shown = p.divisions.slice(0, 2);
  const more = p.divisions.length - shown.length;
  return (
    <article
      className={`grid gap-4 rounded-xl border bg-[#121212] p-4 sm:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_auto] ${
        p.mine ? "border-[#ff5500]/40" : "border-white/[0.08]"
      }`}
    >
      <Link href={`/profile?player=${encodeURIComponent(p.playerName)}`} className="mx-auto block sm:mx-0" aria-label={`${p.playerName}'s profile`}>
        <PlayerCard card={p.card} size="md" highlight={p.mine} />
      </Link>

      <div className="min-w-0">
        <h3 className="text-base font-black text-white">{p.title}</h3>
        {p.body ? <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-white/65">{p.body}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {p.language ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/75">
              <Globe2 className="h-3 w-3" /> {labelOf(LANGUAGES, p.language)}
            </span>
          ) : null}
          {shown.map((d) => (
            <span key={d} className="rounded-md border border-[#ff5500]/35 bg-[#ff5500]/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#ff8a4d]">
              {labelOf(TARGET_DIVISIONS, d)}
            </span>
          ))}
          {more > 0 ? (
            <span
              title={p.divisions.slice(2).map((d) => labelOf(TARGET_DIVISIONS, d)).join(", ")}
              className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] font-black text-white/55"
            >
              +{more} more
            </span>
          ) : null}
          {p.signedUpWith ? <span className="text-[11px] font-bold text-hl-green">On {p.signedUpWith}</span> : null}
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <Heading>Roles</Heading>
            <RoleGrid roles={p.roles} tone="play" />
          </div>
          <div>
            <Heading>Practice</Heading>
            <Schedule days={p.days} times={p.times} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 sm:col-span-2 xl:col-span-1 xl:flex-col xl:items-end">
        <MessageButton seasonId={seasonId} post={p} loggedIn={loggedIn} />
        <span className="text-[11px] text-white/40">Updated {ago(p.updatedAt)}</span>
      </div>
    </article>
  );
}
