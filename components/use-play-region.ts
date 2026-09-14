"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PLAY_REGION,
  PLAY_REGIONS,
  REGION_CHANGE_EVENT,
  REGION_STORAGE_KEY,
  isPlayRegion,
  type PlayRegionId,
} from "@/lib/regions";

function readStoredRegion(): PlayRegionId {
  if (typeof window === "undefined") return DEFAULT_PLAY_REGION;
  try {
    const raw = window.localStorage.getItem(REGION_STORAGE_KEY);
    if (raw && isPlayRegion(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_PLAY_REGION;
}

export function usePlayRegion() {
  const [region, setRegionState] = useState<PlayRegionId>(DEFAULT_PLAY_REGION);

  useEffect(() => {
    setRegionState(readStoredRegion());
    const onChange = () => setRegionState(readStoredRegion());
    window.addEventListener(REGION_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(REGION_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setRegion = useCallback((next: PlayRegionId) => {
    setRegionState(next);
    try {
      window.localStorage.setItem(REGION_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(REGION_CHANGE_EVENT));
  }, []);

  const meta = PLAY_REGIONS.find((r) => r.id === region) ?? PLAY_REGIONS[0];
  return { region, setRegion, meta };
}
