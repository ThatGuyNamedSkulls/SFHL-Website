"use client";

import { Globe, Lock } from "lucide-react";
import { ClubMark } from "@/components/club-identity";
import { INPUT, NativeSelect, TaggedName } from "@/components/clans/ui";
import { DEFAULT_PROFILE_BACKGROUNDS } from "@/lib/profile-backgrounds";
import { QUEUE_REGIONS, regionMeta } from "@/lib/regions";

export interface ClanDraft {
  name: string;
  tag: string;
  description: string;
  rules: string;
  logoUrl: string;
  accentColor: string;
  private: boolean;
  region: string;
}

const LABEL = "flex flex-col gap-1.5 text-[0.8125rem] font-semibold text-[#ededed]";
const HINT = "text-xs font-normal text-[#8a8a8a]";

/**
 * The clan's profile fields (Create dialog and Manage › Clan profile): labeled,
 * with hints. `ownerOnly` locks name, tag and joining for staff who aren't the owner.
 */
export function ClanProfileFields({
  value,
  onChange,
  ownerOnly = false,
  showRegion = false,
}: {
  value: ClanDraft;
  onChange: (next: ClanDraft) => void;
  ownerOnly?: boolean;
  showRegion?: boolean;
}) {
  const set = (patch: Partial<ClanDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-1 gap-x-3.5 gap-y-4 sm:grid-cols-[minmax(0,1fr)_8.75rem]">
      <label className={LABEL}>
        Name
        <input
          className={INPUT}
          value={value.name}
          disabled={ownerOnly}
          maxLength={40}
          onChange={(e) => set({ name: e.target.value.slice(0, 40) })}
        />
        <span className={HINT}>3 to 40 characters</span>
      </label>
      <label className={LABEL}>
        Tag
        <input
          className={`${INPUT} tracking-[0.1em]`}
          value={value.tag}
          disabled={ownerOnly}
          onChange={(e) => set({ tag: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) })}
        />
        <span className={HINT}>2 to 5, A–Z and 0–9</span>
      </label>
      <label className={`${LABEL} sm:col-span-2`}>
        <span className="flex justify-between gap-2">
          Description <span className={HINT}>{value.description.length}/280</span>
        </span>
        <input
          className={INPUT}
          value={value.description}
          onChange={(e) => set({ description: e.target.value.slice(0, 280) })}
          placeholder="What the clan is about"
        />
        <span className={HINT}>Shown in the clan list and in link previews.</span>
      </label>
      <label className={`${LABEL} sm:col-span-2`}>
        <span className="flex justify-between gap-2">
          Rules <span className={HINT}>Optional, one per line</span>
        </span>
        <textarea
          className={`${INPUT} h-auto min-h-24 resize-y py-2 leading-relaxed`}
          value={value.rules}
          onChange={(e) => set({ rules: e.target.value.slice(0, 2000) })}
          placeholder="Be on time for scrims"
        />
      </label>
      <label className={`${LABEL} sm:col-span-2`}>
        <span className="flex justify-between gap-2">
          Logo <span className={HINT}>Optional</span>
        </span>
        <input
          className={INPUT}
          value={value.logoUrl}
          onChange={(e) => set({ logoUrl: e.target.value.slice(0, 500) })}
          placeholder="https://"
        />
        <span className={HINT}>An https link to a square image. Without one, the tag is used.</span>
      </label>
      <div className={`${LABEL} sm:col-span-2`}>
        Color
        <div className="flex flex-wrap gap-[0.4375rem]">
          {DEFAULT_PROFILE_BACKGROUNDS.map((bg) => (
            <button
              key={bg.slug}
              type="button"
              title={bg.name}
              aria-label={bg.name}
              aria-pressed={value.accentColor === bg.color}
              onClick={() => set({ accentColor: bg.color })}
              className={`h-6 w-6 rounded-md ${
                value.accentColor === bg.color
                  ? "shadow-[0_0_0_2px_#1c1c1c,0_0_0_3px_#e8e8e8]"
                  : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]"
              }`}
              style={{ backgroundColor: bg.color }}
            />
          ))}
        </div>
        <span className={HINT}>Used for the page header, the cards and the tag logo.</span>
      </div>
      <div className={`${LABEL} sm:col-span-2`}>
        <span>
          Joining {ownerOnly ? <span className={HINT}>· owner only</span> : null}
        </span>
        <div className="flex flex-col gap-2">
          {[
            { v: false, icon: Globe, title: "Open", text: "Anyone can join." },
            { v: true, icon: Lock, title: "Invite only", text: "Players send a request or use an invite link." },
          ].map((o) => (
            <button
              key={o.title}
              type="button"
              disabled={ownerOnly}
              onClick={() => set({ private: o.v })}
              className="flex items-start gap-2.5 text-left font-normal text-[#bdbdbd] disabled:opacity-60"
            >
              <span
                className={`mt-0.5 h-4 w-4 shrink-0 rounded-full ${
                  value.private === o.v ? "border-[5px] border-[#ff5500]" : "border-[1.5px] border-[#555]"
                }`}
              />
              <span>
                <b className="mr-1.5 font-semibold text-[#ededed]">{o.title}</b>
                <span className="text-[0.8125rem] text-[#8a8a8a]">{o.text}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {showRegion ? (
        <label className={LABEL}>
          Region
          <NativeSelect value={value.region} onChange={(e) => set({ region: e.target.value })}>
            {QUEUE_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}
    </div>
  );
}

/** How the clan header will look, and the viewer's name with the tag. */
export function ClanPreview({ value, playerName }: { value: ClanDraft; playerName?: string | null }) {
  const tag = value.tag || "TAG";
  return (
    <div className="flex flex-col gap-2 self-start">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[#8a8a8a]">Preview</span>
      <div className="overflow-hidden rounded-[0.625rem] border border-white/[0.07] bg-[#161616]">
        <div
          className="flex items-center gap-3 p-3.5"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${value.accentColor} 16%, #161616), #161616)` }}
        >
          <ClubMark tag={tag} accentColor={value.accentColor} logoUrl={/^https:\/\//.test(value.logoUrl) ? value.logoUrl : null} size={48} />
          <div className="min-w-0">
            <div className="truncate">
              <b className="text-base font-bold text-[#ededed]">{value.name || "Clan name"}</b>{" "}
              <span className="text-[0.8125rem] font-semibold text-[#ff5500]">[{tag}]</span>
            </div>
            <div className="mt-0.5 text-xs text-[#8a8a8a]">
              {value.private ? "Invite only" : "Open"} · {regionMeta(value.region || "EU").label}
            </div>
          </div>
        </div>
        {playerName ? (
          <div className="border-t border-white/[0.07] px-3.5 py-3 text-[0.8125rem] text-[#bdbdbd]">
            Your name shows as <TaggedName tag={tag} name={playerName} className="font-semibold text-[#ededed]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
