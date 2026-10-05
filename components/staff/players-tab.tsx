"use client";

/**
 * Staff panel → Players (CBL bot docs/STAFF_PANEL_PLAN.md step 2): find a
 * player and manage them, or add players by hand. The open player belongs to
 * the panel (components/staff/staff-panel.tsx), so other tabs can open one.
 */
import { useCallback, useEffect, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { PlayerSearch } from "@/components/player-search";
import { PlayerManage } from "@/components/staff/player-manage";
import { StaffJobOutcome } from "@/components/staff/staff-job-outcome";
import { CardTitle, StaffCard, input, primary, secondary } from "@/components/staff/staff-ui";
import { useStaffJob } from "@/components/staff/use-staff-job";
import { apiGetJson } from "@/lib/client-api";
import type { StaffJob, StaffRoles } from "@/lib/staff-jobs";
import type { StaffCatalog, StaffPlayerView } from "@/lib/staff-players";

type Loaded = { name: string; view: StaffPlayerView | null; error?: string };

function AddPlayers({ canUse, onSettled }: { canUse: boolean; onSettled: (job: StaffJob) => void }) {
  const [names, setNames] = useState("");
  const job = useStaffJob(onSettled);
  return (
    <div className="mt-4 border-t border-hl-border pt-4">
      <p className="mb-2 text-xs text-hl-muted">
        Players are normally added when they verify in Discord. One name per line, or separated by commas (up to 25).
      </p>
      <textarea
        value={names}
        onChange={(e) => setNames(e.target.value.slice(0, 1000))}
        rows={3}
        placeholder="name1, name2"
        className={`${input} h-auto w-full py-2`}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className={primary}
          disabled={!canUse || !names.trim() || job.busy}
          onClick={() => job.run("player_add", { names })}
        >
          Add players
        </button>
      </div>
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
    </div>
  );
}

export function PlayersTab({
  roles,
  selected,
  onSelect,
  onSettled,
}: {
  roles: StaffRoles;
  /** The open player (null = none). */
  selected: string | null;
  onSelect: (name: string | null) => void;
  onSettled: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [catalog, setCatalog] = useState<StaffCatalog | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    fetch(`/api/staff/players/${encodeURIComponent(selected)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as StaffPlayerView & { error?: string };
        if (!alive) return;
        setLoaded(
          res.ok ? { name: selected, view: json } : { name: selected, view: null, error: json.error || "Couldn't load that player." }
        );
      })
      .catch(() => alive && setLoaded({ name: selected, view: null, error: "Couldn't load that player." }));
    return () => {
      alive = false;
    };
  }, [selected, reload]);

  useEffect(() => {
    let alive = true;
    apiGetJson<StaffCatalog>("/api/staff/catalog", { ttlMs: 60_000 })
      .then(({ ok, json }) => {
        if (alive && ok) setCatalog(json);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const pick = useCallback(
    (name: string | null) => {
      onSelect(name);
      setNotice(null);
    },
    [onSelect]
  );

  const settled = useCallback(() => {
    onSettled();
    setReload((n) => n + 1);
  }, [onSettled]);

  // While a refresh of the same player loads, keep showing the last view.
  const current = loaded && loaded.name === selected ? loaded : null;

  return (
    <div className="space-y-5">
      <StaffCard>
        <CardTitle
          icon={<Users className="h-4 w-4 text-hl-gold" />}
          title="Players"
          hint="Find a player to see their record and manage them."
          right={
            <button type="button" className={secondary} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              <UserPlus className="h-3.5 w-3.5" /> Add players
            </button>
          }
        />
        <PlayerSearch className="w-full" placeholder="Search a player…" onPick={pick} />
        {adding ? <AddPlayers canUse={roles.staff} onSettled={settled} /> : null}
      </StaffCard>

      {notice ? <p className="text-sm text-hl-green">{notice}</p> : null}

      {!selected ? (
        <div className="rounded-xl border border-dashed border-hl-border px-6 py-10 text-center text-sm text-hl-muted">
          Search for a player above to manage them.
        </div>
      ) : !current ? (
        <div className="py-10 text-center text-sm text-hl-muted">Loading {selected}…</div>
      ) : current.view ? (
        <PlayerManage
          key={current.view.player.name}
          view={current.view}
          roles={roles}
          catalog={catalog}
          onSettled={settled}
          onRenamed={(name) => {
            pick(name);
            setNotice(`Renamed to ${name}.`);
          }}
          onRemoved={() => {
            const gone = current.view?.player.name ?? selected;
            pick(null);
            setNotice(`Removed ${gone} from the database.`);
          }}
        />
      ) : (
        <p className="text-sm text-hl-red">{current.error}</p>
      )}
    </div>
  );
}
