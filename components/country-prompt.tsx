"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CountrySelect } from "@/components/country-select";
import { MapPin } from "lucide-react";

/**
 * One-time prompt asking a newly-linked player to pick their country.
 * Mounted globally; only opens when the logged-in user is linked to a player
 * that has no country set yet. "Skip" is remembered for the session so it
 * doesn't nag on every navigation.
 */
export function CountryPrompt() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("hl_country_skipped")) return;
    fetch("/api/players/country")
      .then((r) => r.json())
      .then((d) => {
        if (d.linked && !d.country) setOpen(true);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch("/api/players/country", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: selected }),
      });
      if (res.ok) setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    sessionStorage.setItem("hl_country_skipped", "1");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : skip())}>
      <DialogContent className="bg-hl-panel border border-hl-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-black text-white header-caps flex items-center gap-2">
            <MapPin className="w-5 h-5 text-hl-gold" /> Where are you from?
          </DialogTitle>
          <DialogDescription className="text-hl-muted">
            Pick your country so it shows on your profile and the rankings.
          </DialogDescription>
        </DialogHeader>

        <CountrySelect value={selected} onChange={setSelected} />

        <div className="flex gap-3 pt-2">
          <button
            onClick={skip}
            className="flex-1 py-2.5 rounded-lg border border-hl-border text-white font-bold text-sm hover:bg-hl-panel-light transition-colors"
          >
            Skip
          </button>
          <button
            onClick={save}
            disabled={!selected || saving}
            className="flex-1 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
