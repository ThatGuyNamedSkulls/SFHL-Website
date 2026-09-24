import Link from "next/link";
import { redirect } from "next/navigation";
import { Trophy } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isMatchStaff } from "@/lib/discord-party-voice";
import { defaultSeasonId } from "@/lib/league-shell";

export const dynamic = "force-dynamic";

/** /league → the live season (else the upcoming one, else the newest). */
export default async function LeagueIndexPage() {
  const seasonId = await defaultSeasonId();
  if (seasonId !== null) redirect(`/league/${seasonId}`);

  const session = await getSession();
  const staff = session ? await isMatchStaff(session.discordId).catch(() => false) : false;
  return (
    <div className="hl-page-wide">
      <div className="rounded-xl border border-hl-border bg-hl-panel p-10 text-center">
        <Trophy className="mx-auto mb-3 h-8 w-8 text-hl-gold" />
        <h1 className="text-xl font-black text-white">No league season yet</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-hl-muted">
          Match Staff announce sign-ups on Discord and here. Get ready by creating a team and inviting your players.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href="/teams"
            className="find-match-btn inline-flex h-9 items-center rounded-xl px-4 text-sm font-black header-caps text-hl-base"
          >
            My teams
          </Link>
          {staff ? (
            <Link
              href="/league/manage"
              className="inline-flex h-9 items-center rounded-xl border border-hl-gold/50 px-4 text-sm font-black header-caps text-hl-gold"
            >
              Create a season
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
