"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CupFacts } from "@/components/cup-facts";
import { TournamentCreateForm } from "@/components/tournament-create-form";
import { useClan } from "@/components/clans/clan-context";
import { BTN_LINE, BTN_PRIMARY, BTN_SM, BTN_SOFT, BoxHead, PANEL } from "@/components/clans/ui";

interface Cup {
  id: string;
  name: string;
  status: "open" | "live" | "completed" | "cancelled";
  size: number;
  bracket: string;
  bo: number;
  teamCount: number;
  createdAt: number;
  teams: { name: string; placement: number | null }[];
}

const STATUS: Record<Cup["status"], { label: string; dot: string }> = {
  open: { label: "Registration open", dot: "bg-[#2ecc71]" },
  live: { label: "Live", dot: "bg-[#ff5500]" },
  completed: { label: "Finished", dot: "bg-[#666]" },
  cancelled: { label: "Cancelled", dot: "bg-[#666]" },
};

/**
 * Tournaments (§4.12): only the clan's real cups. The cup defaults that used
 * to sit on top of an empty list now show inside the create form.
 */
export function TournamentsTab() {
  const router = useRouter();
  const { data, perms } = useClan();
  const club = data.club;
  const [cups, setCups] = useState<Cup[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/tournaments?clubId=${encodeURIComponent(club.id)}`);
        const body = (await res.json()) as { tournaments?: Cup[] };
        if (!cancelled) setCups((body.tournaments ?? []).filter((t) => t.status !== "cancelled"));
      } catch {
        if (!cancelled) setCups([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [club.id]);

  return (
    <div className="flex flex-col gap-5">
      <section className={PANEL}>
        <BoxHead title="Clan tournaments">
          {perms.owner ? (
            <button type="button" className={`${BTN_LINE} ${BTN_SM}`} onClick={() => setCreating((v) => !v)}>
              {creating ? "Close" : (
                <>
                  <Plus className="h-3.5 w-3.5" /> Create tournament
                </>
              )}
            </button>
          ) : cups ? (
            <span>{cups.length} total</span>
          ) : null}
        </BoxHead>
        {cups === null ? (
          <p className="px-4 py-6 text-sm text-[#8a8a8a]">Loading…</p>
        ) : cups.length ? (
          <div className="divide-y divide-white/[0.05]">
            {cups.map((t) => {
              const winner = t.status === "completed" ? t.teams.find((x) => x.placement === 1)?.name : null;
              const meta = [
                `${t.teamCount} of ${t.size} teams`,
                `${t.bracket === "double" ? "double" : "single"} elimination, Bo${t.bo}`,
                winner ? `Won by ${winner}` : new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
              ];
              return (
                <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 px-4 py-3.5">
                  <div className="min-w-0">
                    <h3 className="truncate text-[0.9375rem] font-semibold text-[#ededed]">{t.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-y-1 text-[0.8125rem] text-[#8a8a8a]">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#bdbdbd]">
                        <i className={`h-[7px] w-[7px] rounded-full ${STATUS[t.status].dot}`} />
                        {STATUS[t.status].label}
                      </span>
                      {meta.map((x) => (
                        <span key={x} className="inline-flex items-center">
                          <span className="mx-[0.4375rem] text-[#4a4a4a]">·</span>
                          {x}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Link href={`/tournaments/${t.id}`} className={`${BTN_SOFT} ${BTN_SM}`}>
                    {t.status === "completed" ? "Results" : "View"}
                  </Link>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-5 py-11 text-center">
            <b className="text-[0.9375rem] font-semibold text-[#ededed]">No clan tournaments yet</b>
            <p className="max-w-[24rem] text-[0.8125rem] text-[#8a8a8a]">
              {perms.owner
                ? "Run a cup for your members: choose the size, the format and the maps."
                : "Cups the owner runs show here, with sign-ups and results."}
            </p>
            {perms.owner && !creating ? (
              <button type="button" className={`${BTN_PRIMARY} mt-2.5`} onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Create tournament
              </button>
            ) : null}
          </div>
        )}
      </section>

      {creating && perms.owner ? (
        <section className={PANEL}>
          <BoxHead title="New clan tournament" />
          <div className="space-y-6 p-4">
            <TournamentCreateForm
              kind="community"
              clubId={club.id}
              onCancel={() => setCreating(false)}
              onCreated={(cupId) => router.push(`/tournaments/${cupId}`)}
            />
            <div className="border-t border-white/[0.07] pt-5">
              <div className="mb-4 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[#8a8a8a]">Every clan cup</div>
              <CupFacts region={club.region} rules={club.rules} />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
