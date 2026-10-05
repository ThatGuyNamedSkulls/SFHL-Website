import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isAnyStaff, staffRoles } from "@/lib/staff-session";
import { StaffPanel, type StaffTab } from "@/components/staff/staff-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff panel — HyperLeague",
  robots: { index: false },
};

/** Staff panel (Match Staff / Admin / MatchMaking Manager; 404 for everyone else). ?player= opens a player, ?tab=<name> a tab. */
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  const roles = session ? await staffRoles(session.discordId) : null;
  if (!roles || !isAnyStaff(roles)) notFound();
  const params = await searchParams;
  const player = typeof params.player === "string" ? params.player.trim().slice(0, 64) || null : null;
  const tabs: StaffTab[] = ["players", "ranking", "queue", "moderation", "teams", "shop", "season", "recent"];
  const tab = tabs.find((t) => t === params.tab) ?? "players";
  return (
    <div className="hl-page-wide">
      <h1 className="flex items-center gap-2 text-2xl font-black text-white">
        <ShieldCheck className="h-6 w-6 text-hl-gold" /> Staff panel
      </h1>
      <p className="mb-5 mt-1 text-sm text-hl-muted">
        Each action goes to the Discord bot, which runs the same code as the slash command. The bot must be online.
      </p>
      <StaffPanel roles={roles} initialTab={tab} initialPlayer={player} />
    </div>
  );
}
