"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { PlayerSearch } from "@/components/player-search";

/** FACEIT-style search panel opened from the left icon rail. */
export function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[max(12vh,env(safe-area-inset-top))] px-3 sm:px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close search"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl rounded-xl border border-hl-border bg-hl-panel shadow-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-white header-caps">Search players</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-hl-muted hover:text-white"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <PlayerSearch autoFocus placeholder="Search players…" onNavigate={onClose} />
      </div>
    </div>
  );
}
