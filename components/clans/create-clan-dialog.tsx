"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "@/components/session-provider";
import { BTN_LINE, BTN_PRIMARY } from "@/components/clans/ui";
import { ClanPreview, ClanProfileFields, type ClanDraft } from "@/components/clans/clan-form";
import { invalidateClientApi } from "@/lib/client-api";
import { clanHref } from "@/lib/clan-ui";
import { DEFAULT_PROFILE_BACKGROUNDS } from "@/lib/profile-backgrounds";

const EMPTY: ClanDraft = {
  name: "",
  tag: "",
  description: "",
  rules: "",
  logoUrl: "",
  accentColor: DEFAULT_PROFILE_BACKGROUNDS[1].color,
  private: false,
  region: "EU",
};

/** Create a clan (§4.1): labeled fields, a preview, the price, then the new clan's page. */
export function CreateClanDialog({
  open,
  onOpenChange,
  cost,
  ownedCount,
  maxOwned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cost: number;
  ownedCount: number;
  maxOwned: number;
}) {
  const router = useRouter();
  const { session, coins, refresh } = useSession();
  const [draft, setDraft] = useState<ClanDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = !session?.playerName
    ? "Link a HyperLeague player first (verify with Bloxlink in the Discord server)."
    : ownedCount >= maxOwned
      ? `You already own ${maxOwned} clans.`
      : coins < cost
        ? `You need ${cost.toLocaleString()} HL Coins.`
        : null;
  const ready = draft.name.trim().length >= 3 && draft.tag.length >= 2 && !blocked;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clubs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create the clan.");
        return;
      }
      invalidateClientApi("/api/auth/me");
      await refresh({ force: true });
      setDraft(EMPTY);
      onOpenChange(false);
      if (data.club?.id) router.push(clanHref(data.club.id));
    } catch {
      setError("Could not create the clan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2.5rem)] gap-0 overflow-y-auto border border-white/10 bg-[#1b1b1b] p-0 sm:max-w-[55rem]"
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-[1.125rem] py-4">
          <div>
            <DialogTitle className="text-[1.0625rem] font-bold text-[#ededed]">Create a clan</DialogTitle>
            <p className="mt-0.5 text-[0.8125rem] text-[#8a8a8a]">Everything can be changed later.</p>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} className="text-[#8a8a8a] hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          <ClanProfileFields value={draft} onChange={setDraft} showRegion />
          <ClanPreview value={draft} playerName={session?.playerName} />
        </div>
        <div className="flex flex-col gap-3 border-t border-white/[0.07] px-[1.125rem] py-3.5 text-[0.8125rem] text-[#8a8a8a] sm:flex-row sm:items-center sm:justify-between">
          <span>
            {error ? (
              <span className="text-[#f08a7f]">{error}</span>
            ) : blocked ? (
              <span className="text-[#e9c27a]">{blocked}</span>
            ) : (
              <>
                Costs <b className="font-semibold text-[#ededed]">{cost.toLocaleString()}</b> HL Coins. You have{" "}
                <b className="font-semibold text-[#ededed]">{coins.toLocaleString()}</b>.
              </>
            )}
          </span>
          <span className="flex justify-end gap-2">
            <button type="button" className={BTN_LINE} onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={!ready || busy} onClick={() => void create()}>
              {busy ? "Creating…" : "Create clan"}
            </button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
