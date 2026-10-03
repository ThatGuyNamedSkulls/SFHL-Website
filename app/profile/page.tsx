import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAllPlayers } from "@/lib/db";
import { profileHref } from "@/lib/profile-link";

/**
 * /profile used to hold the whole page (?player=<name>). Profiles now live at
 * /profile/<name> (docs/PROFILE_UI_PLAN.md Q4): old links redirect there, and
 * a bare /profile opens your own profile — or, logged out, the #1 player's.
 */
export default async function ProfileIndex({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const requested = typeof query.player === "string" ? query.player.trim() : "";
  const tab = typeof query.tab === "string" ? `?tab=${encodeURIComponent(query.tab)}` : "";
  if (requested) redirect(`${profileHref(requested)}${tab}`);

  const session = await getSession();
  if (session?.playerName) redirect(profileHref(session.playerName));
  if (session) {
    return (
      <div className="hl-page-wide py-16 text-center">
        <h1 className="mb-4 text-2xl font-bold text-white">
          Your Discord account isn&apos;t linked to a HyperLeague player yet.
        </h1>
        <p className="mb-6 text-hl-muted">Join the Discord server and verify with Bloxlink first.</p>
        <Link href="/leaderboards" className="text-hl-gold hover:underline">
          Return to Rankings
        </Link>
      </div>
    );
  }

  const [top] = await getAllPlayers(1).catch(() => []);
  if (top) redirect(profileHref(top.name));
  return (
    <div className="hl-page-wide py-16 text-center">
      <h1 className="mb-4 text-2xl font-bold text-white">No players found</h1>
      <Link href="/leaderboards" className="text-hl-gold hover:underline">
        Return to Rankings
      </Link>
    </div>
  );
}
