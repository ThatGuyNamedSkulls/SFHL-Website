/**
 * What the Play page shows, as one pure function (docs/QUEUE_UI_PLAN.md §3).
 * Every state has one headline, one line saying why, and one primary action.
 * Safe to import from client components; tested in tests/queue-ui-state.test.ts.
 */

export type QueueUiStateId =
  | "loading"
  | "guest"
  | "setup"
  | "in_match"
  | "match_found"
  | "searching"
  | "closed"
  | "blocked"
  | "ready";

export type PrimaryAction =
  | "login"
  | "join_discord"
  | "verify"
  | "find"
  | "cancel"
  | "open_match"
  | "none";

export interface SetupStep {
  id: "discord" | "verify" | "profile";
  label: string;
  hint: string;
  done: boolean;
}

export interface QueueUi {
  state: QueueUiStateId;
  headline: string;
  detail: string | null;
  primary: { action: PrimaryAction; label: string; disabled: boolean };
  /** A helpful way out when you can't queue (e.g. join as a substitute). */
  secondary: { label: string; href: string } | null;
  steps: SetupStep[] | null;
  /** Mode and server can't change (you're queued, or a join/leave is in flight). */
  lockSelection: boolean;
}

export interface QueueUiInputs {
  loading: boolean;
  signedIn: boolean;
  inGuild: boolean;
  /** Matchmaking access (MM role or Bloxlink-verified). */
  verified: boolean;
  /** A players row is linked to this Discord account. */
  linked: boolean;
  region: string;
  regionLabel: string;
  regionIsQueueRegion: boolean;
  openRegions: string[];
  /** Open modes per open region (missing = both standard and super). */
  openModes: Record<string, string[]>;
  mode: string;
  modeLabel: string;
  queued: { region: string; mode: string } | null;
  inMatch: boolean;
  /** A ready check is waiting for everyone to accept (accept on the panel). */
  matchFound?: boolean;
  party: {
    size: number;
    isCaptain: boolean;
    /** Members who can't queue (no access / not linked). */
    blockedNames: string[];
    /** Members still in placements (Super needs everyone ranked). */
    placingNames: string[];
  } | null;
  selfPlacing: boolean;
  proEligible: boolean;
  superPartyMax: number;
  /** "join" | "leave" while a request is in flight. */
  pending: "join" | "leave" | null;
  regionLabels?: Record<string, string>;
}

const SUB_LINK = { label: "Join a live match as a sub", href: "/subs" };
const PARTY_LINK = { label: "Find a party", href: "/party-finder" };

