"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Crown, Headphones, Plus, Search, UsersRound, X } from "lucide-react";
import { UserSession, RankTierLetter } from "@/types";
import { RankBadge } from "@/components/rank-badge";
import { MATCH_MODE_LABEL, PARTY_MAX_SIZE } from "@/lib/match-mode";
import { RailBadge } from "@/components/rail-badge";

interface PartyMember {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  rank: string;
}

interface PartyLite {
  id: string;
  name: string;
  leaderId: string;
  maxSize: number;
  members: PartyMember[];
  voiceChannelUrl?: string | null;
}

interface SearchHit {
  name: string;
  avatar: string | null;
  rank: string;
}

/** Right-rail My Party flyout + instant invite search. */
export function MyPartyRail() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [inviteMode, setInviteMode] = useState(false);
  const [session, setSession] = useState<UserSession | null>(null);
  const [party, setParty] = useState<PartyLite | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    try {
      const [meRes, pRes] = await Promise.all([fetch("/api/auth/me"), fetch("/api/parties")]);
      const me = meRes.ok ? await meRes.json() : null;
      const user = (me?.user as UserSession | undefined) ?? null;
      setSession(user);
      const data = pRes.ok ? await pRes.json() : { parties: [] };
      const mine =
        user &&
        (data.parties as PartyLite[] | undefined)?.find((p) =>
          p.members.some((m) => m.discordId === user.discordId)
        );
      setParty(mine ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open && inviteMode) searchRef.current?.focus();
  }, [open, inviteMode, party]);

  useEffect(() => {
    const q = query.trim();
    if (!inviteMode || q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setHits(data.players ?? []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, inviteMode]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const openPanel = (invite: boolean) => {
    setInviteMode(invite);
    setOpen(true);
    setQuery("");
    setHits([]);
  };

  const createParty = async () => {
    if (!session) {
      window.location.href = "/login";
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Party",
          gameMode: MATCH_MODE_LABEL,
          matchType: "Standard",
          maxSize: PARTY_MAX_SIZE,
        }),
      });
      const data = await res.json();
      if (!res.ok) flash(data.error || "Failed to create party");
      else {
        await load();
        if (data.party?.voiceChannelUrl) {
          flash("Party voice is ready — click the headphones to join Discord.");
        } else {
          flash("Party created. Discord voice wasn't created — check the bot token and channel permissions.");
        }
      }
    } catch {
      flash("Failed to create party");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!party) return;
    setBusy(true);
    try {
      await fetch(`/api/parties/${party.id}/leave`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const kick = async (discordId: string) => {
    if (!party) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/parties/${party.id}/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) flash(data.error || "Failed to kick");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const invite = async (toName: string) => {
    if (!party) {
      flash("Create a party first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/parties/${party.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toName }),
      });
      const data = await res.json();
      if (!res.ok) flash(data.error || "Failed to invite");
      else if (data.status === "pending") flash("Invite already sent.");
      else flash(`Invited ${toName}.`);
      setQuery("");
      setHits([]);
    } catch {
      flash("Failed to invite");
    } finally {
      setBusy(false);
    }
  };

  const isLeader = !!(session && party && party.leaderId === session.discordId);
  const iconBtn =
    "flex items-center justify-center w-9 h-8 text-[#8a8a8a] hover:text-white hover:bg-white/5";

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex flex-col items-center rounded-lg border border-white/10">
        <button
          type="button"
          title="My Party"
          onClick={() => openPanel(false)}
          className={`${iconBtn} relative ${open && !inviteMode ? "text-[#ff5500]" : ""}`}
        >
          <span className="relative">
            <UsersRound className="w-4 h-4" strokeWidth={1.75} />
            {party ? <RailBadge count={party.members.length} /> : null}
          </span>
        </button>
        {party?.members.map((m) => {
          const label = m.playerName || m.username;
          return (
            <button
              key={m.discordId}
              type="button"
              title={label}
              onClick={() => openPanel(false)}
              className="flex items-center justify-center w-9 h-8 hover:bg-white/5"
            >
              {m.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.avatar} alt="" referrerPolicy="no-referrer" className="w-[22px] h-[22px] rounded-md object-cover" />
              ) : (
                <span className="w-[22px] h-[22px] rounded-md bg-[#2a2a2a] text-[8px] font-bold text-[#ff5500] flex items-center justify-center">
                  {label.slice(0, 2).toUpperCase()}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          title="Invite to party"
          onClick={() => openPanel(true)}
          className={`${iconBtn} border-t border-white/10 ${open && inviteMode ? "text-[#ff5500]" : ""}`}
        >
          <Plus className="w-4 h-4" strokeWidth={1.75} />
        </button>
        {party?.voiceChannelUrl ? (
          <a
            href={party.voiceChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Join party voice"
            className={`${iconBtn} border-t border-white/10 text-[#8a8a8a] hover:text-[#57F287]`}
          >
            <Headphones className="w-4 h-4" strokeWidth={1.75} />
          </a>
        ) : null}
      </div>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[80] w-[300px] max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-[#161616] shadow-2xl"
            style={{
              right: 56,
              top: wrapRef.current?.getBoundingClientRect().top ?? 120,
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="text-sm font-black text-white header-caps">My Party</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 text-[#8a8a8a] hover:text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {notice && (
              <div className="mx-3 mt-3 px-3 py-2 rounded-md bg-[#ff5500]/15 text-[#ff5500] text-xs">
                {notice}
              </div>
            )}

            {!session ? (
              <div className="p-4 text-sm text-[#8a8a8a]">
                <Link href="/login" className="text-[#ff5500] font-bold hover:underline">
                  Log in
                </Link>{" "}
                to create a party.
              </div>
            ) : !party ? (
              <div className="p-4 space-y-3">
                <p className="text-sm text-[#8a8a8a]">
                  {inviteMode
                    ? "Create a party first, then you can invite players."
                    : "You're not in a party."}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={createParty}
                  className="w-full h-9 rounded-md bg-gold-gradient text-hl-base text-xs font-black header-caps disabled:opacity-50"
                >
                  {busy ? "Creating…" : "Create party"}
                </button>
              </div>
            ) : (
              <div className="p-3 space-y-1">
                {party.members.map((m) => {
                  const self = m.discordId === session.discordId;
                  const leader = m.discordId === party.leaderId;
                  const label = m.playerName || m.username;
                  return (
                    <div
                      key={m.discordId}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/[0.04]"
                    >
                      {m.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.avatar} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-md object-cover" />
                      ) : (
                        <span className="w-8 h-8 rounded-md bg-[#1a1a1a] text-[10px] font-bold text-[#ff5500] flex items-center justify-center">
                          {label.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-white truncate">{label}</span>
                          {leader && <Crown className="w-3.5 h-3.5 text-[#ff5500] shrink-0" />}
                        </div>
                        {isLeader && self && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={leave}
                            className="text-[11px] text-[#8a8a8a] hover:text-white"
                          >
                            Leave party
                          </button>
                        )}
                        {isLeader && !self && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => kick(m.discordId)}
                            className="text-[11px] text-hl-red hover:underline"
                          >
                            Kick
                          </button>
                        )}
                      </div>
                      <RankBadge
                        rank={(m.rank || "UNRANKED") as RankTierLetter}
                        size="sm"
                        showGlow={false}
                        className="!w-5 !h-5"
                      />
                    </div>
                  );
                })}
                {isLeader &&
                  Array.from({ length: Math.max(0, party.maxSize - party.members.length) }).map(
                    (_, i) => (
                      <button
                        key={`empty-${i}`}
                        type="button"
                        onClick={() => setInviteMode(true)}
                        className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-[#8a8a8a] hover:bg-white/[0.04]"
                      >
                        <span className="w-8 h-8 rounded-md border border-dashed border-white/15 flex items-center justify-center">
                          <Plus className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-xs">Invite player</span>
                      </button>
                    )
                  )}
                {party.voiceChannelUrl && (
                  <a
                    href={party.voiceChannelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 w-full flex items-center gap-2 rounded-lg px-2 py-2 text-[#57F287] hover:bg-white/[0.04]"
                  >
                    <Headphones className="w-4 h-4" />
                    <span className="text-xs font-bold">Join party voice</span>
                  </a>
                )}
              </div>
            )}

            {session && party && inviteMode && (
              <div className="px-3 pb-3 border-t border-white/10 pt-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#8a8a8a] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search players to invite…"
                    className="w-full bg-[#111] border border-white/10 rounded-md pl-8 pr-2 py-2 text-sm text-white placeholder:text-[#6a6a6a] focus:outline-none focus:border-[#ff5500]/50"
                  />
                </div>
                {query.trim().length >= 2 && (
                  <div className="mt-2 rounded-md border border-white/10 overflow-hidden">
                    {searching && hits.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[#8a8a8a]">Searching…</div>
                    ) : hits.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[#8a8a8a]">No players found.</div>
                    ) : (
                      hits.map((h) => (
                        <button
                          key={h.name}
                          type="button"
                          disabled={busy || party.members.some((m) => m.playerName === h.name)}
                          onClick={() => invite(h.name)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.05] disabled:opacity-40"
                        >
                          {h.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={h.avatar} alt="" referrerPolicy="no-referrer" className="w-6 h-6 rounded object-cover" />
                          ) : (
                            <span className="w-6 h-6 rounded bg-[#1a1a1a] text-[9px] font-bold text-[#ff5500] flex items-center justify-center">
                              {h.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <span className="text-sm text-white truncate flex-1">{h.name}</span>
                          <span className="text-[11px] font-bold text-[#ff5500]">Invite</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
