"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { isProfileTab, type ProfileTab } from "@/lib/profile-link";

/**
 * The open profile tab, kept in the URL (?tab=stats) so links open it and Back
 * returns to the previous one. Changes go through history.pushState, which
 * Next.js syncs with useSearchParams without a server round trip.
 */
export function useProfileTab(): [ProfileTab, (tab: ProfileTab) => void] {
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab");
  const tab: ProfileTab = isProfileTab(raw) ? raw : "summary";

  const setTab = useCallback(
    (next: ProfileTab) => {
      if (next === tab) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === "summary") params.delete("tab");
      else params.set("tab", next);
      const query = params.toString();
      window.history.pushState(null, "", query ? `?${query}` : window.location.pathname);
    },
    [searchParams, tab]
  );

  return [tab, setTab];
}
