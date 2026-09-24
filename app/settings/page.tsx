"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSession } from "@/components/session-provider";
import { PageHeader } from "@/components/page-header";
import { CountrySelect } from "@/components/country-select";
import { LogoutButton } from "@/components/logout-button";
import { InventoryPanel } from "@/components/inventory-panel";
import { Flag } from "@/components/flag";
import { ClubMark } from "@/components/club-identity";
import { countryName, flagPath, notifyCountryChanged, COUNTRY_CHANGE_EVENT } from "@/lib/countries";
import { invalidateClientApi } from "@/lib/client-api";
import {
  User,
  Link2,
  ShieldCheck,
  ShieldAlert,
  LogOut,
  Gamepad2,
  ArrowUpRight,
  Info,
  MapPin,
  Sparkles,
  Tag,
} from "lucide-react";

interface TagClub {
  id: string;
  name: string;
  tag: string;
  accentColor: string;
  logoUrl: string | null;
}

export default function SettingsPage() {
  const { session, loaded, refresh } = useSession();
  const [country, setCountry] = useState<string | null>(null);
  const [countryDraft, setCountryDraft] = useState<string | null>(null);
  const [editingCountry, setEditingCountry] = useState(false);
  const [savingCountry, setSavingCountry] = useState(false);
  const [countryError, setCountryError] = useState<string | null>(null);
  const [countryLinked, setCountryLinked] = useState(false);
  const [tagClubs, setTagClubs] = useState<TagClub[]>([]);
  const [activeClubId, setActiveClubId] = useState<string | null>(null);
  const [displayedTag, setDisplayedTag] = useState<string | null>(null);
  const [savingTag, setSavingTag] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/players/country")
      .then((r) => r.json())
      .then((d) => {
        setCountry(d.country || null);
        setCountryDraft(d.country || null);
        setCountryLinked(!!d.linked);
      })
      .catch(() => {});
    fetch("/api/clubs/tag")
      .then((r) => r.json())
      .then((d) => {
        setTagClubs(Array.isArray(d.clubs) ? d.clubs : []);
        setActiveClubId(typeof d.activeClubId === "string" ? d.activeClubId : null);
        setDisplayedTag(typeof d.displayedTag === "string" ? d.displayedTag : null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onCountry = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (!code) return;
      setCountry(code);
      setCountryDraft(code);
      setEditingCountry(false);
    };
    window.addEventListener(COUNTRY_CHANGE_EVENT, onCountry);
    return () => window.removeEventListener(COUNTRY_CHANGE_EVENT, onCountry);
  }, []);

  const saveCountry = async () => {
    if (!countryDraft) return;
    setSavingCountry(true);
    setCountryError(null);
    try {
      const res = await fetch("/api/players/country", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: countryDraft }),
      });
      const data = await res.json().catch(() => ({}));
      const saved = typeof data.country === "string" ? data.country : null;
      if (!res.ok || !saved) {
        setCountryError(typeof data.error === "string" ? data.error : "Could not save country");
        return;
      }
      setCountry(saved);
      setCountryDraft(saved);
      setEditingCountry(false);
      try {
        sessionStorage.setItem("hl_country_saved", saved);
        sessionStorage.removeItem("hl_country_skipped");
      } catch {
        /* ignore */
      }
      notifyCountryChanged(saved);
    } finally {
      setSavingCountry(false);
    }
  };

  const saveClubTag = async (clubId: string | null) => {
    setSavingTag(true);
    setTagError(null);
    try {
      const res = await fetch("/api/clubs/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTagError(typeof data.error === "string" ? data.error : "Could not save clan tag");
        return;
      }
      setActiveClubId(typeof data.activeClubId === "string" ? data.activeClubId : null);
      setDisplayedTag(typeof data.displayedTag === "string" ? data.displayedTag : null);
      if (Array.isArray(data.clubs)) setTagClubs(data.clubs);
      invalidateClientApi("/api/auth/me");
      await refresh({ force: true });
    } finally {
      setSavingTag(false);
    }
  };

  if (!loaded) {
    return (
      <div className="hl-page py-16 text-center text-hl-muted">
        Loading settings…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="hl-page py-16 text-center">
        <h1 className="text-2xl font-bold text-white mb-3">Settings</h1>
        <p className="text-hl-muted mb-6">
          You need to be signed in to view your account settings.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gold-gradient text-hl-base font-bold hover:opacity-90 transition-opacity"
        >
          <Gamepad2 className="w-5 h-5" />
          Sign in with Discord
        </Link>
      </div>
    );
  }

  const profileHref = `/profile?player=${encodeURIComponent(
    session.playerName || session.username
  )}`;

  return (
    <div className="hl-page">
      <PageHeader
        icon={User}
        title="Settings"
        subtitle="Manage your HyperLeague account and connection"
      />

      {/* Account card */}
      <Card className="bg-hl-panel border-hl-border p-4 md:p-6 mb-6">
        <h2 className="text-sm font-bold text-white header-caps mb-4">
          Discord Account
        </h2>
        <div className="flex items-center gap-4">
          <Avatar className="w-16 h-16 border-2 border-hl-border">
            {session.avatar ? <AvatarImage src={session.avatar} /> : null}
            <AvatarFallback className="bg-hl-panel-light text-lg font-bold text-hl-gold">
              {session.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-lg font-bold text-white truncate">
              {session.username}
            </div>
            <div className="text-xs text-hl-muted break-all">Discord ID: {session.discordId}</div>
          </div>
        </div>
      </Card>

      {/* Connection card */}
      <Card className="bg-hl-panel border-hl-border p-4 md:p-6 mb-6">
        <h2 className="text-sm font-bold text-white header-caps mb-4">
          HyperLeague Connection
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-hl-border">
            <span className="text-sm text-hl-muted flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Server membership
            </span>
            {session.inGuild ? (
              <Badge className="bg-hl-green/15 text-hl-green border-0">Member</Badge>
            ) : (
              <Badge className="bg-hl-red/15 text-hl-red border-0">Not a member</Badge>
            )}
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-hl-muted flex items-center gap-2">
              <Link2 className="w-4 h-4" /> Linked player
            </span>
            {session.playerName ? (
              <Link
                href={profileHref}
                className="text-sm text-hl-gold hover:underline flex items-center gap-1"
              >
                {session.playerName} <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              <span className="text-sm text-hl-muted">None</span>
            )}
          </div>
        </div>

        {!session.playerName && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-hl-red/20 bg-hl-red/10 px-4 py-3">
            <ShieldAlert className="w-5 h-5 text-hl-red shrink-0 mt-0.5" />
            <p className="text-sm text-hl-muted">
              Your Discord account isn&apos;t linked to a HyperLeague player yet. Linking is
              done by Match Staff in Discord — your in-game name must
              match your Discord display name to appear here.
            </p>
          </div>
        )}
      </Card>

      {/* Country card (only when linked to a player) */}
      {(session.playerName || countryLinked) && (
        <Card className="bg-hl-panel border-hl-border p-4 md:p-6 mb-6">
          <h2 className="text-sm font-bold text-white header-caps mb-4 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-hl-gold" /> Country
          </h2>
          <p className="text-xs text-hl-muted mb-4">
            Your country places you on the matching regional leaderboard (EU, NA, SA, APAC, or OC).
          </p>
          {!editingCountry ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {country ? (
                  <>
                    <Flag src={flagPath(country)} name={countryName(country)} className="w-7 h-5" />
                    <span className="text-sm text-white">{countryName(country)}</span>
                  </>
                ) : (
                  <span className="text-sm text-hl-muted">No country set</span>
                )}
              </div>
              <button
                onClick={() => setEditingCountry(true)}
                className="text-sm font-semibold text-hl-gold hover:underline"
              >
                {country ? "Change" : "Set country"}
              </button>
            </div>
          ) : (
            <div>
              <CountrySelect value={countryDraft} onChange={(code) => {
                setCountryDraft(code);
                setCountryError(null);
              }} />
              {countryError && <p className="text-sm text-hl-red mt-2">{countryError}</p>}
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => {
                    setEditingCountry(false);
                    setCountryDraft(country);
                    setCountryError(null);
                  }}
                  className="flex-1 py-2 rounded-lg border border-hl-border text-white font-bold text-sm hover:bg-hl-panel-light transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveCountry}
                  disabled={!countryDraft || savingCountry}
                  className="flex-1 py-2 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {savingCountry ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {tagClubs.length > 0 && (
        <Card className="bg-hl-panel border-hl-border p-4 md:p-6 mb-6">
          <h2 className="text-sm font-bold text-white header-caps mb-4 flex items-center gap-2">
            <Tag className="w-4 h-4 text-hl-gold" /> Clan tag
          </h2>
          <p className="text-xs text-hl-muted mb-4">
            Choose which clan tag shows in front of your name. You can also hide it.
          </p>
          <div className="flex items-center gap-2 mb-4 text-sm text-white">
            <span className="text-hl-muted">Showing</span>
            {displayedTag ? (
              <span className="font-black tracking-wide text-hl-gold">[{displayedTag}]</span>
            ) : (
              <span className="text-hl-muted">no tag</span>
            )}
          </div>
          <div className="space-y-2">
            <button
              type="button"
              disabled={savingTag}
              onClick={() => void saveClubTag(null)}
              className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                !activeClubId
                  ? "border-hl-gold/60 bg-hl-gold/10 text-white"
                  : "border-hl-border text-white hover:border-hl-gold/40"
              } disabled:opacity-50`}
            >
              <span>Auto (owned clan first)</span>
              {!activeClubId ? <span className="text-xs font-bold text-hl-gold">Using</span> : null}
            </button>
            {tagClubs.map((club) => {
              const selected = activeClubId === club.id;
              return (
                <button
                  key={club.id}
                  type="button"
                  disabled={savingTag}
                  onClick={() => void saveClubTag(club.id)}
                  className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left ${
                    selected
                      ? "border-hl-gold/60 bg-hl-gold/10"
                      : "border-hl-border hover:border-hl-gold/40"
                  } disabled:opacity-50`}
                >
                  <ClubMark
                    tag={club.tag}
                    accentColor={club.accentColor}
                    logoUrl={club.logoUrl}
                    size={28}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-bold text-white">{club.name}</span>
                    <span className="ml-2 text-xs font-black tracking-wide text-hl-gold">
                      [{club.tag}]
                    </span>
                  </span>
                  {selected ? <span className="text-xs font-bold text-hl-gold">Using</span> : null}
                </button>
              );
            })}
            <button
              type="button"
              disabled={savingTag}
              onClick={() => void saveClubTag("none")}
              className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                activeClubId === "none"
                  ? "border-hl-gold/60 bg-hl-gold/10 text-white"
                  : "border-hl-border text-white hover:border-hl-gold/40"
              } disabled:opacity-50`}
            >
              <span>Hide clan tag</span>
              {activeClubId === "none" ? (
                <span className="text-xs font-bold text-hl-gold">Using</span>
              ) : null}
            </button>
          </div>
          {tagError && <p className="text-sm text-hl-red mt-3">{tagError}</p>}
        </Card>
      )}

      {/* Inventory & profile customization (only when linked to a player) */}
      {session.playerName && (
        <Card className="bg-hl-panel border-hl-border p-4 md:p-6 mb-6">
          <h2 className="text-sm font-bold text-white header-caps mb-1 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-hl-gold" /> Inventory &amp; Customization
          </h2>
          <p className="text-xs text-hl-muted mb-4">
            Equip a page background, profile card, title and up to 5 badges — they show on your public profile.
          </p>
          <InventoryPanel />
        </Card>
      )}

      {/* Info about where stats live */}
      <Card className="bg-hl-panel border-hl-border p-4 md:p-6 mb-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-hl-gold shrink-0 mt-0.5" />
          <p className="text-sm text-hl-muted">
            Your rating, rank, and match stats are managed by the HyperLeague Discord bot
            and can&apos;t be edited here. This page controls your website session and
            shows how your account is connected.
          </p>
        </div>
      </Card>

      <Card className="bg-hl-panel border-hl-border p-4 md:p-6 mb-6">
        <h2 className="text-sm font-bold text-white header-caps mb-2 flex items-center gap-2">
          <Gamepad2 className="w-4 h-4 text-hl-gold" /> Roblox login
        </h2>
        <p className="text-sm text-hl-muted">
          Discord is the current login. Roblox OAuth will link your Strike Force account
          once you create the app — steps are in the repo at{" "}
          <code className="text-hl-gold">docs/ROBLOX_OAUTH.md</code>.
        </p>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Link
          href={profileHref}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-hl-border bg-hl-panel-light hover:bg-hl-base transition-colors text-sm font-semibold text-white"
        >
          <User className="w-4 h-4" /> View my profile
        </Link>
        <LogoutButton className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-hl-red/30 bg-hl-red/10 hover:bg-hl-red/20 transition-colors text-sm font-semibold text-hl-red">
          <LogOut className="w-4 h-4" /> Log out
        </LogoutButton>
      </div>
    </div>
  );
}
