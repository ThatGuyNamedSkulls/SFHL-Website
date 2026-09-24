"use client";

/**
 * Find Teammates (docs/LEAGUE_UI_PLAN.md step 7) — the interactive parts:
 * the filter bar, Apply / Message buttons, the post editor and the viewer's
 * "Your recruiting" panel. Everything posts to /api/league/find, then
 * refreshes the server-rendered board.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Megaphone, MessageSquare, Pencil, Send, Trash2, UserPlus, X } from "lucide-react";
import { ClubMark } from "@/components/club-identity";
import {
  BODY_MAX,
  DAYS,
  LANGUAGES,
  MESSAGE_MAX,
  ROLES,
  TARGET_DIVISIONS,
  TIMES,
  TITLE_MAX,
  type FindFilters,
} from "@/lib/league-find-rules";
import type { ApplicationView, MyRecruiting, PlayerPostView, TeamPostView } from "@/lib/league-find";

async function post(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/league/find", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return json.error || "Something went wrong.";
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-white/10 bg-[#161616] shadow-2xl"
      >
        <div className="relative border-b border-white/[0.08] px-5 py-4">
          <h3 className="pr-8 text-lg font-black text-white">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="absolute right-4 top-4 text-white/70 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A text box without a width (the Elo boxes set their own); `input` is the full-width one. */
const field =
  "rounded-lg border border-white/[0.12] bg-[#1b1b1b] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#ff5500]";
const input = `w-full ${field}`;
const label = "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55";
const primary =
  "find-match-btn inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-5 text-xs font-black uppercase tracking-wide text-hl-base disabled:opacity-40";
const ghost =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-black uppercase tracking-wide text-white/80 hover:border-white/35 hover:text-white disabled:opacity-40";

// --- filters -------------------------------------------------------------------------------