function names(list: string[]): string {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

export function queueUiState(i: QueueUiInputs): QueueUi {
  const base = { secondary: null, steps: null, lockSelection: !!i.queued || !!i.pending };
  const find = (disabled: boolean) => ({
    action: "find" as const,
    label: i.pending === "join" ? "Joining…" : "Find match",
    disabled: disabled || !!i.pending,
  });

  if (i.loading) {
    return { ...base, state: "loading", headline: "Checking the queue…", detail: null, primary: { action: "none", label: "Checking…", disabled: true } };
  }

  if (!i.signedIn) {
    return {
      ...base,
      state: "guest",
      headline: "Ranked 5v5 Counter Blox",
      detail: "Log in with Discord to queue, climb the ranks and earn season rewards.",
      primary: { action: "login", label: "Log in with Discord", disabled: false },
    };
  }

  if (!i.inGuild || !i.verified || !i.linked) {
    const steps: SetupStep[] = [
      { id: "discord", label: "Join the HyperLeague Discord", hint: "Where matches, voice and staff live.", done: i.inGuild },
      {
        id: "verify",
        label: "Get matchmaking access",
        hint: "Press Get Matchmaking Access (or verify with Bloxlink) in the Discord.",
        done: i.inGuild && i.verified,
      },
      {
        id: "profile",
        label: "Your player profile",
        hint: "Created automatically a moment after you get access.",
        done: i.inGuild && i.verified && i.linked,
      },
    ];
    const primary: QueueUi["primary"] = !i.inGuild
      ? { action: "join_discord", label: "Join the Discord", disabled: false }
      : !i.verified
        ? { action: "verify", label: "Get matchmaking access", disabled: false }
        : { action: "none", label: "Setting up your profile…", disabled: true };
    return { ...base, state: "setup", headline: "Almost ready to play", detail: "Finish these steps once and you can queue from here.", primary, steps };
  }

  if (i.inMatch) {
    return {
      ...base,
      lockSelection: true,
      state: "in_match",
      headline: "You're in a match",
      detail: "Finish it before you queue again.",
      primary: { action: "open_match", label: "Open match room", disabled: false },
    };
  }

  if (i.matchFound) {
    return {
      ...base,
      lockSelection: true,
      state: "match_found",
      headline: "Match found",
      detail: "Accept it above within 20 seconds.",
      primary: { action: "none", label: "Match found", disabled: true },
    };
  }

  if (i.queued) {
    const label = i.regionLabels?.[i.queued.region] ?? i.queued.region;
    return {
      ...base,
      lockSelection: true,
      state: "searching",
      headline: `Searching · ${label}`,
      detail: i.party && i.party.size > 1 ? `Your party of ${i.party.size} is in the queue.` : "You're in the queue. Keep this tab open.",
      primary: { action: "cancel", label: i.pending === "leave" ? "Leaving…" : "Cancel", disabled: !!i.pending },
    };
  }

  if (i.openRegions.length === 0) {
    return {
      ...base,
      state: "closed",
      headline: "The queue is closed right now",
      detail: "Match Staff open it for play sessions. Meanwhile, jump into a live match as a substitute or find a party.",
      primary: { action: "find", label: "Queue closed", disabled: true },
      secondary: SUB_LINK,
    };
  }

  const blocked = (headline: string, detail: string | null, secondary: QueueUi["secondary"] = null): QueueUi => ({
    ...base,
    state: "blocked",
    headline,
    detail,
    primary: find(true),
    secondary,
  });

  const openList = i.openRegions.map((r) => i.regionLabels?.[r] ?? r).join(", ");
  if (!i.regionIsQueueRegion) {
    return blocked("Pick a server", `Open now: ${openList}.`);
  }
  if (!i.openRegions.includes(i.region)) {
    return blocked(`${i.regionLabel} is closed right now`, `Open now: ${openList}. Pick one of those servers to play.`);
  }
  const modes = i.openModes[i.region] ?? ["standard", "super"];
  if (!modes.includes(i.mode)) {
    return blocked(`${i.modeLabel} is closed in ${i.regionLabel}`, "Pick another match type, or wait for staff to open it.");
  }
  if (i.party && !i.party.isCaptain) {
    return blocked("Waiting for your party captain", "Only the captain can start the search for the whole party.");
  }
  if (i.party && i.party.blockedNames.length > 0) {
    return blocked(
      `${names(i.party.blockedNames)} can't queue yet`,
      "Everyone in the party needs matchmaking access in the Discord.",
      PARTY_LINK
    );
  }
  if (i.mode === "super") {
    if (i.party && i.party.size > i.superPartyMax) {
      return blocked("Super Match is for solo, duo or trio", `Your party has ${i.party.size} players. Pick Standard, or play with fewer.`);
    }
    const placing = i.selfPlacing ? ["You"] : i.party?.placingNames ?? [];
    if (placing.length > 0) {
      return blocked(
        "Super Match is for ranked players",
        i.selfPlacing ? "Finish your placement matches in Standard first." : `${names(placing)} still need to finish placements.`
      );
    }
  }
  if (i.mode === "pro" && !i.proEligible) {
    return blocked("Pro Matchmaking needs S2", "Reach 1900 Elo to unlock it.");
  }

  const size = i.party?.size ?? 1;
  return {
    ...base,
    state: "ready",
    headline: `${i.regionLabel} · ${i.modeLabel}`,
    detail: size > 1 ? `Your party of ${size} queues together.` : "Solo queue. Invite friends to fill your party.",
    primary: find(false),
  };
}
