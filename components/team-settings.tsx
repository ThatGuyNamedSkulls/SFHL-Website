"use client";

/**
 * Team page actions (docs/LEAGUE_V2_PLAN.md D4): the header buttons (share,
 * accept/decline an invite, leave) and the captain's Settings tab (edit the
 * team, invite into a slot, roles — 5 main roster, 6 subs, 1 coach — captain,
 * kick, delete) plus Match Staff's league status. Posts to /api/teams/[id]
 * and /api/league/admin, then refreshes the server-rendered page.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Crown, Link2, LogOut, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import { ClubColorPicker } from "@/components/club-identity";
import { QUEUE_REGIONS } from "@/lib/regions";
import { ROLE_LIMITS, type RosterSlot } from "@/lib/team-roster";
import type { MemberCard } from "@/lib/team-page";

async function call(teamId: string, body: Record<string, unknown> | null, method = "POST"): Promise<string | null> {
  const res = await fetch(`/api/teams/${teamId}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return json.error || "Something went wrong.";
}

const btn =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-black/30 px-3 text-xs font-black uppercase tracking-wide text-white hover:border-white/35 disabled:opacity-40";
const primary =
  "find-match-btn inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-xs font-black uppercase tracking-wide text-hl-base disabled:opacity-40";
const field =
  "h-10 w-full rounded-lg border border-white/[0.12] bg-[#1b1b1b] px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#ff5500]";
const label = "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55";

export function TeamHeaderActions({
  teamId,
  invited,
  member,
  captain,
}: {
  teamId: string;
  invited: boolean;
  member: boolean;
  captain: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: Record<string, unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const err = await call(teamId, body);
    setBusy(false);
    if (err) setError(err);
    else (after ?? (() => router.refresh()))();
  };
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {invited ? (
          <>
            <button type="button" disabled={busy} onClick={() => run({ action: "respond", accept: true })} className={primary}>
              <Check className="h-3.5 w-3.5" /> Accept invite
            </button>
            <button type="button" disabled={busy} onClick={() => run({ action: "respond", accept: false })} className={btn}>
              <X className="h-3.5 w-3.5" /> Decline
            </button>
          </>
        ) : null}
        {member && !captain ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => window.confirm("Leave this team?") && run({ action: "leave" }, () => router.push("/teams"))}
            className={btn}
          >
            <LogOut className="h-3.5 w-3.5" /> Leave
          </button>
        ) : null}
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href.split("?")[0]);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked: nothing to do */
            }
          }}
          className={btn}
        >
          <Link2 className="h-3.5 w-3.5" /> {copied ? "Copied" : "Share"}
        </button>
      </div>
      {error ? <p className="text-xs text-hl-red">{error}</p> : null}
    </div>
  );
}

const SLOT_LABEL: Record<RosterSlot, string> = { starter: "Main roster", sub: "Substitute", coach: "Coach" };

