"use client";

/**
 * Staff panel → Queue (CBL bot docs/STAFF_PANEL_PLAN.md step 6): open, clear
 * and close each region's queue, switch the format, and set a live match's
 * server link — /queue start · clear · close · mode · serverlink. Opening a
 * queue makes the bot post it (with its Join buttons) in the picked channel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2, Link2, ListOrdered, RefreshCw, Users } from "lucide-react";
import { StaffJobOutcome } from "@/components/staff/staff-job-outcome";
import {
  CardTitle,
  ConfirmButton,
  StaffCard,
  SubHeading,
  danger,
  fieldLabel,
  input,
  primary,
  secondary,
} from "@/components/staff/staff-ui";
import { useStaffJob } from "@/components/staff/use-staff-job";
import { timeAgo } from "@/lib/format";
import type { StaffJob } from "@/lib/staff-jobs";
import type { StaffLiveMatch, StaffQueueRegion, StaffQueueView } from "@/lib/staff-queue";

type Settled = (job: StaffJob) => void;
type Channel = { id: string; name: string };

const MODE_LABEL: Record<string, string> = { standard: "Standard", super: "Super Match" };
const FORMATS = [2, 3, 5];

function OpenForm({
  region,
  channels,
  defaultChannel,
  busy,
  onOpen,
}: {
  region: StaffQueueRegion;
  channels: Channel[] | null;
  defaultChannel: string;
  busy: boolean;
  onOpen: (args: Record<string, unknown>) => void;
}) {
  const [mode, setMode] = useState(region.modes[0] ?? "standard");
  const [channel, setChannel] = useState(defaultChannel);
  const [server, setServer] = useState("");
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${input} w-full`}>
            <option value="standard">Standard</option>
            <option value="super">Super Match</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Post it in</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${input} w-full`}>
            <option value="">{channels ? "Pick a channel…" : "Loading channels…"}</option>
            {(channels ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        value={server}
        onChange={(e) => setServer(e.target.value.slice(0, 300))}
        placeholder="VIP server link for the next match (optional)"
        aria-label="Server link for the next match"
        className={`${input} w-full`}
      />
      <button
        type="button"
        className={primary}
        disabled={!channel || busy}
        onClick={() => onOpen({ region: region.id, mode, channel_id: channel, server: server.trim() })}
      >
        {region.open ? "Post it again" : `Open ${region.id}`}
      </button>
    </div>
  );
}

function RegionCard({
  region,
  channels,
  lastChannelId,
  onSettled,
}: {
  region: StaffQueueRegion;
  channels: Channel[] | null;
  lastChannelId: string | null;
  onSettled: Settled;
}) {
  const job = useStaffJob(onSettled);
  const [reopen, setReopen] = useState(false);
  const queueChannel = channels?.find((c) => c.name.toLowerCase().includes("queue"))?.id ?? "";
  const defaultChannel = region.postChannelId ?? lastChannelId ?? queueChannel;
  const postName = channels?.find((c) => c.id === region.postChannelId)?.name;

  return (
    <StaffCard>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-white">
            {region.id} <span className="font-normal text-hl-muted">· {region.label}</span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {region.open ? (
              <span className="rounded bg-hl-green/10 px-1.5 py-0.5 font-bold text-hl-green">
                Open · {region.modes.map((m) => MODE_LABEL[m] ?? m).join(" + ") || "Standard"}
              </span>
            ) : (
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-bold text-hl-muted">Closed</span>
            )}
            <span className="inline-flex items-center gap-1 text-hl-muted">
              <Users className="h-3 w-3" /> {region.waiting} waiting
            </span>
            {region.open && postName ? <span className="text-hl-muted">in #{postName}</span> : null}
          </div>
          {region.nextServer ? (
            <div className="mt-1 truncate text-[0.6875rem] text-hl-muted" title={region.nextServer}>
              Next match server: {region.nextServer}
            </div>
          ) : null}
        </div>
      </div>

      {region.open ? (
        <div className="flex flex-wrap gap-2">
          <ConfirmButton
            className={secondary}
            confirmText={region.waiting ? `Remove ${region.waiting}?` : "Click again"}
            disabled={job.busy}
            onConfirm={() => void job.run("queue_clear", { region: region.id })}
          >
            Clear
          </ConfirmButton>
          <ConfirmButton
            className={danger}
            confirmText="Click again to close"
            disabled={job.busy}
            onConfirm={() => void job.run("queue_close", { region: region.id })}
          >
            Close
          </ConfirmButton>
          <button type="button" className={secondary} onClick={() => setReopen((v) => !v)} aria-expanded={reopen}>
            Re-post / switch mode
          </button>
        </div>
      ) : null}
      {!region.open || reopen ? (
        <div className={region.open ? "mt-3 border-t border-hl-border pt-3" : ""}>
          {region.open ? (
            <p className="mb-2 text-xs text-hl-muted">
              Replaces the post. Switching mode only works while nobody is waiting.
            </p>
          ) : null}
          <OpenForm
            key={defaultChannel}
            region={region}
            channels={channels}
            defaultChannel={defaultChannel}
            busy={job.busy}
            onOpen={(args) => void job.run("queue_start", args)}
          />
        </div>
      ) : null}
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
    </StaffCard>
  );
}

function FormatCard({ teamSize, onSettled }: { teamSize: number; onSettled: Settled }) {
  const [pick, setPick] = useState(teamSize);
  const job = useStaffJob(onSettled);
  return (
    <StaffCard>
      <CardTitle
        icon={<Gamepad2 className="h-4 w-4 text-hl-gold" />}
        title="Queue format"
        hint={`Now ${teamSize}v${teamSize}. Switching empties every queue (parties are kept). Same as /queue mode.`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 overflow-hidden rounded-lg border border-hl-border">
          {FORMATS.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={pick === size}
              onClick={() => setPick(size)}
              className={`px-4 text-xs font-black header-caps ${
                pick === size ? "bg-hl-panel-light text-white" : "text-hl-muted hover:text-white"
              }`}
            >
              {size}v{size}
            </button>
          ))}
        </div>
        <ConfirmButton
          className={secondary}
          confirmText="Click again to switch"
          disabled={pick === teamSize || job.busy}
          onConfirm={() => void job.run("queue_mode", { team_size: pick })}
        >
          Switch
        </ConfirmButton>
      </div>
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
    </StaffCard>
  );
}

function matchLabel(m: StaffLiveMatch): string {
  const bits = [m.matchNumber ? `Match #${m.matchNumber}` : "Match", m.map, m.region, m.queueMode && m.queueMode !== "standard" ? m.queueMode : null];
  return `${bits.filter(Boolean).join(" · ")} · ${timeAgo(m.createdAt)}${m.serverUrl ? " · has a link" : ""}`;
}

function ServerLinkCard({ matches, onSettled }: { matches: StaffLiveMatch[]; onSettled: Settled }) {
  const [match, setMatch] = useState("");
  const [link, setLink] = useState("");
  const job = useStaffJob(onSettled);
  const picked = matches.find((m) => m.id === match) ?? null;
  return (
    <StaffCard>
      <CardTitle
        icon={<Link2 className="h-4 w-4 text-hl-gold" />}
        title="Server link for a live match"
        hint="Posted in the match channel and shown in the website match room. Same as /queue serverlink."
      />
      {!matches.length ? (
        <p className="text-sm text-hl-muted">No live matches right now.</p>
      ) : (
        <div className="space-y-2">
          <select value={match} onChange={(e) => setMatch(e.target.value)} aria-label="Live match" className={`${input} w-full`}>
            <option value="">Pick the live match…</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {matchLabel(m)}
              </option>
            ))}
          </select>
          {picked?.serverUrl ? (
            <p className="truncate text-xs text-hl-muted" title={picked.serverUrl}>
              Now: {picked.serverUrl}
            </p>
          ) : null}
          <div className="flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value.slice(0, 300))}
              placeholder="Roblox VIP / private server link"
              aria-label="Server link"
              className={`${input} min-w-0 flex-1`}
            />
            <button
              type="button"
              className={secondary}
              disabled={!picked || !link.trim() || job.busy}
              onClick={() =>
                picked &&
                void job.run("queue_serverlink", {
                  channel_id: picked.id,
                  link: link.trim(),
                  match: picked.matchNumber ? `match #${picked.matchNumber}` : "",
                })
              }
            >
              Set
            </button>
          </div>
        </div>
      )}
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
    </StaffCard>
  );
}

function AllRegionsCard({ onSettled }: { onSettled: Settled }) {
  const job = useStaffJob(onSettled);
  return (
    <StaffCard>
      <CardTitle icon={<ListOrdered className="h-4 w-4 text-hl-gold" />} title="Every region" />
      <div className="flex flex-wrap gap-2">
        <ConfirmButton className={secondary} confirmText="Click again" disabled={job.busy} onConfirm={() => void job.run("queue_clear", {})}>
          Clear every queue
        </ConfirmButton>
        <ConfirmButton className={danger} confirmText="Click again to close all" disabled={job.busy} onConfirm={() => void job.run("queue_close", {})}>
          Close every queue
        </ConfirmButton>
      </div>
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
    </StaffCard>
  );
}

export function QueueTab({ onSettled }: { onSettled: () => void }) {
  const [view, setView] = useState<StaffQueueView | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // The channel list (a Discord call) is asked for until it has arrived once.
  const haveChannels = useRef(false);

  useEffect(() => {
    let alive = true;
    const url = haveChannels.current ? "/api/staff/queue" : "/api/staff/queue?channels=1";
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as StaffQueueView & { channels?: Channel[]; error?: string };
        if (!alive) return;
        if (!res.ok) {
          setError(json.error || "Couldn't load the queue tab.");
          return;
        }
        setView(json);
        if (json.channels) {
          haveChannels.current = true;
          setChannels(json.channels);
        }
        setError(null);
      })
      .catch(() => alive && setError("Couldn't load the queue tab."));
    return () => {
      alive = false;
    };
  }, [reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const settled = useCallback(() => {
    onSettled();
    refresh();
  }, [onSettled, refresh]);

  if (error && !view) return <p className="text-sm text-hl-red">{error}</p>;
  if (!view) return <div className="py-10 text-center text-sm text-hl-muted">Loading…</div>;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-hl-muted">
          Each region runs one queue. Opening one posts it with its Join buttons in the channel you pick, like /queue start.
        </p>
        <button
          type="button"
          onClick={refresh}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hl-border px-3 py-2 text-xs font-black header-caps text-hl-muted hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      {error ? <p className="text-sm text-hl-red">{error}</p> : null}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {view.regions.map((r) => (
            <RegionCard key={r.id} region={r} channels={channels} lastChannelId={view.lastChannelId} onSettled={settled} />
          ))}
        </div>
        <div className="space-y-5">
          <FormatCard key={view.teamSize} teamSize={view.teamSize} onSettled={settled} />
          <ServerLinkCard matches={view.liveMatches} onSettled={settled} />
          <AllRegionsCard onSettled={settled} />
        </div>
      </div>
      <div className="text-xs text-hl-muted">
        <SubHeading>Test dummies</SubHeading>
        Filling a queue with test dummies stays in Discord (/queue adddummies, /queue removedummies).
      </div>
    </div>
  );
}
