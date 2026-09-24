"use client";

/**
 * JOIN NOW on an upcoming season (docs/LEAGUE_UI_PLAN.md step 6): a dialog
 * where a captain picks one of their teams and signs it up (or withdraws it),
 * or goes to create a team. Uses /api/league like the old sign-up panel.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronRight, Lock, Plus, X } from "lucide-react";
import { ClubMark } from "@/components/club-identity";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";
import type { CaptainTeamOption } from "@/lib/league";

interface JoinData {
  season: { id: number; name: string; status: string; signupClose: number | null } | null;
  roster: { min: number; max: number };
  viewer: { captainTeams: CaptainTeamOption[]; myTeamIds: string[] } | null;
}

function fmtDay(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function TeamOption({
  team,
  selected,
  onSelect,
}: {
  team: CaptainTeamOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const blocked = !team.signedUp && team.problems.length > 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
        selected ? "border-[#ff5500] bg-[#ff5500]/[0.08]" : "border-white/[0.1] bg-[#1b1b1b] hover:border-white/25"
      }`}
    >
      <div className="flex items-center gap-3">
        <ClubMark tag={team.tag} accentColor={team.accentColor} logoUrl={team.logoUrl} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-black text-white">{team.name}</span>
            {team.signedUp ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-hl-green/15 px-2 py-0.5 text-[10px] font-black text-hl-green">
                <Check className="h-3 w-3" /> Signed up
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/55">
            <span>{team.memberCount} members</span>
            {team.seedElo ? <span>· {team.seedElo.toLocaleString()} avg Elo (top 5)</span> : null}
            {team.inviteOnly || team.seedElo ? (
              <span className="inline-flex items-center gap-1">
                · {team.inviteOnly ? <Lock className="h-3 w-3 text-[#ff5500]" /> : null}
                {team.access}
              </span>
            ) : null}
          </div>
        </div>
        <span
          aria-hidden
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
            selected ? "border-[#ff5500] bg-[#ff5500] text-white" : "border-white/30"
          }`}
        >
          {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
        </span>
      </div>
      {blocked ? (
        <ul className="mt-2 space-y-0.5 border-t border-white/[0.06] pt-2 text-[11px] text-hl-red">
          {team.problems.map((p) => (
            <li key={p} className="flex gap-1.5">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" /> {p}
            </li>
          ))}
        </ul>
      ) : null}
    </button>
  );
}

function JoinDialog({ seasonId, onClose }: { seasonId: number; onClose: () => void }) {
  const router = useRouter();
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<JoinData | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGetJson<JoinData>(`/api/league?season=${seasonId}`, { force: true })
      .then(({ ok, json }) => {
        if (!alive) return;
        if (ok && json) setData(json);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [seasonId, reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const teams = data?.viewer?.captainTeams ?? [];
  // Default pick: a team already signed up, else the first one that can sign up.
  const selectedId =
    picked ?? teams.find((t) => t.signedUp)?.id ?? teams.find((t) => !t.problems.length)?.id ?? teams[0]?.id ?? null;
  const selected = teams.find((t) => t.id === selectedId) ?? null;
  const open = data?.season?.status === "signup";

  const act = async (action: "signup" | "withdraw") => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, teamId: selected.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Something went wrong.");
      } else if (action === "signup") {
        setJoined(selected.name);
      }
      invalidateClientApi();
      setReload((n) => n + 1);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (!data) {
    body = (
      <p className="py-10 text-center text-sm text-white/55">
        {failed ? "Couldn't load your teams. Try again soon." : "Loading your teams…"}
      </p>
    );
  } else if (joined) {
    body = (
      <div className="py-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#ff5500] text-white">
          <Check className="h-6 w-6" strokeWidth={3} />
        </span>
        <h4 className="mt-3 text-lg font-black text-white">You&apos;re in!</h4>
        <p className="mx-auto mt-1 max-w-xs text-sm text-white/65">
          <span className="font-bold text-white">{joined}</span> is signed up for {data.season?.name}.{" "}
          {data.season?.signupClose
            ? `Rosters lock when registration closes on ${fmtDay(data.season.signupClose)}.`
            : "Rosters lock when registration closes."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link
            href={`/league/${seasonId}/teams`}
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-lg border border-white/15 px-4 text-xs font-black uppercase tracking-wide text-white hover:border-white/35"
          >
            See all teams
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="find-match-btn h-10 rounded-lg px-5 text-xs font-black uppercase tracking-wide text-hl-base"
          >
            Done
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <p className="text-sm text-white/65">
          Pick the team you captain. Rosters need {data.roster.min}–{data.roster.max} accepted members, all linked to a
          player, and each player can play for one team per season.
        </p>
        <div className="mt-4 space-y-2">
          {teams.map((t) => (
            <TeamOption key={t.id} team={t} selected={t.id === selectedId} onSelect={() => setPicked(t.id)} />
          ))}
          <Link
            href="/teams?create=1"
            className="flex items-center gap-3 rounded-lg border border-dashed border-white/[0.18] px-3 py-3 text-sm font-bold text-white/80 hover:border-white/35 hover:text-white"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.06]">
              <Plus className="h-4 w-4" />
            </span>
            <span className="flex-1">
              Create a new team
              <span className="block text-[11px] font-normal text-white/50">Invite your players, then come back to sign up.</span>
            </span>
            <ChevronRight className="h-4 w-4 text-white/40" />
          </Link>
        </div>
        {teams.length === 0 ? (
          <p className="mt-3 text-xs text-white/55">
            Only captains can sign a team up. On someone else&apos;s team? Ask your captain to join.
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-hl-red">{error}</p> : null}
      </>
    );
  }

  const canSignUp = !!selected && !selected.signedUp && selected.problems.length === 0 && open;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Join ${data?.season?.name ?? "the league"}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl border border-white/10 bg-[#161616] shadow-2xl"
      >
        <div className="relative border-b border-white/[0.08] px-5 py-4">
          <h3 className="text-lg font-black text-white">Join {data?.season?.name ?? "the league"}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-4 top-4 text-white/70 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{body}</div>
        {data && !joined && teams.length ? (
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-5 py-3">
            {selected?.signedUp ? (
              <>
                <span className="text-xs text-white/60">
                  <span className="font-bold text-white">{selected.name}</span> is signed up.
                </span>
                <button
                  type="button"
                  disabled={busy || !open}
                  onClick={() => act("withdraw")}
                  className="h-10 rounded-lg border border-white/15 px-4 text-xs font-black uppercase tracking-wide text-white/80 hover:border-hl-red/60 hover:text-hl-red disabled:opacity-50"
                >
                  Withdraw
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-white/55">
                  {open ? "Free entry · you can withdraw until registration closes" : "Registration isn't open yet"}
                </span>
                <button
                  type="button"
                  disabled={busy || !canSignUp}
                  onClick={() => act("signup")}
                  className="find-match-btn h-10 shrink-0 rounded-lg px-5 text-xs font-black uppercase tracking-wide text-hl-base disabled:opacity-40"
                >
                  {busy ? "Signing up…" : "Sign up"}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The hero's JOIN NOW button (a login link for guests). */
export function LeagueJoinButton({
  seasonId,
  loggedIn,
  open,
  label,
}: {
  seasonId: number;
  loggedIn: boolean;
  /** Sign-ups are open (draft seasons show a disabled button). */
  open: boolean;
  label: string;
}) {
  const [show, setShow] = useState(false);
  const cls =
    "find-match-btn inline-flex h-12 items-center justify-center gap-2 rounded-xl px-8 text-sm font-black uppercase tracking-[0.08em] text-hl-base";
  if (!open) {
    return (
      <button type="button" disabled className={`${cls} cursor-not-allowed opacity-50`}>
        Registration opens soon
      </button>
    );
  }
  if (!loggedIn) {
    return (
      <Link href="/login" className={cls}>
        Log in to join
      </Link>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setShow(true)} className={cls}>
        {label}
      </button>
      {show ? <JoinDialog seasonId={seasonId} onClose={() => setShow(false)} /> : null}
    </>
  );
}
