import { notFound } from "next/navigation";
import { LeagueBar } from "@/components/league-bar";
import { LeagueHero, LeagueHeroCompact } from "@/components/league-hero";
import { LeagueHeroSlot } from "@/components/league-hero-slot";
import { getSession } from "@/lib/auth";
import { isMatchStaff } from "@/lib/discord-party-voice";
import { UPCOMING_STATUSES } from "@/lib/league";
import { leagueShell } from "@/lib/league-shell";

export const dynamic = "force-dynamic";

/** Every season page: the league bar (seasons + tabs) and the season hero. */
export default async function SeasonLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ season: string }>;
}) {
  const { season: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const shell = await leagueShell(Number(raw));
  if (!shell) notFound();
  const session = await getSession();
  const staff = session ? await isMatchStaff(session.discordId).catch(() => false) : false;

  return (
    <div className="hl-page-wide">
      <LeagueBar seasonId={shell.season.id} pinned={shell.pinned} past={shell.past} tabs={shell.tabs} staff={staff} />
      <LeagueHeroSlot
        upcoming={UPCOMING_STATUSES.includes(shell.season.status)}
        full={<LeagueHero season={shell.season} facts={shell.facts} />}
        compact={<LeagueHeroCompact season={shell.season} />}
      />
      {children}
    </div>
  );
}
