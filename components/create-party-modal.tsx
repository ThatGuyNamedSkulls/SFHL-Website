"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { UserSession, PartyView } from "@/types";
import { RANK_TIERS } from "@/data/ranks";
import { Swords, Zap, Star, Check, ChevronDown } from "lucide-react";

interface CreatePartyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: UserSession | null;
  onCreated: (party: PartyView) => void;
}

const SELECT_CLS =
  "w-full bg-hl-base border border-hl-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-hl-gold/50 transition-colors";

const LABEL_CLS = "text-[11px] header-caps text-hl-muted mb-1.5 block";

const SKILL_TIERS = RANK_TIERS.filter((t) => t.letter !== "UNRANKED");

export const PARTY_VIBES = ["Chill", "Fun", "Balanced", "Serious", "Intense"];

/** FACEIT-style match types with join rules; Super/Premium cap the party size. */
const MATCH_TYPE_OPTIONS = [
  {
    id: "Standard",
    label: "5v5 Match",
    desc: "A competitive experience, with fast balanced matches for no cost.",
    green: false,
    icon: Swords,
    maxSize: 5,
  },
  {
    id: "Super",
    label: "5v5 Super Match",
    desc: "Better balanced matches with extra join requirements. Max party size: 3.",
    green: true,
    icon: Zap,
    maxSize: 3,
  },
  {
    id: "Premium",
    label: "5v5 Premium Match",
    desc: "Most exclusive matchmaking experience for verified players. Max party size: 2.",
    green: true,
    icon: Star,
    maxSize: 2,
  },
];

