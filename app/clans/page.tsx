import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { ClanList } from "@/components/clans/clan-list";

export const metadata: Metadata = {
  title: "Clans — HyperLeague",
  description: "Counter Blox communities on HyperLeague: their own tag, chat, leaderboard and tournaments.",
};

/** The clan list (docs/CLANS_UI_PLAN.md). `?create=1` opens Create clan. */
export default function ClansPage() {
  return (
    <Suspense fallback={<Skeleton className="hl-page-wide h-96 max-w-[73.75rem] rounded-xl" />}>
      <ClanList />
    </Suspense>
  );
}
