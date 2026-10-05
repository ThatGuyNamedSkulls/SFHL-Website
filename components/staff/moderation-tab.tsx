"use client";

/**
 * Staff panel → Moderation (CBL bot docs/STAFF_PANEL_PLAN.md step 4): player
 * reports, who is suspended or timed out right now, recent timeouts and early
 * leaves — for everyone, like /mod reports · timeouts · leaves. Reports can
 * be marked handled (/mod reports then leaves them out); everything else is
 * read-only: a name opens that player in the Players tab, where the actions are.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, DoorOpen, Flag, RefreshCw, RotateCcw, Search, Timer } from "lucide-react";
import { CardTitle, StaffCard, input, secondary } from "@/components/staff/staff-ui";
import { timeAgo } from "@/lib/format";
import type { StaffModerationView } from "@/lib/staff-moderation";

function fmtMinutes(m: number): string {
  if (m >= 1440 && m % 1440 === 0) return `${m / 1440} d`;
  if (m >= 60 && m % 60 === 0) return `${m / 60} h`;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${m} min`;
}

/** "in 3 h", "in 2 days" — how long until a timeout or suspension ends. */
function endsIn(ms: number, now: number): string {
  const mins = Math.max(1, Math.round((ms - now) / 60_000));
  if (mins < 60) return `in ${mins} min`;
  if (mins < 48 * 60) return `in ${Math.round(mins / 60)} h`;
  return `in ${Math.round(mins / 1440)} days`;
}

/** A name that opens the player in the Players tab when they have an account. */
function Who({ name, player, onOpen }: { name: string; player: string | null; onOpen: (name: string) => void }) {
  if (!player) return <span className="font-semibold text-white">{name || "Unknown"}</span>;
  return (
    <button
      type="button"
      onClick={() => onOpen(player)}
      title={`Manage ${player}`}
      className="font-semibold text-white underline decoration-white/20 underline-offset-2 hover:text-hl-gold hover:decoration-hl-gold"
    >
      {player}
      {name && name !== player ? <span className="font-normal text-hl-muted"> ({name})</span> : null}
    </button>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-hl-border bg-hl-panel px-4 py-3">
      <div className="text-[0.6875rem] header-caps text-hl-muted">{label}</div>
      <div className={`mt-0.5 text-2xl font-black ${value ? tone : "text-white"}`}>{value}</div>
    </div>
  );
}

