"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";

export interface PartyMemberLite {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  rank: string;
  clubTag?: string | null;
}

export interface PartyLite {
  id: string;
  name: string;
  leaderId: string;
  maxSize: number;
  members: PartyMemberLite[];
  voiceChannelUrl?: string | null;
  invitedNames?: string[];
}

const POLL_MS = 8000;

/* One shared poll of GET /api/parties?mine=1 for every component that needs
 * the signed-in user's party (the party rail, the Social panel). */
let party: PartyLite | null = null;
let loaded = false;
let version = 0;
let subscribers = 0;
let timer: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

export async function refreshMyParty(force = false): Promise<void> {
  if (force) {
    invalidateClientApi("/api/parties?mine=1");
    invalidateClientApi("/api/parties");
  }
  try {
    const { ok, json } = await apiGetJson<{ parties?: PartyLite[] }>("/api/parties?mine=1", {
      force,
    });
    const next = ok ? json.parties?.[0] ?? null : null;
    party = next;
  } catch {
    /* keep the last known party */
  }
  loaded = true;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The signed-in user's live party (null when not in one). */
export function useMyParty(sessionId: string | null | undefined) {
  useEffect(() => {
    if (!sessionId) return;
    subscribers += 1;
    if (subscribers === 1) {
      refreshMyParty();
      timer = window.setInterval(() => refreshMyParty(), POLL_MS);
    }
    return () => {
      subscribers -= 1;
      if (subscribers === 0 && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
  }, [sessionId]);
  useSyncExternalStore(subscribe, () => version, () => 0);
  const mine =
    sessionId && party?.members.some((m) => m.discordId === sessionId) ? party : null;
  return { party: mine, loaded, refresh: refreshMyParty };
}
