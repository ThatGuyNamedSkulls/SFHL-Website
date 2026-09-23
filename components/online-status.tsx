"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSession } from "@/components/session-provider";

const HEARTBEAT_MS = 60_000;
const POLL_MS = 30_000;

/* --- heartbeat -------------------------------------------------------------- */

/** Keeps the signed-in user marked online while a tab is visible. */
export function PresenceHeartbeat() {
  const { session } = useSession();
  const discordId = session?.discordId;

  useEffect(() => {
    if (!discordId) return;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/presence", { method: "POST", keepalive: true }).catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    const onLeave = () => {
      try {
        navigator.sendBeacon("/api/presence?leave=1");
      } catch {
        /* best effort — the online window expires on its own */
      }
    };
    beat();
    const id = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [discordId]);

  return null;
}

/* --- shared online store ------------------------------------------------------
 * Every mounted useOnline() registers the names / Discord ids it cares about.
 * One batched request refreshes all of them, so a page full of avatars costs a
 * single poll instead of one per avatar.
 */

const watchers = new Map<string, number>(); // "n:name" | "i:id" -> ref count
const online = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let pollTimer: number | null = null;
let fetchTimer: number | null = null;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

async function refresh() {
  fetchTimer = null;
  const keys = Array.from(watchers.keys());
  if (keys.length === 0) return;
  const names = keys.filter((k) => k.startsWith("n:")).map((k) => k.slice(2));
  const ids = keys.filter((k) => k.startsWith("i:")).map((k) => k.slice(2));
  const params = new URLSearchParams();
  if (names.length) params.set("names", names.join(","));
  if (ids.length) params.set("ids", ids.join(","));
  try {
    const res = await fetch(`/api/presence?${params}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { names?: string[]; ids?: string[] };
    online.clear();
    (data.names ?? []).forEach((n) => online.add(`n:${n}`));
    (data.ids ?? []).forEach((i) => online.add(`i:${i}`));
    emit();
  } catch {
    /* keep the last known state */
  }
}

function scheduleRefresh() {
  if (typeof window === "undefined" || fetchTimer !== null) return;
  fetchTimer = window.setTimeout(refresh, 60);
}

function watch(keys: string[]): () => void {
  let added = false;
  for (const k of keys) {
    const n = watchers.get(k) ?? 0;
    if (n === 0) added = true;
    watchers.set(k, n + 1);
  }
  if (added) scheduleRefresh();
  if (pollTimer === null) pollTimer = window.setInterval(refresh, POLL_MS);
  return () => {
    for (const k of keys) {
      const n = (watchers.get(k) ?? 1) - 1;
      if (n <= 0) watchers.delete(k);
      else watchers.set(k, n);
    }
    if (watchers.size === 0 && pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Live online lookup for player names and/or Discord ids.
 * Returns `isOnline({ name, id })`, true if either key is online.
 */
export function useOnline(query: { names?: (string | null | undefined)[]; ids?: (string | null | undefined)[] }) {
  const out = new Set<string>();
  (query.names ?? []).forEach((n) => n && out.add(`n:${n}`));
  (query.ids ?? []).forEach((i) => i && out.add(`i:${i}`));
  // A stable string, so a new array with the same members doesn't re-watch.
  const keyString = Array.from(out).sort().join("|");
  const keys = useMemo(() => (keyString ? keyString.split("|") : []), [keyString]);

  useEffect(() => (keys.length ? watch(keys) : undefined), [keys]);
  useSyncExternalStore(subscribe, () => version, () => 0);

  return (who: { name?: string | null; id?: string | null }) =>
    (!!who.name && online.has(`n:${who.name}`)) || (!!who.id && online.has(`i:${who.id}`));
}

/* --- UI ------------------------------------------------------------------------ */

/** Wraps an avatar and pins a green dot to its corner while the player is online. */
export function OnlineBadge({
  online: isOnline,
  children,
  size = "sm",
  className = "",
}: {
  online: boolean;
  children: React.ReactNode;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const dot = size === "xs" ? "w-2 h-2" : size === "md" ? "w-3.5 h-3.5" : "w-2.5 h-2.5";
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      {children}
      {isOnline ? (
        <span
          title="Online on the website"
          aria-label="Online"
          className={`absolute -bottom-0.5 -right-0.5 ${dot} rounded-full bg-hl-green ring-2 ring-[#161616] z-10`}
        />
      ) : null}
    </span>
  );
}

/** Small "Online" / "Offline" label for profile headers and lists. */
export function OnlineLabel({ online: isOnline }: { online: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${isOnline ? "text-hl-green" : "text-hl-muted"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-hl-green" : "bg-hl-muted/60"}`} />
      {isOnline ? "Online" : "Offline"}
    </span>
  );
}