export function FindFilterBar({ base, filters }: { base: string; filters: FindFilters }) {
  const router = useRouter();
  const go = (patch: Partial<Record<keyof FindFilters, string | null>>) => {
    const q = new URLSearchParams();
    const merged: Record<string, string | number | null> = { ...filters, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== "" && !(k === "tab" && v === "teams")) q.set(k, String(v));
    const s = q.toString();
    router.push(s ? `${base}?${s}` : base, { scroll: false });
  };
  const select = (key: "division" | "language" | "role", all: string, list: readonly (readonly [string, string])[]) => (
    <label className="min-w-[150px] flex-1 sm:flex-none">
      <span className={label}>{key}</span>
      <select value={filters[key] ?? ""} onChange={(e) => go({ [key]: e.target.value || null })} className={`${input} h-10`}>
        <option value="">{all}</option>
        {list.map(([c, n]) => (
          <option key={c} value={c}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
  const eloBox = (key: "minElo" | "maxElo", placeholder: string) => (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      placeholder={placeholder}
      defaultValue={filters[key] ?? ""}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v !== String(filters[key] ?? "")) go({ [key]: v || null });
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`${field} h-10 w-24`}
    />
  );
  const active = filters.division || filters.language || filters.role || filters.minElo !== null || filters.maxElo !== null;
  return (
    <div className="flex flex-wrap items-end gap-3">
      {select("division", "All divisions", TARGET_DIVISIONS)}
      {select("language", "Any language", LANGUAGES)}
      {select("role", "Any role", ROLES)}
      <div>
        <span className={label}>Elo range</span>
        <div className="flex items-center gap-1.5">
          {eloBox("minElo", "Min")}
          <span className="text-white/40">–</span>
          {eloBox("maxElo", "Max")}
        </div>
      </div>
      {active ? (
        <button
          type="button"
          onClick={() => go({ division: null, language: null, role: null, minElo: null, maxElo: null })}
          className="h-10 text-xs font-black uppercase tracking-wide text-[#ff5500] hover:text-white"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

// --- apply / message ------------------------------------------------------------------------

export function ApplyButton({
  seasonId,
  post: p,
  loggedIn,
}: {
  seasonId: number;
  post: Pick<TeamPostView, "team" | "applied" | "mine" | "joinable">;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (p.mine) return <span className="text-[11px] font-black uppercase tracking-wide text-[#ff5500]">Your post</span>;
  if (p.applied === "pending") return <span className="text-xs font-bold text-white/60">Applied · waiting</span>;
  if (p.applied === "accepted")
    return (
      <Link href={`/teams/${p.team.id}`} className="text-xs font-bold text-hl-green hover:underline">
        Accepted · see invite
      </Link>
    );
  if (p.applied === "declined") return <span className="text-xs font-bold text-white/45">Declined</span>;
  if (!p.joinable) return <span className="text-xs font-bold text-white/45">Team full</span>;
  if (!loggedIn)
    return (
      <Link href="/login" className={primary}>
        Log in to apply
      </Link>
    );

  const send = async () => {
    setBusy(true);
    setError(null);
    const err = await post({ action: "apply", seasonId, teamId: p.team.id, message: msg });
    setBusy(false);
    if (err) setError(err);
    else {
      setOpen(false);
      router.refresh();
    }
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primary}>
        <UserPlus className="h-4 w-4" /> Apply
      </button>
      {open ? (
        <Dialog title={`Apply to ${p.team.name}`} onClose={() => setOpen(false)}>
          <div className="space-y-3 px-5 py-4">
            <p className="text-sm text-white/65">
              The captain gets a website notification and a Discord DM. If they accept, you get a team invite to accept.
            </p>
            <label className="block">
              <span className={label}>Message (optional)</span>
              <textarea
                rows={4}
                maxLength={MESSAGE_MAX}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="Your roles, when you can play, anything the captain should know…"
                className={input}
              />
            </label>
            {error ? <p className="text-sm text-hl-red">{error}</p> : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
            <button type="button" onClick={() => setOpen(false)} className={ghost}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={send} className={primary}>
              {busy ? "Sending…" : "Send application"}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

export function MessageButton({
  seasonId,
  post: p,
  loggedIn,
}: {
  seasonId: number;
  post: Pick<PlayerPostView, "id" | "playerName" | "mine">;
  loggedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (p.mine) return <span className="text-[11px] font-black uppercase tracking-wide text-[#ff5500]">Your post</span>;
  if (!loggedIn)
    return (
      <Link href="/login" className={ghost}>
        Log in to message
      </Link>
    );
  if (sent) return <span className="inline-flex items-center gap-1 text-xs font-bold text-hl-green"><Check className="h-3.5 w-3.5" /> Sent</span>;

  const send = async () => {
    setBusy(true);
    setError(null);
    const err = await post({ action: "message", seasonId, postId: p.id, message: msg });
    setBusy(false);
    if (err) setError(err);
    else {
      setSent(true);
      setOpen(false);
    }
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={ghost}>
        <MessageSquare className="h-4 w-4" /> Message
      </button>
      {open ? (
        <Dialog title={`Message ${p.playerName}`} onClose={() => setOpen(false)}>
          <div className="space-y-3 px-5 py-4">
            <p className="text-sm text-white/65">
              {p.playerName} gets it as a Discord DM and a website notification, with your Discord name so they can reply.
            </p>
            <textarea
              rows={4}
              maxLength={MESSAGE_MAX}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Hi! We're looking for an entry fragger for Season…"
              className={input}
            />
            {error ? <p className="text-sm text-hl-red">{error}</p> : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
            <button type="button" onClick={() => setOpen(false)} className={ghost}>
              Cancel
            </button>
            <button type="button" disabled={busy || msg.trim().length < 2} onClick={send} className={primary}>
              <Send className="h-4 w-4" /> {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

// --- post editor ----------------------------------------------------------------------------

interface Draft {
  title: string;
  body: string;
  roles: string[];
  days: string[];
  times: string[];
  language: string;
  minElo: string;
  maxElo: string;
  divisions: string[];
}

function Chips({
  list,
  value,
  onChange,
  wide,
}: {
  list: readonly (readonly [string, string])[];
  value: string[];
  onChange: (v: string[]) => void;
  wide?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map(([c, n]) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            title={list === DAYS ? c.toUpperCase() : undefined}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={`h-8 rounded-md border text-xs font-black ${wide === false ? "w-8" : "px-2.5"} ${
              on ? "border-[#ff5500] bg-[#ff5500]/15 text-white" : "border-white/[0.12] text-white/60 hover:text-white"
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function PostEditor({
  kind,
  seasonId,
  teamId,
  initial,
  onClose,
}: {
  kind: "team" | "player";
  seasonId: number;
  teamId?: string;
  initial: TeamPostView | PlayerPostView | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(() => ({
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    roles: initial?.roles ?? [],
    days: initial?.days ?? [],
    times: initial?.times ?? [],
    language: initial?.language ?? "",
    minElo: initial && "minElo" in initial && initial.minElo !== null ? String(initial.minElo) : "",
    maxElo: initial && "maxElo" in initial && initial.maxElo !== null ? String(initial.maxElo) : "",
    divisions: initial && "divisions" in initial ? initial.divisions : [],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const err = await post({
      action: kind === "team" ? "saveTeamPost" : "savePlayerPost",
      seasonId,
      teamId,
      post: {
        ...d,
        language: d.language || null,
        minElo: d.minElo || null,
        maxElo: d.maxElo || null,
      },
    });
    setBusy(false);
    if (err) setError(err);
    else {
      onClose();
      router.refresh();
    }
  };

  return (
    <Dialog title={kind === "team" ? (initial ? "Edit recruiting post" : "Recruit players") : initial ? "Edit your post" : "Look for a team"} onClose={onClose}>
      <div className="space-y-4 overflow-y-auto px-5 py-4">
        <label className="block">
          <span className={label}>Title</span>
          <input
            maxLength={TITLE_MAX}
            value={d.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={kind === "team" ? "Looking for an AWP and a support" : "Entry fragger looking for a Main team"}
            className={input}
          />
        </label>
        <label className="block">
          <span className={label}>About {kind === "team" ? "the team" : "you"}</span>
          <textarea
            rows={4}
            maxLength={BODY_MAX}
            value={d.body}
            onChange={(e) => set("body", e.target.value)}
            placeholder={kind === "team" ? "Goals, practice schedule, what you expect…" : "Experience, playstyle, what you're looking for…"}
            className={input}
          />
        </label>
        <div>
          <span className={label}>{kind === "team" ? "Roles you need" : "Roles you play"}</span>
          <Chips list={ROLES} value={d.roles} onChange={(v) => set("roles", v)} />
        </div>
        {kind === "player" ? (
          <div>
            <span className={label}>Divisions you&apos;re aiming for</span>
            <Chips list={TARGET_DIVISIONS} value={d.divisions} onChange={(v) => set("divisions", v)} />
          </div>
        ) : (
          <div>
            <span className={label}>Elo you&apos;re looking for</span>
            <div className="flex items-center gap-2">
              <input type="number" min={0} value={d.minElo} onChange={(e) => set("minElo", e.target.value)} placeholder="Any" className={`${field} w-28`} />
              <span className="text-white/40">–</span>
              <input type="number" min={0} value={d.maxElo} onChange={(e) => set("maxElo", e.target.value)} placeholder="Any" className={`${field} w-28`} />
            </div>
          </div>
        )}
        <div>
          <span className={label}>Practice days</span>
          <Chips list={DAYS} value={d.days} onChange={(v) => set("days", v)} wide={false} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div>
            <span className={label}>Time of day</span>
            <Chips list={TIMES} value={d.times} onChange={(v) => set("times", v)} />
          </div>
          <label className="block">
            <span className={label}>Language</span>
            <select value={d.language} onChange={(e) => set("language", e.target.value)} className={`${input} h-9`}>
              <option value="">Any</option>
              {LANGUAGES.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="text-sm text-hl-red">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
        <button type="button" onClick={onClose} className={ghost}>
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={save} className={primary}>
          {busy ? "Saving…" : initial ? "Save" : "Post"}
        </button>
      </div>
    </Dialog>
  );
}

// --- your recruiting ---------------------------------------------------------------------------

function StatusPill({ status }: { status: ApplicationView["status"] }) {
  const style = {
    pending: "border-white/20 text-white/75",
    accepted: "border-hl-green/40 text-hl-green",
    declined: "border-hl-red/40 text-hl-red",
    withdrawn: "border-white/10 text-white/40",
  }[status];
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${style}`}>{status}</span>;
}

export function MyRecruitingPanel({ seasonId, data }: { seasonId: number; data: MyRecruiting }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ kind: "team" | "player"; teamId?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    setError(null);
    const err = await post({ seasonId, ...body });
    setBusy(null);
    if (err) setError(err);
    else router.refresh();
  };
  const editingTeam = editing?.kind === "team" ? data.captainTeams.find((t) => t.team.id === editing.teamId) : null;
  const card = "rounded-xl border border-white/[0.08] bg-[#121212] p-4";
  const pendingApps = data.myApplications.filter((a) => a.status !== "withdrawn");

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-white">
        <Megaphone className="h-5 w-5 text-[#ff5500]" /> Your recruiting
      </h2>
      {error ? <p className="mb-3 text-sm text-hl-red">{error}</p> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {data.captainTeams.map(({ team, post: tp, applications }) => (
          <div key={team.id} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <ClubMark tag={team.tag} accentColor={team.accentColor} logoUrl={team.logoUrl} size={32} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-white">{team.name}</div>
                  <div className="text-[11px] text-white/55">{tp ? `Recruiting: ${tp.title}` : "Not recruiting"}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing({ kind: "team", teamId: team.id })} className={ghost}>
                  {tp ? <Pencil className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                  {tp ? "Edit" : "Recruit"}
                </button>
                {tp ? (
                  <button
                    type="button"
                    aria-label={`Remove ${team.name}'s post`}
                    disabled={busy === `del-${team.id}`}
                    onClick={() =>
                      run(`del-${team.id}`, { action: "deleteTeamPost", teamId: team.id }, `Remove ${team.name}'s recruiting post? Pending applications are closed.`)
                    }
                    className={ghost}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
            {applications.length ? (
              <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
                  Applications ({applications.length})
                </div>
                {applications.map((a) => (
                  <div key={a.id} className="rounded-lg bg-[#1b1b1b] px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold text-white">
                        {a.playerName}
                        {a.elo ? <span className="ml-1.5 text-[11px] font-semibold text-white/50">{a.elo.toLocaleString()} Elo</span> : null}
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={busy === `app-${a.id}`}
                          onClick={() => run(`app-${a.id}`, { action: "decide", applicationId: a.id, accept: true })}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-hl-green/35 bg-hl-green/10 px-2.5 text-xs font-bold text-hl-green hover:bg-hl-green/20 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" /> Accept
                        </button>
                        <button
                          type="button"
                          disabled={busy === `app-${a.id}`}
                          onClick={() => run(`app-${a.id}`, { action: "decide", applicationId: a.id, accept: false })}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-hl-red/30 bg-hl-red/10 px-2.5 text-xs font-bold text-hl-red hover:bg-hl-red/20 disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" /> Decline
                        </button>
                      </div>
                    </div>
                    {a.message ? <p className="mt-1 text-xs text-white/65">&ldquo;{a.message}&rdquo;</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-black text-white">Looking for a team</div>
              <div className="truncate text-[11px] text-white/55">
                {data.playerPost ? data.playerPost.title : data.linked ? "Post so captains can find you" : "Link your player to post"}
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={!data.linked} onClick={() => setEditing({ kind: "player" })} className={ghost}>
                {data.playerPost ? <Pencil className="h-3.5 w-3.5" /> : <Megaphone className="h-3.5 w-3.5" />}
                {data.playerPost ? "Edit" : "Post"}
              </button>
              {data.playerPost ? (
                <button
                  type="button"
                  aria-label="Remove your post"
                  disabled={busy === "del-player"}
                  onClick={() => run("del-player", { action: "deletePlayerPost" }, "Remove your Find Teammates post?")}
                  className={ghost}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
          {pendingApps.length ? (
            <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">Your applications</div>
              {pendingApps.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/teams/${a.teamId}`} className="truncate font-bold text-white hover:underline">
                    {a.teamName}
                  </Link>
                  <div className="flex items-center gap-2">
                    <StatusPill status={a.status} />
                    {a.status === "pending" ? (
                      <button
                        type="button"
                        disabled={busy === `wd-${a.id}`}
                        onClick={() => run(`wd-${a.id}`, { action: "withdraw", applicationId: a.id })}
                        className="text-[11px] font-bold text-white/55 hover:text-white"
                      >
                        Withdraw
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {!data.captainTeams.length ? (
        <p className="mt-2 text-xs text-white/50">
          Captains can post their team here.{" "}
          <Link href="/teams?create=1" className="font-bold text-[#ff5500] hover:underline">
            Create a team
          </Link>{" "}
          to start recruiting.
        </p>
      ) : null}

      {editing ? (
        <PostEditor
          kind={editing.kind}
          seasonId={seasonId}
          teamId={editing.teamId}
          initial={editing.kind === "team" ? editingTeam?.post ?? null : data.playerPost}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
