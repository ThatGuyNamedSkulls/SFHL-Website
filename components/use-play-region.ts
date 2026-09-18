"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PLAY_REGION,
  PLAY_REGIONS,
  QUEUE_LOCK_EVENT,
  QUEUE_LOCK_KEY,
  REGION_CHANGE_EVENT,
  REGION_STORAGE_KEY,
  LEADERBOARD_REGION_KEY,
  LEADERBOARD_REGION_CHANGE_EVENT,
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

function readQueueLocked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(QUEUE_LOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function setQueueLocked(locked: boolean) {
  try {
    if (locked) window.sessionStorage.setItem(QUEUE_LOCK_KEY, "1");
    else window.sessionStorage.removeItem(QUEUE_LOCK_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(QUEUE_LOCK_EVENT));
}

export function useQueueLocked() {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const sync = () => setLocked(readQueueLocked());
    sync();
    window.addEventListener(QUEUE_LOCK_EVENT, sync);
    return () => window.removeEventListener(QUEUE_LOCK_EVENT, sync);
  }, []);
  return locked;
}

export function usePlayRegion() {
  const [region, setRegionState] = useState<PlayRegionId>(DEFAULT_PLAY_REGION);
  const queueLocked = useQueueLocked();

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

  const setRegion = useCallback((next: PlayRegionId, opts?: { force?: boolean }) => {
    if (!opts?.force && readQueueLocked()) return;
    setRegionState(next);
    try {
      window.localStorage.setItem(REGION_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(REGION_CHANGE_EVENT));
  }, []);

  const meta = PLAY_REGIONS.find((r) => r.id === region) ?? PLAY_REGIONS[0];
  return { region, setRegion, meta, queueLocked };
}

function readLeaderboardRegion(): PlayRegionId {
  if (typeof window === "undefined") return "GLOBAL";
  try {
    const raw = window.localStorage.getItem(LEADERBOARD_REGION_KEY);
    if (raw && isPlayRegion(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "GLOBAL";
}

/** Rank page filter only. Does not follow the top-bar server/queue region. */
export function useLeaderboardRegion() {
  const [region, setRegionState] = useState<PlayRegionId>("GLOBAL");

  useEffect(() => {
    setRegionState(readLeaderboardRegion());
    const onChange = () => setRegionState(readLeaderboardRegion());
    window.addEventListener(LEADERBOARD_REGION_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(LEADERBOARD_REGION_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setRegion = useCallback((next: PlayRegionId) => {
    setRegionState(next);
    try {
      window.localStorage.setItem(LEADERBOARD_REGION_KEY, next);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(LEADERBOARD_REGION_CHANGE_EVENT));
  }, []);

  const meta = PLAY_REGIONS.find((r) => r.id === region) ?? PLAY_REGIONS[0];
  return { region, setRegion, meta };
}
