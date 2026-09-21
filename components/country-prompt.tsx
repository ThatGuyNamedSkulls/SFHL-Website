"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CountrySelect } from "@/components/country-select";
import { Flag } from "@/components/flag";
import {
  countryName,
  flagPath,
  notifyCountryChanged,
} from "@/lib/countries";
import { MapPin } from "lucide-react";
import { useSession } from "@/components/session-provider";

/**
 * One-time prompt asking a newly-linked player to pick their country.
 * Mounted globally; only opens when the logged-in user is linked to a player
 * that has no country set yet. Picking a country saves immediately and closes.
 */
export function CountryPrompt() {
  const { session, loaded } = useSession();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef(false);

  useEffect(() => {
    if (!loaded || !session || savedRef.current) return;
    if (typeof window !== "undefined") {
      if (sessionStorage.getItem("hl_country_skipped")) return;
      if (sessionStorage.getItem("hl_country_saved")) return;
    }
    let cancelled = false;
    let id: ReturnType<typeof setInterval> | null = null;
    const check = async () => {
      if (typeof window !== "undefined") {
        if (sessionStorage.getItem("hl_country_skipped")) {
          if (id) clearInterval(id);
          return;
        }
        if (sessionStorage.getItem("hl_country_saved")) {
          if (id) clearInterval(id);
          return;
        }
      }
      try {
        const r = await fetch("/api/players/country", { cache: "no-store" });
        const d = await r.json();
        if (cancelled) return;
        if (d.country) {
          savedRef.current = true;
          setOpen(false);
          if (id) clearInterval(id);
          return;
        }
        if (d.linked && !d.country) setOpen(true);
      } catch {
        /* ignore */
      }
    };
    const start = async () => {
      await check();
      if (cancelled || savedRef.current) return;
      if (typeof window !== "undefined") {
        if (sessionStorage.getItem("hl_country_skipped")) return;
        if (sessionStorage.getItem("hl_country_saved")) return;
      }
      id = setInterval(check, 8000);
    };
    void start();
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [loaded, session?.discordId]);

  const close = (skipped: boolean) => {
    if (saving) return;
    setOpen(false);
    if (skipped && !savedRef.current) {
      try {
        sessionStorage.setItem("hl_country_skipped", "1");
      } catch {
        /* ignore */
      }
    }
  };

  const save = async (code: string) => {
    if (!code || saving) return;
    setSelected(code);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/players/country", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      const saved = typeof data.country === "string" ? data.country : "";
      if (!res.ok || !saved) {
        setError(typeof data.error === "string" ? data.error : "Could not save country");
        return;
      }
      savedRef.current = true;
      try {
        sessionStorage.setItem("hl_country_saved", saved);
        sessionStorage.removeItem("hl_country_skipped");
      } catch {
        /* ignore */
      }
      notifyCountryChanged(saved);
      setOpen(false);
    } catch {
      setError("Could not save country");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (next) setOpen(true);
        else setOpen(false);
      }}
    >
      <DialogContent
        className="bg-hl-panel border border-hl-border sm:max-w-md"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-black text-white header-caps flex items-center gap-2">
            <MapPin className="w-5 h-5 text-hl-gold" /> Where are you from?
          </DialogTitle>
          <DialogDescription className="text-hl-muted">
            Pick your country so it shows on your profile and places you on the matching regional leaderboard.
          </DialogDescription>
        </DialogHeader>

        {selected && (
          <div className="flex items-center gap-2 rounded-lg border border-hl-border bg-hl-base/60 px-3 py-2">
            <Flag src={flagPath(selected)} name={countryName(selected)} className="w-7 h-5" />
            <span className="text-sm font-semibold text-white">{countryName(selected)}</span>
            {saving && <span className="ml-auto text-xs text-hl-muted">Saving…</span>}
          </div>
        )}

        <CountrySelect value={selected} onChange={(code) => void save(code)} disabled={saving} />

        {error && <p className="text-sm text-hl-red">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => close(true)}
            className="flex-1 py-2.5 rounded-lg border border-hl-border text-white font-bold text-sm hover:bg-hl-panel-light transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => selected && void save(selected)}
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
