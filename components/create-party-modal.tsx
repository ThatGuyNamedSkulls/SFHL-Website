"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserSession, PartyView } from "@/types";
import { RANK_TIERS } from "@/data/ranks";
import { Plus } from "lucide-react";

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

export function CreatePartyModal({ open, onOpenChange, session, onCreated }: CreatePartyModalProps) {
  const [name, setName] = useState("");
  const [game] = useState("Blox Strike");
  const [gameMode, setGameMode] = useState("5v5");
  const [matchType, setMatchType] = useState("Standard");
  const [region, setRegion] = useState("EU");
  const [minSkill, setMinSkill] = useState("D");
  const [maxSkill, setMaxSkill] = useState("STAR");
  const [language, setLanguage] = useState("Any");
  const [countries, setCountries] = useState("Any");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [voiceRequired, setVoiceRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || `${session?.username ?? "New"}'s party`,
          game,
          gameMode,
          matchType,
          region,
          minSkill,
          maxSkill,
          language,
          countries,
          verifiedOnly,
          voiceRequired,
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
          <DialogTitle className="text-lg font-black text-white header-caps">Create Party</DialogTitle>
        </DialogHeader>

        {!session ? (
          <div className="text-sm text-hl-muted py-6 text-center">
            You must be logged in to create a party.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={LABEL_CLS}>Party name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${session.username}'s party`}
                className={SELECT_CLS}
                maxLength={40}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Game</label>
                <select className={SELECT_CLS} value={game} disabled>
                  <option>Blox Strike</option>
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Game mode</label>
                <select className={SELECT_CLS} value={gameMode} onChange={(e) => setGameMode(e.target.value)}>
                  <option>5v5</option>
                  <option>2v2</option>
                  <option>1v1</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Match type</label>
                <select className={SELECT_CLS} value={matchType} onChange={(e) => setMatchType(e.target.value)}>
                  <option>Standard</option>
                  <option>Super</option>
                  <option>Premium</option>
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Region</label>
                <select className={SELECT_CLS} value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option>EU</option>
                  <option>NA</option>
                  <option>APAC</option>
                </select>
              </div>
            </div>

            {/* Party members preview */}
            <div>
              <label className={LABEL_CLS}>Party members</label>
              <div className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1">
                  <Avatar className="w-11 h-11 border-2 border-hl-gold/40">
                    {session.avatar ? <AvatarImage src={session.avatar} /> : null}
                    <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
                      {session.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[9px] text-hl-muted max-w-[44px] truncate">{session.username}</span>
                </div>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-11 h-11 rounded-full border-2 border-dashed border-hl-border flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4 text-hl-muted" />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Min skill level</label>
                <select className={SELECT_CLS} value={minSkill} onChange={(e) => setMinSkill(e.target.value)}>
                  {SKILL_TIERS.map((t) => (
                    <option key={t.letter} value={t.letter}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Max skill level</label>
                <select className={SELECT_CLS} value={maxSkill} onChange={(e) => setMaxSkill(e.target.value)}>
                  {SKILL_TIERS.map((t) => (
                    <option key={t.letter} value={t.letter}>{t.name}</option>
                  ))}
                </select>
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

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
                <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="accent-hl-gold" />
                Verification required
              </label>
              <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
                <input type="checkbox" checked={voiceRequired} onChange={(e) => setVoiceRequired(e.target.checked)} className="accent-hl-gold" />
                Voice required
              </label>
            </div>

            {error && <div className="text-sm text-hl-red">{error}</div>}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => onOpenChange(false)}
                className="flex-1 py-2.5 rounded-lg border border-hl-border text-white font-bold text-sm hover:bg-hl-panel-light transition-colors"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
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