/** Small switch-style toggle (FACEIT look). */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full shrink-0 transition-colors ${
        checked ? "bg-gold-gradient" : "bg-hl-border"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function CreatePartyModal({ open, onOpenChange, session, onCreated }: CreatePartyModalProps) {
  const [name, setName] = useState("");
  const [game] = useState("Blox Strike");
  const [gameMode, setGameMode] = useState("5v5");
  const [matchType, setMatchType] = useState("Standard");
  const [matchTypeOpen, setMatchTypeOpen] = useState(false);
  const [minSkill, setMinSkill] = useState("D");
  const [maxSkill, setMaxSkill] = useState("STAR");
  const [vibe, setVibe] = useState("Balanced");
  const [language, setLanguage] = useState("Any");
  const [countries, setCountries] = useState("Any");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [voiceRequired, setVoiceRequired] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = MATCH_TYPE_OPTIONS.find((t) => t.id === matchType) ?? MATCH_TYPE_OPTIONS[0];

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || `team_${session?.username ?? "SFHL"}`,
          game,
          gameMode,
          matchType,
          region: "EU",
          maxSize: selectedType.maxSize,
          minSkill,
          maxSkill,
          language,
          countries,
          verifiedOnly,
          voiceRequired,
          isPrivate,
          vibe,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create party");
      } else {
        onCreated(data.party as PartyView);
        onOpenChange(false);
      }
    } catch {
      setError("An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-hl-panel border border-hl-border sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-black text-white text-center">Create party</DialogTitle>
        </DialogHeader>

        {!session ? (
          <div className="text-sm text-hl-muted py-6 text-center">
            You must be logged in to create a party.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Party name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`team_${session.username}`}
                  className={SELECT_CLS}
                  maxLength={40}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Game</label>
                <select className={SELECT_CLS} value={game} disabled>
                  <option>Blox Strike</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Game mode</label>
                <select className={SELECT_CLS} value={gameMode} onChange={(e) => setGameMode(e.target.value)}>
                  <option value="5v5">Europe 5v5 Queue</option>
                  <option value="2v2">Europe 2v2 Queue</option>
                  <option value="1v1">Europe 1v1 Queue</option>
                </select>
              </div>
              <div className="relative">
                <label className={LABEL_CLS}>Match type</label>
                <button
                  type="button"
                  onClick={() => setMatchTypeOpen((o) => !o)}
                  className={`${SELECT_CLS} flex items-center justify-between text-left ${
                    matchTypeOpen ? "border-hl-gold" : ""
                  }`}
                >
                  <span className={selectedType.green ? "text-hl-green font-semibold" : ""}>
                    {selectedType.label}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-hl-muted transition-transform ${matchTypeOpen ? "rotate-180" : ""}`} />
                </button>
                {matchTypeOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-hl-border bg-hl-base shadow-xl overflow-hidden">
                    {MATCH_TYPE_OPTIONS.map((t) => {
                      const Icon = t.icon;
                      const active = t.id === matchType;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setMatchType(t.id);
                            setMatchTypeOpen(false);
                          }}
                          className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                            active ? "bg-hl-panel-light/70" : "hover:bg-hl-panel-light/40"
                          }`}
                        >
                          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${t.green ? "text-hl-green" : "text-white"}`} />
                          <span className="flex-1 min-w-0">
                            <span className={`block text-sm font-bold ${t.green ? "text-hl-green" : "text-white"}`}>
                              {t.label}
                            </span>
                            <span className="block text-[11px] text-hl-muted leading-snug mt-0.5">{t.desc}</span>
                          </span>
                          {active && <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Party members preview */}
            <div>
              <label className={LABEL_CLS}>Party members</label>
              <div className="grid grid-cols-5 gap-2 p-2 rounded-xl border border-hl-border bg-hl-base/50">
                <div className="rounded-lg border border-hl-border bg-hl-panel flex flex-col items-center justify-center gap-1.5 py-3 px-1">
                  <Avatar className="w-10 h-10 border border-hl-border">
                    {session.avatar ? <AvatarImage src={session.avatar} /> : null}
                    <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
                      {session.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[9px] font-bold text-white max-w-full truncate px-1">
                    {session.playerName || session.username}
                  </span>
                  <RankBadge rank="UNRANKED" size="sm" showGlow={false} className="!w-4 !h-4" />
                </div>
                {Array.from({ length: selectedType.maxSize - 1 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-dashed border-hl-border/70 min-h-[92px]"
                  />
                ))}
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Skill level</label>
              <div className="grid grid-cols-2 gap-3">
                <select className={SELECT_CLS} value={minSkill} onChange={(e) => setMinSkill(e.target.value)}>
                  {SKILL_TIERS.map((t) => (
                    <option key={t.letter} value={t.letter}>{t.name}</option>
                  ))}
                </select>
                <select className={SELECT_CLS} value={maxSkill} onChange={(e) => setMaxSkill(e.target.value)}>
                  {SKILL_TIERS.map((t) => (
                    <option key={t.letter} value={t.letter}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Vibe</label>
              <div className="flex items-center gap-2 flex-wrap">
                {PARTY_VIBES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVibe(v)}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                      vibe === v
                        ? "bg-gold-gradient text-hl-base border-transparent"
                        : "border-hl-border text-hl-muted hover:text-white"
                    }`}
                  >
                    ✦ {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Language</label>
                <select className={SELECT_CLS} value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option>Any</option>
                  <option>English</option>
                  <option>Portuguese</option>
                  <option>Spanish</option>
                  <option>German</option>
                  <option>French</option>
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Countries</label>
                <select className={SELECT_CLS} value={countries} onChange={(e) => setCountries(e.target.value)}>
                  <option>Any</option>
                  <option>Portugal</option>
                  <option>United Kingdom</option>
                  <option>Germany</option>
                  <option>France</option>
                  <option>Spain</option>
                </select>
              </div>
            </div>

            {/* Requirement toggles */}
            <div className="space-y-4 pt-1">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-white">Verification required</div>
                  <div className="text-xs text-hl-muted mt-0.5">
                    Your party will only be available to verified members
                  </div>
                </div>
                <Toggle checked={verifiedOnly} onChange={setVerifiedOnly} />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    Voice required
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-gold-gradient text-hl-base header-caps">New</span>
                  </div>
                  <div className="text-xs text-hl-muted mt-0.5">
                    Party members automatically join voice chat when joining the party
                  </div>
                </div>
                <Toggle checked={voiceRequired} onChange={setVoiceRequired} />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-white">Private party</div>
                  <div className="text-xs text-hl-muted mt-0.5">
                    Hidden from the party list — joinable only via invite
                  </div>
                </div>
                <Toggle checked={isPrivate} onChange={setIsPrivate} />
              </div>
            </div>

            {error && <div className="text-sm text-hl-red">{error}</div>}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-hl-border">
              <button
                onClick={() => onOpenChange(false)}
                className="px-4 py-2.5 rounded-lg text-hl-muted font-bold text-sm header-caps hover:text-white transition-colors"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="px-6 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm header-caps hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