export function TeamSettings({
  team,
  members,
  captain,
  staff,
  statusCode,
  slots,
}: {
  team: { id: string; name: string; tag: string; region: string; logoUrl: string | null; bannerUrl: string | null; accentColor: string; description: string | null };
  members: MemberCard[];
  captain: boolean;
  staff: boolean;
  /** The stored league status ("main"), or null = Open by skill. */
  statusCode: string | null;
  slots: Record<RosterSlot, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({ ...team, logoUrl: team.logoUrl ?? "", bannerUrl: team.bannerUrl ?? "", description: team.description ?? "" });
  const [invite, setInvite] = useState({ name: "", slot: "" });

  const run = async (body: Record<string, unknown> | null, method = "POST", after?: () => void) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const err = await call(team.id, body, method);
    setBusy(false);
    if (err) setError(err);
    else (after ?? (() => router.refresh()))();
  };
  const card = "rounded-xl border border-white/[0.08] bg-[#121212] p-4 sm:p-5";

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-lg border border-hl-red/30 bg-hl-red/10 px-3 py-2 text-sm text-hl-red">{error}</p> : null}

      {staff ? (
        <section className={card}>
          <h2 className="mb-1 text-base font-black text-white">League status (Match Staff)</h2>
          <p className="mb-3 text-xs text-white/55">
            Earned by promotion and relegation each season; change it here only to correct it.
          </p>
          <select
            value={statusCode ?? "open"}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              setError(null);
              const res = await fetch("/api/league/admin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "setAccess", teamId: team.id, access: e.target.value }),
              });
              const json = await res.json().catch(() => ({}));
              setBusy(false);
              if (!res.ok) setError(json.error || "Couldn't change the league status.");
              else router.refresh();
            }}
            className={`${field} max-w-xs`}
          >
            <option value="open">Open (by skill)</option>
            <option value="pro">Pro status</option>
            <option value="advanced">Advanced status</option>
            <option value="main">Main status</option>
            <option value="intermediate">Intermediate status</option>
            <option value="entry">Entry status</option>
            <option value="open10">Open 10 status (earned)</option>
          </select>
        </section>
      ) : null}

      {captain ? (
        <>
          <section className={card}>
            <h2 className="mb-3 text-base font-black text-white">Team details</h2>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_160px]">
              <label>
                <span className={label}>Name</span>
                <input value={f.name} maxLength={32} onChange={(e) => setF({ ...f, name: e.target.value })} className={field} />
              </label>
              <label>
                <span className={label}>Tag</span>
                <input
                  value={f.tag}
                  onChange={(e) => setF({ ...f, tag: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) })}
                  className={`${field} tracking-widest`}
                />
              </label>
              <label>
                <span className={label}>Region</span>
                <select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} className={field}>
                  {QUEUE_REGIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label>
                <span className={label}>Logo URL</span>
                <input value={f.logoUrl} maxLength={500} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder="https://…" className={field} />
              </label>
              <label>
                <span className={label}>Banner URL</span>
                <input value={f.bannerUrl} maxLength={500} onChange={(e) => setF({ ...f, bannerUrl: e.target.value })} placeholder="https://… (wide image)" className={field} />
              </label>
            </div>
            <label className="mt-3 block">
              <span className={label}>About</span>
              <textarea
                rows={4}
                maxLength={500}
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
                placeholder="Who you are, what you're aiming for, when you play…"
                className={`${field} h-auto py-2`}
              />
            </label>
            <div className="mt-3">
              <span className={label}>Colour</span>
              <ClubColorPicker value={f.accentColor} onChange={(c) => setF({ ...f, accentColor: c })} />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    {
                      name: f.name,
                      tag: f.tag,
                      region: f.region,
                      logoUrl: f.logoUrl || null,
                      bannerUrl: f.bannerUrl || null,
                      description: f.description || null,
                      accentColor: f.accentColor,
                    },
                    "PATCH",
                    () => {
                      setSaved(true);
                      router.refresh();
                    }
                  )
                }
                className={primary}
              >
                Save
              </button>
              {saved ? <span className="text-xs font-bold text-hl-green">Saved</span> : null}
            </div>
          </section>

          <section className={card}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-black text-white">Members</h2>
              <span className="text-xs tabular-nums text-white/55">
                Main {slots.starter}/{ROLE_LIMITS.starter} · Subs {slots.sub}/{ROLE_LIMITS.sub} · Coach {slots.coach}/{ROLE_LIMITS.coach}
              </span>
            </div>
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <label className="min-w-[180px] flex-1">
                <span className={label}>Invite a player</span>
                <input
                  value={invite.name}
                  onChange={(e) => setInvite({ ...invite, name: e.target.value })}
                  placeholder="Player name"
                  className={field}
                />
              </label>
              <label>
                <span className={label}>Slot</span>
                <select value={invite.slot} onChange={(e) => setInvite({ ...invite, slot: e.target.value })} className={`${field} w-44`}>
                  <option value="">First free</option>
                  <option value="starter">Main roster</option>
                  <option value="sub">Substitute</option>
                  <option value="coach">Coach</option>
                </select>
              </label>
              <button
                type="button"
                disabled={busy || invite.name.trim().length < 2}
                onClick={() =>
                  run({ action: "invite", playerName: invite.name.trim(), slot: invite.slot || undefined }, "POST", () => {
                    setInvite({ name: "", slot: "" });
                    router.refresh();
                  })
                }
                className={`${primary} h-10`}
              >
                <UserPlus className="h-4 w-4" /> Invite
              </button>
            </div>
            <ul className="divide-y divide-white/[0.06]">
              {members.map((m) => (
                <li key={m.discordId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-white">
                      {m.captain ? <Crown className="h-3.5 w-3.5 text-hl-gold" /> : null}
                      <span className="truncate">{m.name}</span>
                    </span>
                    <span className="text-[11px] text-white/50">
                      {m.captain ? "Captain · main roster" : SLOT_LABEL[m.role as RosterSlot] ?? m.role}
                      {m.invited ? " · invited" : ""}
                    </span>
                  </span>
                  {!m.captain ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {!m.invited ? (
                        <select
                          aria-label={`${m.name}'s slot`}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => run({ action: "slot", discordId: m.discordId, role: e.target.value })}
                          className="h-8 rounded-md border border-white/[0.12] bg-[#1b1b1b] px-2 text-xs text-white"
                        >
                          <option value="starter">Main roster</option>
                          <option value="sub">Substitute</option>
                          <option value="coach">Coach</option>
                        </select>
                      ) : null}
                      {!m.invited && m.role !== "coach" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => window.confirm(`Make ${m.name} the captain?`) && run({ action: "transfer", discordId: m.discordId })}
                          className="text-xs font-bold text-hl-gold hover:underline"
                        >
                          Make captain
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run({ action: "kick", discordId: m.discordId })}
                        className="inline-flex items-center gap-1 text-xs font-bold text-hl-red hover:underline"
                      >
                        <UserMinus className="h-3.5 w-3.5" /> {m.invited ? "Cancel invite" : "Kick"}
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className={`${card} border-hl-red/20`}>
            <h2 className="mb-1 text-base font-black text-white">Delete team</h2>
            <p className="mb-3 text-xs text-white/55">This can&apos;t be undone. League history stays on the league pages.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => window.confirm(`Delete ${team.name}?`) && run(null, "DELETE", () => router.push("/teams"))}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hl-red/40 px-4 text-xs font-black uppercase tracking-wide text-hl-red hover:bg-hl-red/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete team
            </button>
          </section>
        </>
      ) : null}
    </div>
  );
}