export function ModerationTab({ onOpenPlayer }: { onOpenPlayer: (name: string) => void }) {
  const [view, setView] = useState<StaffModerationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"open" | "handled" | "all">("open");
  const [saving, setSaving] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // When the data arrived: "ends in" counts from it, so rendering stays pure.
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/staff/moderation", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as StaffModerationView & { error?: string };
        if (!alive) return;
        if (res.ok) {
          setView(json);
          setLoadedAt(Date.now());
          setError(null);
        } else {
          setError(json.error || "Couldn't load the moderation tab.");
        }
      })
      .catch(() => alive && setError("Couldn't load the moderation tab."));
    return () => {
      alive = false;
    };
  }, [reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const markReport = async (id: number, handled: boolean) => {
    setSaving(id);
    setSaveError(null);
    try {
      const res = await fetch(`/api/staff/reports/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handled }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setSaveError(json.error || "Couldn't update the report.");
      else refresh();
    } catch {
      setSaveError("Couldn't update the report.");
    } finally {
      setSaving(null);
    }
  };

  const reports = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (view?.reports ?? []).filter(
      (r) =>
        (show === "all" || (show === "open") === (r.handledAt == null)) &&
        (!q || `${r.reported} ${r.reporter} ${r.reason}`.toLowerCase().includes(q))
    );
  }, [view, query, show]);

  if (error && !view) return <p className="text-sm text-hl-red">{error}</p>;
  if (!view) return <div className="py-10 text-center text-sm text-hl-muted">Loading…</div>;
  const activeTimeouts = view.timeouts.filter((t) => t.active);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="grid flex-1 grid-cols-3 gap-3">
          <Tile label="Suspended now" value={view.counts.suspendedNow} tone="text-hl-red" />
          <Tile label="Timed out now" value={view.counts.timedOutNow} tone="text-hl-gold" />
          <Tile label="Open reports" value={view.counts.openReports} tone="text-hl-gold" />
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1.5 rounded-xl border border-hl-border px-4 text-xs font-black header-caps text-hl-muted hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      {error ? <p className="text-sm text-hl-red">{error}</p> : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <StaffCard>
          <CardTitle
            icon={<Flag className="h-4 w-4 text-hl-gold" />}
            title="Player reports"
            hint={`From /mod report in Discord and the Report button on profiles. ${view.counts.reportsThisWeek} this week; the latest 100, newest first.`}
          />
          <div className="mb-3 flex flex-wrap gap-2">
            {(
              [
                ["open", "Open"],
                ["handled", "Handled"],
                ["all", "All"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setShow(value)}
                aria-pressed={show === value}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                  show === value ? "border-transparent bg-gold-gradient text-hl-base" : "border-hl-border text-hl-muted hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {saveError ? <p className="mb-2 text-sm text-hl-red">{saveError}</p> : null}
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hl-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by player, reporter or reason"
              className={`${input} w-full pl-8`}
            />
          </div>
          {!reports.length ? (
            <p className="text-sm text-hl-muted">
              {query ? "No reports match." : show === "open" ? "No open reports." : "No reports."}
            </p>
          ) : (
            <ul className="divide-y divide-hl-border">
              {reports.map((r) => (
                <li key={r.id} className={`py-2.5 ${r.handledAt != null ? "opacity-70" : ""}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <Who name={r.reported} player={r.reportedIsPlayer ? r.reported : null} onOpen={onOpenPlayer} />
                    <span className="ml-auto text-[0.6875rem] text-hl-muted">{r.at ? timeAgo(r.at) : ""}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-line break-words text-sm text-[#d4d4d4]">{r.reason}</p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[0.6875rem] text-hl-muted">
                      reported by {r.reporter} · {r.source === "website" ? "on the website" : "in Discord"}
                      {r.handledAt != null ? (
                        <span className="text-hl-green">
                          {" "}
                          · handled{r.handledBy ? ` by ${r.handledBy}` : ""} {timeAgo(r.handledAt)}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={`${secondary} h-7 px-2`}
                      disabled={saving === r.id}
                      onClick={() => void markReport(r.id, r.handledAt == null)}
                    >
                      {r.handledAt == null ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> Mark handled
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" /> Reopen
                        </>
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </StaffCard>

        <div className="space-y-5">
          <StaffCard>
            <CardTitle
              icon={<Ban className="h-4 w-4 text-hl-gold" />}
              title="Suspended or timed out now"
              hint="Matchmaking suspensions (early leaves) and Discord timeouts still running."
            />
            {!view.suspended.length && !activeTimeouts.length ? (
              <p className="text-sm text-hl-muted">Nobody right now.</p>
            ) : (
              <ul className="space-y-2">
                {view.suspended.map((s) => (
                  <li key={`s${s.id}`} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <Who name={s.name} player={s.player} onOpen={onOpenPlayer} />
                      <span className="shrink-0 text-hl-red">suspended · ends {endsIn(s.endsAt, loadedAt)}</span>
                    </div>
                    <div className="text-hl-muted">{s.reason}</div>
                  </li>
                ))}
                {activeTimeouts.map((t) => (
                  <li key={`t${t.id}`} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <Who name={t.name} player={t.player} onOpen={onOpenPlayer} />
                      <span className="shrink-0 text-hl-gold">timed out · ends {endsIn(t.endsAt, loadedAt)}</span>
                    </div>
                    <div className="text-hl-muted">
                      {t.reason} · by {t.moderator}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </StaffCard>

          <StaffCard>
            <CardTitle icon={<Timer className="h-4 w-4 text-hl-gold" />} title="Recent timeouts" hint="Everyone's, newest first." />
            {!view.timeouts.length ? (
              <p className="text-sm text-hl-muted">No timeouts yet.</p>
            ) : (
              <ul className="divide-y divide-hl-border">
                {view.timeouts.map((t) => (
                  <li key={t.id} className="py-2 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <Who name={t.name} player={t.player} onOpen={onOpenPlayer} />
                      <span className="shrink-0 text-hl-muted">{t.at ? timeAgo(t.at) : ""}</span>
                    </div>
                    <div className="text-hl-muted">
                      <span className="text-[#d4d4d4]">{t.reason}</span> · {fmtMinutes(t.minutes)} · by {t.moderator}
                      {t.active ? <span className="text-hl-gold"> · running</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </StaffCard>

          <StaffCard>
            <CardTitle
              icon={<DoorOpen className="h-4 w-4 text-hl-gold" />}
              title="Early leaves"
              hint="Left a match early: the Elo they lost, and which leave it was in the counting window."
            />
            {!view.leaves.length ? (
              <p className="text-sm text-hl-muted">No early leaves yet.</p>
            ) : (
              <ul className="divide-y divide-hl-border">
                {view.leaves.map((l) => (
                  <li key={l.id} className="flex items-baseline justify-between gap-2 py-2 text-xs">
                    <span className="min-w-0 truncate">
                      <Who name={l.name} player={l.player} onOpen={onOpenPlayer} />
                      <span className="text-hl-muted"> · leave #{l.count}</span>
                      <span className="text-hl-red"> · −{l.eloPenalty} Elo</span>
                    </span>
                    <span className="shrink-0 text-hl-muted">{l.at ? timeAgo(l.at) : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </StaffCard>
        </div>
      </div>
    </div>
  );
}
