"use client";

/**
 * One player in the staff panel's Players tab: who they are, their record,
 * and every staff action on them. Each action goes to the bot as a staff job
 * and shows the bot's answer right under its form.
 */
import { useState } from "react";
import Link from "next/link";
import {
  Award,
  Ban,
  Coins,
  Gavel,
  Lock,
  Package,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  UserCog,
} from "lucide-react";
import { AvatarImg } from "@/components/avatar-img";
import { RankBadgeInline } from "@/components/rank-badge";
import { StaffJobOutcome } from "@/components/staff/staff-job-outcome";
import {
  CardTitle,
  ConfirmButton,
  StaffCard,
  SubHeading,
  Tag,
  danger,
  fieldLabel,
  input,
  primary,
  secondary,
} from "@/components/staff/staff-ui";
import { useStaffJob } from "@/components/staff/use-staff-job";
import { profileHref } from "@/lib/profile-link";
import { MAX_TEAM_KILLS, TEAM_KILLING, TIMEOUT_REASONS } from "@/lib/staff-shared";
import type { StaffJob, StaffRoles } from "@/lib/staff-jobs";
import type { StaffCatalog, StaffPlayerView } from "@/lib/staff-players";
import type { RankTierLetter } from "@/types";

type Settled = (job: StaffJob) => void;

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → "5 Oct 2026, 14:03" in the viewer's time. */
function fmtDate(at: string): string {
  const d = new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtMinutes(m: number): string {
  if (m >= 1440 && m % 1440 === 0) return `${m / 1440} d`;
  if (m >= 60 && m % 60 === 0) return `${m / 60} h`;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${m} min`;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hl-border bg-hl-base/60 px-3 py-2">
      <div className="text-[0.6875rem] header-caps text-hl-muted">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-white">{children}</div>
    </div>
  );
}

function PlayerSummary({ view }: { view: StaffPlayerView }) {
  const p = view.player;
  return (
    <StaffCard>
      <div className="flex items-center gap-3">
        <AvatarImg src={p.avatarUrl} alt="" className="h-14 w-14 shrink-0 rounded-full border border-hl-border object-cover" />
        <div className="min-w-0">
          <Link href={profileHref(p.name)} className="block truncate text-lg font-black text-white hover:text-hl-gold">
            {p.name}
          </Link>
          {p.discordUsername || p.discordId ? (
            <div className="truncate text-xs text-hl-muted">
              {p.discordUsername ? `@${p.discordUsername}` : "Discord linked"}
              {p.discordId ? <span className="ml-1 font-mono text-[0.6875rem] opacity-70">{p.discordId}</span> : null}
            </div>
          ) : (
            <div className="text-xs text-hl-gold">No Discord account linked</div>
          )}
        </div>
      </div>

      {view.ban ? (
        <div className="mt-4 rounded-lg border border-hl-red/40 bg-hl-red/10 px-3 py-2 text-xs text-hl-red">
          <div className="flex items-center gap-1.5 font-black header-caps">
            <Ban className="h-3.5 w-3.5" /> Banned from matchmaking
          </div>
          <div className="mt-1 text-[#f0b4b4]">{view.ban.reason}</div>
          <div className="mt-1 opacity-80">
            by {view.ban.bannedBy} · {fmtDate(view.ban.bannedAt)}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="Elo">
          <RankBadgeInline rank={p.tier as RankTierLetter} />
          {p.elo.toLocaleString()}
        </Stat>
        <Stat label="Placements">{p.placementDone ? "Done" : `${p.placementGames} played`}</Stat>
        <Stat label="Matches">
          {p.matchesPlayed} <span className="text-xs font-normal text-hl-muted">· {p.matchesWon} won</span>
        </Stat>
        <Stat label="HL Coins">{p.coins.toLocaleString()}</Stat>
        <Stat label="Warnings">{view.warnings}</Stat>
        <Stat label="Rank">
          <span className="truncate text-xs">{p.placementDone ? p.rank : "Unranked"}</span>
        </Stat>
      </div>
    </StaffCard>
  );
}

function Record({ view }: { view: StaffPlayerView }) {
  return (
    <StaffCard>
      <CardTitle icon={<ShieldAlert className="h-4 w-4 text-hl-gold" />} title="Record" hint="The last 10 of each." />
      <SubHeading>Timeouts</SubHeading>
      {view.timeouts.length ? (
        <ul className="mb-4 space-y-1.5">
          {view.timeouts.map((t, i) => (
            <li key={i} className="text-xs">
              <div className="text-white">
                {t.reason} <span className="text-hl-muted">· {fmtMinutes(t.minutes)}</span>
              </div>
              <div className="text-hl-muted">
                {fmtDate(t.at)} · by {t.moderator}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-xs text-hl-muted">{view.player.discordId ? "No timeouts." : "No Discord account, so no record."}</p>
      )}
      <SubHeading>Early leaves</SubHeading>
      {view.leaves.length ? (
        <ul className="space-y-1.5">
          {view.leaves.map((l, i) => (
            <li key={i} className="text-xs">
              <span className="text-white">Leave #{l.count}</span>
              <span className="text-hl-red"> · −{l.eloPenalty} Elo</span>
              <span className="text-hl-muted"> · {fmtDate(l.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-hl-muted">No early leaves.</p>
      )}
    </StaffCard>
  );
}

function GiveTake({ mode, setMode }: { mode: "give" | "take"; setMode: (m: "give" | "take") => void }) {
  return (
    <div className="flex h-9 overflow-hidden rounded-lg border border-hl-border">
      {(
        [
          ["give", "Give", TrendingUp],
          ["take", "Take", TrendingDown],
        ] as const
      ).map(([value, text, Icon]) => (
        <button
          key={value}
          type="button"
          onClick={() => setMode(value)}
          aria-pressed={mode === value}
          className={`flex items-center gap-1.5 px-3 text-xs font-bold ${
            mode === value ? "bg-hl-panel-light text-white" : "text-hl-muted hover:text-white"
          }`}
        >
          <Icon className={`h-3.5 w-3.5 ${value === "give" ? "text-hl-green" : "text-hl-red"}`} />
          {text}
        </button>
      ))}
    </div>
  );
}

function EloSection({ player, canUse, onSettled }: { player: string; canUse: boolean; onSettled: Settled }) {
  const [mode, setMode] = useState<"give" | "take">("give");
  const [amount, setAmount] = useState("25");
  const job = useStaffJob(onSettled);
  const n = Number(amount);
  const valid = Number.isInteger(n) && n >= 1 && n <= 5000;
  return (
    <StaffCard>
      <CardTitle icon={<TrendingUp className="h-4 w-4 text-hl-gold" />} title="Elo" hint="Same as /elo add and /elo remove. Stays between 0 and 5,000." />
      <div className="flex flex-wrap items-end gap-2">
        <GiveTake mode={mode} setMode={setMode} />
        <input
          type="number"
          min={1}
          max={5000}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount"
          className={`${input} w-24`}
        />
        <button
          type="button"
          className={primary}
          disabled={!canUse || !valid || job.busy}
          onClick={() => job.run(mode === "give" ? "elo_add" : "elo_remove", { player, amount: n })}
        >
          {mode === "give" ? "Give" : "Take"} {valid ? n.toLocaleString() : ""} Elo
        </button>
      </div>
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
    </StaffCard>
  );
}

function AccountSection({
  player,
  canUse,
  onSettled,
  onRenamed,
  onRemoved,
}: {
  player: string;
  canUse: boolean;
  onSettled: Settled;
  onRenamed: (name: string) => void;
  onRemoved: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const rename = useStaffJob((job) => {
    onSettled(job);
    if (job.status === "done") onRenamed(newName.trim());
  });
  const reset = useStaffJob(onSettled);
  const remove = useStaffJob((job) => {
    onSettled(job);
    if (job.status === "done") onRemoved();
  });
  const trimmed = newName.trim();
  return (
    <StaffCard>
      <CardTitle icon={<UserCog className="h-4 w-4 text-hl-gold" />} title="Account" />
      <SubHeading>Rename</SubHeading>
      <p className="mb-2 text-xs text-hl-muted">Their Elo, stats and matches move to the new name.</p>
      <div className="flex flex-wrap gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value.slice(0, 32))}
          placeholder="New name"
          className={`${input} min-w-0 flex-1`}
        />
        <button
          type="button"
          className={secondary}
          disabled={!canUse || !trimmed || trimmed === player || rename.busy}
          onClick={() => rename.run("player_rename", { player, new_name: trimmed })}
        >
          Rename
        </button>
      </div>
      <div className="mt-2">
        <StaffJobOutcome state={rename.state} />
      </div>

      <div className="mt-5">
        <SubHeading>Placements</SubHeading>
        <p className="mb-2 text-xs text-hl-muted">Back to placement matches: 0 games and no Elo. Match history stays.</p>
        <ConfirmButton
          className={secondary}
          confirmText="Click again to reset"
          disabled={!canUse || reset.busy}
          onConfirm={() => reset.run("player_reset_placements", { player })}
        >
          Reset placements
        </ConfirmButton>
        <div className="mt-2">
          <StaffJobOutcome state={reset.state} />
        </div>
      </div>

      <div className="mt-5 border-t border-hl-border pt-4">
        <SubHeading>Remove from the database</SubHeading>
        <p className="mb-2 text-xs text-hl-muted">
          Deletes the player for good. To keep them out of matchmaking but keep their history, ban them instead.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={`Type ${player} to confirm`}
            className={`${input} min-w-0 flex-1`}
          />
          <button
            type="button"
            className={danger}
            disabled={!canUse || confirmName.trim() !== player || remove.busy}
            onClick={() => remove.run("player_remove", { player })}
          >
            Remove
          </button>
        </div>
        <div className="mt-2">
          <StaffJobOutcome state={remove.state} />
        </div>
      </div>
    </StaffCard>
  );
}

function DisciplineSection({ view, canUse, onSettled }: { view: StaffPlayerView; canUse: boolean; onSettled: Settled }) {
  const p = view.player;
  const [reason, setReason] = useState(TIMEOUT_REASONS[1].reason);
  const [teamKills, setTeamKills] = useState("1");
  const [banReason, setBanReason] = useState("");
  const [manualId, setManualId] = useState("");
  const timeout = useStaffJob(onSettled);
  const ban = useStaffJob(onSettled);
  const discordId = p.discordId ?? manualId.trim();
  const idOk = /^\d{15,22}$/.test(discordId);
  const kills = Number(teamKills);
  const killsOk = reason !== TEAM_KILLING || (Number.isInteger(kills) && kills >= 1 && kills <= MAX_TEAM_KILLS);
  const length = TIMEOUT_REASONS.find((r) => r.reason === reason)?.length;

  return (
    <StaffCard>
      <CardTitle icon={<Gavel className="h-4 w-4 text-hl-gold" />} title="Discipline" />
      {!p.discordId ? (
        <div className="mb-4">
          <p className="mb-2 text-xs text-hl-gold">
            No Discord account is linked, so the bot can&apos;t find them. Paste their Discord user ID to time them out or ban
            them.
          </p>
          <input
            value={manualId}
            onChange={(e) => setManualId(e.target.value.replace(/\D/g, "").slice(0, 22))}
            placeholder="Discord user ID"
            className={`${input} w-full font-mono`}
          />
        </div>
      ) : null}

      <SubHeading>Timeout + warning</SubHeading>
      <div className="flex flex-wrap items-end gap-2">
        <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" className={`${input} min-w-0 flex-1`}>
          {TIMEOUT_REASONS.map((r) => (
            <option key={r.reason} value={r.reason}>
              {r.reason}
            </option>
          ))}
        </select>
        {reason === TEAM_KILLING ? (
          <label className="block">
            <span className={fieldLabel}>Team kills</span>
            <input
              type="number"
              min={1}
              max={MAX_TEAM_KILLS}
              value={teamKills}
              onChange={(e) => setTeamKills(e.target.value)}
              className={`${input} w-20`}
            />
          </label>
        ) : null}
        <ConfirmButton
          className={secondary}
          confirmText="Click again"
          disabled={!canUse || !idOk || !killsOk || timeout.busy}
          onConfirm={() =>
            timeout.run("mod_timeout", {
              discord_id: discordId,
              reason,
              player: p.name,
              ...(reason === TEAM_KILLING ? { team_kills: kills } : {}),
            })
          }
        >
          Time out
        </ConfirmButton>
      </div>
      {length ? (
        <p className="mt-1.5 text-xs text-hl-muted">
          {reason === TEAM_KILLING && killsOk ? `${kills} hour${kills === 1 ? "" : "s"}` : length}. They get a DM.
        </p>
      ) : null}
      <div className="mt-2">
        <StaffJobOutcome state={timeout.state} />
      </div>

      <div className="mt-5 border-t border-hl-border pt-4">
        <SubHeading>Matchmaking ban</SubHeading>
        {view.ban ? (
          <>
            <p className="mb-2 text-xs text-hl-muted">They&apos;re banned. Lifting it lets them get matchmaking access again.</p>
            <button
              type="button"
              className={secondary}
              disabled={!canUse || !idOk || ban.busy}
              onClick={() => ban.run("player_unban", { discord_id: discordId, player: p.name })}
            >
              Lift the ban
            </button>
          </>
        ) : (
          <>
            <p className="mb-2 text-xs text-hl-muted">
              For good: no queue on Discord or the website, no subbing. They stay in the Discord server and keep their history.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                value={banReason}
                onChange={(e) => setBanReason(e.target.value.slice(0, 500))}
                placeholder="Reason (kept for staff)"
                className={`${input} min-w-0 flex-1`}
              />
              <ConfirmButton
                confirmText="Click again to ban"
                disabled={!canUse || !idOk || !banReason.trim() || ban.busy}
                onConfirm={() => ban.run("player_ban", { discord_id: discordId, reason: banReason.trim(), player: p.name })}
              >
                <Ban className="h-3.5 w-3.5" /> Ban
              </ConfirmButton>
            </div>
          </>
        )}
        <div className="mt-2">
          <StaffJobOutcome state={ban.state} />
        </div>
      </div>
    </StaffCard>
  );
}

function RewardsSection({
  view,
  catalog,
  isAdmin,
  onSettled,
}: {
  view: StaffPlayerView;
  catalog: StaffCatalog | null;
  isAdmin: boolean;
  onSettled: Settled;
}) {
  const player = view.player.name;
  const [coinMode, setCoinMode] = useState<"give" | "take">("give");
  const [coinAmount, setCoinAmount] = useState("500");
  const [badge, setBadge] = useState("");
  const [reward, setReward] = useState("");
  const [slug, setSlug] = useState("");
  const coins = useStaffJob(onSettled);
  const badges = useStaffJob(onSettled);
  const rewards = useStaffJob(onSettled);
  const items = useStaffJob(onSettled);
  const n = Number(coinAmount);
  const coinsOk = Number.isInteger(n) && n >= 1 && n <= 100_000;
  const owned = new Set(view.inventory.map((i) => i.slug));
  const giveable = (catalog?.items ?? []).filter((i) => !owned.has(i.slug));

  return (
    <StaffCard className="lg:col-span-2">
      <CardTitle
        icon={<Award className="h-4 w-4 text-hl-gold" />}
        title="Rewards"
        hint="HL Coins, badges, season rewards and cosmetic items."
        right={
          !isAdmin ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[0.6875rem] font-bold text-hl-muted">
              <Lock className="h-3 w-3" /> Administrators only
            </span>
          ) : null
        }
      />
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <SubHeading>HL Coins · {view.player.coins.toLocaleString()}</SubHeading>
          {isAdmin ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <GiveTake mode={coinMode} setMode={setCoinMode} />
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={coinAmount}
                  onChange={(e) => setCoinAmount(e.target.value)}
                  aria-label="Coins"
                  className={`${input} w-24`}
                />
                <button
                  type="button"
                  className={secondary}
                  disabled={!coinsOk || coins.busy}
                  onClick={() => coins.run("coins_give", { player, amount: coinMode === "give" ? n : -n })}
                >
                  <Coins className="h-3.5 w-3.5" /> {coinMode === "give" ? "Give" : "Take"}
                </button>
              </div>
              <div className="mt-2">
                <StaffJobOutcome state={coins.state} />
              </div>
            </>
          ) : null}
        </div>

        <div>
          <SubHeading>Badges</SubHeading>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {view.badges.length ? (
              view.badges.map((b, i) => (
                <Tag
                  key={`${b}-${i}`}
                  disabled={badges.busy}
                  onRemove={isAdmin ? () => badges.run("badge_remove", { player, badge: b }) : undefined}
                >
                  {b}
                </Tag>
              ))
            ) : (
              <span className="text-xs text-hl-muted">None.</span>
            )}
          </div>
          {isAdmin ? (
            <div className="flex gap-2">
              <input
                value={badge}
                onChange={(e) => setBadge(e.target.value.slice(0, 64))}
                list="staff-badge-names"
                placeholder="Badge name"
                className={`${input} min-w-0 flex-1`}
              />
              <datalist id="staff-badge-names">
                {(catalog?.badges ?? []).map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              <button
                type="button"
                className={secondary}
                disabled={!badge.trim() || badges.busy}
                onClick={() => badges.run("badge_give", { player, badge: badge.trim() })}
              >
                Give
              </button>
            </div>
          ) : null}
          <div className="mt-2">
            <StaffJobOutcome state={badges.state} />
          </div>
        </div>

        <div>
          <SubHeading>Season rewards</SubHeading>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {view.player.seasonRewards.length ? (
              view.player.seasonRewards.map((r, i) => (
                <Tag
                  key={`${r}-${i}`}
                  disabled={rewards.busy}
                  onRemove={isAdmin ? () => rewards.run("seasonreward_remove", { player, reward: r }) : undefined}
                >
                  {r}
                </Tag>
              ))
            ) : (
              <span className="text-xs text-hl-muted">None.</span>
            )}
          </div>
          {isAdmin ? (
            <div className="flex gap-2">
              <input
                value={reward}
                onChange={(e) => setReward(e.target.value.slice(0, 100))}
                placeholder="e.g. Season 1 Top 10"
                className={`${input} min-w-0 flex-1`}
              />
              <button
                type="button"
                className={secondary}
                disabled={!reward.trim() || rewards.busy}
                onClick={() => rewards.run("seasonreward_add", { player, reward: reward.trim() })}
              >
                Add
              </button>
            </div>
          ) : null}
          <div className="mt-2">
            <StaffJobOutcome state={rewards.state} />
          </div>
        </div>

        <div>
          <SubHeading>Cosmetic items</SubHeading>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {view.inventory.length ? (
              view.inventory.map((i) => (
                <Tag
                  key={i.slug}
                  disabled={items.busy}
                  onRemove={isAdmin ? () => items.run("item_take", { player, slug: i.slug }) : undefined}
                >
                  {i.name} <span className="text-hl-muted">· {i.type}</span>
                </Tag>
              ))
            ) : (
              <span className="text-xs text-hl-muted">None.</span>
            )}
          </div>
          {isAdmin ? (
            <div className="flex gap-2">
              <select value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Item" className={`${input} min-w-0 flex-1`}>
                <option value="">{catalog ? "Pick an item…" : "Loading items…"}</option>
                {giveable.map((i) => (
                  <option key={i.slug} value={i.slug}>
                    {i.name} ({i.type})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={secondary}
                disabled={!slug || items.busy}
                onClick={() => items.run("item_give", { player, slug })}
              >
                <Package className="h-3.5 w-3.5" /> Give
              </button>
            </div>
          ) : null}
          <div className="mt-2">
            <StaffJobOutcome state={items.state} />
          </div>
        </div>
      </div>
    </StaffCard>
  );
}

export function PlayerManage({
  view,
  roles,
  catalog,
  onSettled,
  onRenamed,
  onRemoved,
}: {
  view: StaffPlayerView;
  roles: StaffRoles;
  catalog: StaffCatalog | null;
  onSettled: Settled;
  onRenamed: (name: string) => void;
  onRemoved: () => void;
}) {
  const player = view.player.name;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
      <div className="space-y-5">
        <PlayerSummary view={view} />
        <Record view={view} />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {!roles.staff ? (
          <p className="text-xs text-hl-muted lg:col-span-2">
            You&apos;re a server Administrator without the Match Staff role: Elo, account and discipline actions need Match
            Staff.
          </p>
        ) : null}
        <div className="space-y-5">
          <EloSection player={player} canUse={roles.staff} onSettled={onSettled} />
          <DisciplineSection view={view} canUse={roles.staff} onSettled={onSettled} />
        </div>
        <AccountSection
          player={player}
          canUse={roles.staff}
          onSettled={onSettled}
          onRenamed={onRenamed}
          onRemoved={onRemoved}
        />
        <RewardsSection view={view} catalog={catalog} isAdmin={roles.admin} onSettled={onSettled} />
      </div>
    </div>
  );
}
