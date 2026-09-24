import Link from "next/link";
import { ArrowLeft, Settings2 } from "lucide-react";
import { LeagueManage } from "@/components/league-manage";

export const dynamic = "force-dynamic";

/** League → Manage (Match Staff only; the API refuses everyone else). ?season= picks the season. */
export default async function LeagueManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).season;
  const seasonId = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null;
  return (
    <div className="hl-page-wide">
      <Link
        href={seasonId ? `/league/${seasonId}` : "/league"}
        className="mb-3 inline-flex items-center gap-1 text-xs font-bold text-hl-muted hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> League
      </Link>
      <h1 className="mb-5 flex items-center gap-2 text-2xl font-black text-white">
        <Settings2 className="h-6 w-6 text-hl-gold" /> Manage the league
      </h1>
      <LeagueManage initialSeasonId={seasonId} />
    </div>
  );
}
