/**
 * Missions: timed challenges that award HL Coins.
 * Definitions live in code; progress is derived from match_history /
 * placement state; claims are stored in web_mission_claims.
 */

import { client, ensurePlayerCoinsColumn } from "@/lib/db";
import type {
  MissionDef,
  MissionMetric,
  MissionTab,
  MissionView,
} from "@/lib/mission-types";

export type { MissionCategory, MissionDef, MissionMetric, MissionTab, MissionView } from "@/lib/mission-types";

const DAY = 24 * 60 * 60 * 1000;

/** Season-1 style catalogue. Dates are relative to a fixed season window so
 *  the page always has something to show without a CMS. */
function buildCatalog(now: number): MissionDef[] {
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const nextMonthStart = monthEnd.getTime();
  const nextMonthEnd = nextMonthStart + 30 * DAY;

  return [
    {
      id: "s1-monthly-win",
      title: "Monthly Mission",
      description: "Get 1 win",
      goal: 1,
      metric: "wins",
      rewardCoins: 250,
      startsAt: monthStart.getTime(),
      endsAt: monthEnd.getTime(),
      category: "monthly",
      organizedBy: "HyperLeague",
    },
    {
      id: "s1-weekly-3wins",
      title: "Weekly Grind",
      description: "Get 3 wins",
      goal: 3,
      metric: "wins",
      rewardCoins: 500,
      startsAt: now - 3 * DAY,
      endsAt: now + 4 * DAY,
      category: "sf",
      organizedBy: "HyperLeague",
    },
    {
      id: "s1-play-5",
      title: "Queue Up",
      description: "Play 5 matches",
      goal: 5,
      metric: "matches",
      rewardCoins: 300,
      startsAt: monthStart.getTime(),
      endsAt: monthEnd.getTime(),
      category: "sf",
      organizedBy: "HyperLeague",
    },
    {
      id: "s1-placements",
      title: "Finish Placements",
      description: "Complete your placement matches",
      goal: 1,
      metric: "placement_done",
      rewardCoins: 1000,
      startsAt: monthStart.getTime() - 30 * DAY,
      endsAt: nextMonthEnd,
      category: "sponsored",
      organizedBy: "HyperLeague",
    },
    {
      id: "s1-next-monthly",
      title: "Next Month Preview",
      description: "Get 5 wins",
      goal: 5,
      metric: "wins",
      rewardCoins: 750,
      startsAt: nextMonthStart,
      endsAt: nextMonthEnd,
      category: "monthly",
      organizedBy: "HyperLeague",
    },
    {
      id: "s1-ended-demo",
      title: "Opening Week",
      description: "Play 3 matches",
      goal: 3,
      metric: "matches",
      rewardCoins: 200,
      startsAt: now - 40 * DAY,
      endsAt: now - 10 * DAY,
      category: "sf",
      organizedBy: "HyperLeague",
    },
  ];
}

function tabOf(m: MissionDef, now: number): MissionTab {
  if (now < m.startsAt) return "upcoming";
  if (now > m.endsAt) return "ended";
  return "ongoing";
}

function endsInLabel(endsAt: number, now: number): string | null {
  const ms = endsAt - now;
  if (ms <= 0) return null;
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return `Ends in ${String(days).padStart(2, "0")}D ${String(hours).padStart(2, "0")}H ${String(mins).padStart(2, "0")}M`;
}

let schemaReady: Promise<void> | null = null;

function ensureClaimsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS web_mission_claims (
           player_name TEXT NOT NULL,
           mission_id TEXT NOT NULL,
           claimed_at INTEGER NOT NULL,
           PRIMARY KEY (player_name, mission_id)
         )`
      );
    })();
  }
  return schemaReady;
}

async function claimedIds(playerName: string): Promise<Set<string>> {
  await ensureClaimsSchema();
  const rs = await client.execute({
    sql: "SELECT mission_id FROM web_mission_claims WHERE player_name = ?",
    args: [playerName],
  });
  return new Set(rs.rows.map((r) => String(r.mission_id)));
}

async function progressFor(
  playerName: string,
  metric: MissionMetric,
  windowStart: number,
  windowEnd: number
): Promise<number> {
  if (metric === "placement_done") {
    const rs = await client.execute({
      sql: "SELECT placement_done FROM players WHERE name = ?",
      args: [playerName],
    });
    return Number(rs.rows[0]?.placement_done ?? 0) === 1 ? 1 : 0;
  }

  // match_history.timestamp is stored as "YYYY-MM-DD HH:MM:SS" UTC strings.
  const startStr = new Date(windowStart).toISOString().slice(0, 19).replace("T", " ");
  const endStr = new Date(windowEnd).toISOString().slice(0, 19).replace("T", " ");

  if (metric === "wins") {
    const rs = await client.execute({
      sql: `SELECT COUNT(DISTINCT match_id) AS c FROM match_history
            WHERE player_name = ?
              AND result = 'W'
              AND COALESCE(is_test, 0) = 0
              AND timestamp >= ? AND timestamp < ?`,
      args: [playerName, startStr, endStr],
    });
    return Number(rs.rows[0]?.c ?? 0);
  }

  const rs = await client.execute({
    sql: `SELECT COUNT(DISTINCT match_id) AS c FROM match_history
          WHERE player_name = ?
            AND COALESCE(is_test, 0) = 0
            AND timestamp >= ? AND timestamp < ?`,
    args: [playerName, startStr, endStr],
  });
  return Number(rs.rows[0]?.c ?? 0);
}

export async function listMissionsForPlayer(playerName: string | null): Promise<MissionView[]> {
  const now = Date.now();
  const catalog = buildCatalog(now);
  const claimed = playerName ? await claimedIds(playerName) : new Set<string>();

  const views: MissionView[] = [];
  for (const m of catalog) {
    const tab = tabOf(m, now);
    let progress = 0;
    if (playerName && tab !== "upcoming") {
      try {
        progress = await progressFor(playerName, m.metric, m.startsAt, m.endsAt);
      } catch {
        progress = 0;
      }
    }
    progress = Math.min(progress, m.goal);
    const isClaimed = claimed.has(m.id);
    views.push({
      ...m,
      tab,
      progress,
      claimed: isClaimed,
      claimable: !!playerName && tab === "ongoing" && !isClaimed && progress >= m.goal,
      endsInLabel: tab === "ongoing" ? endsInLabel(m.endsAt, now) : null,
    });
  }
  return views;
}

export async function claimMission(
  playerName: string,
  missionId: string
): Promise<{ ok: true; coins: number; reward: number } | { ok: false; error: string }> {
  const views = await listMissionsForPlayer(playerName);
  const mission = views.find((m) => m.id === missionId);
  if (!mission) return { ok: false, error: "Mission not found." };
  if (mission.tab !== "ongoing") return { ok: false, error: "This mission is not active." };
  if (mission.claimed) return { ok: false, error: "Already claimed." };
  if (mission.progress < mission.goal) return { ok: false, error: "Mission not complete yet." };

  await ensureClaimsSchema();
  await ensurePlayerCoinsColumn();

  try {
    await client.execute({
      sql: "INSERT INTO web_mission_claims (player_name, mission_id, claimed_at) VALUES (?, ?, ?)",
      args: [playerName, missionId, Date.now()],
    });
  } catch {
    return { ok: false, error: "Already claimed." };
  }

  await client.execute({
    sql: "UPDATE players SET coins = coins + ? WHERE name = ?",
    args: [mission.rewardCoins, playerName],
  });
  const rs = await client.execute({
    sql: "SELECT coins FROM players WHERE name = ?",
    args: [playerName],
  });
  return { ok: true, coins: Number(rs.rows[0]?.coins ?? 0), reward: mission.rewardCoins };
}
