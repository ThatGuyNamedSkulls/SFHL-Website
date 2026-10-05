/**
 * The staff panel's Teams tab (CBL bot docs/STAFF_PANEL_PLAN.md step 6): every
 * website team with its titles (cup wins etc.). Awarding and removing go
 * through the bot's /teamtitle commands (lib/staff-jobs.ts).
 */
import { client } from "@/lib/db";

export interface StaffTeamTitle {
  id: number;
  title: string;
  awardedBy: string | null;
  awardedAt: number;
}

export interface StaffTeam {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  members: number;
  titles: StaffTeamTitle[];
}

type Row = Record<string, unknown>;

async function rows(sql: string): Promise<Row[]> {
  try {
    return (await client.execute(sql)).rows as unknown as Row[];
  } catch {
    return [];
  }
}

export async function staffTeamsView(): Promise<{ teams: StaffTeam[] }> {
  const [teams, titles] = await Promise.all([
    rows("SELECT id, data FROM web_teams ORDER BY updated_at DESC"),
    rows("SELECT id, team_id, title, awarded_by, awarded_at FROM team_titles ORDER BY awarded_at DESC"),
  ]);
  const byTeam = new Map<string, StaffTeamTitle[]>();
  for (const t of titles) {
    const teamId = String(t.team_id);
    byTeam.set(teamId, [
      ...(byTeam.get(teamId) ?? []),
      {
        id: Number(t.id),
        title: String(t.title),
        awardedBy: t.awarded_by == null ? null : String(t.awarded_by),
        awardedAt: Number(t.awarded_at) || 0,
      },
    ]);
  }
  const out: StaffTeam[] = [];
  for (const row of teams) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(String(row.data)) as Record<string, unknown>;
    } catch {
      continue;
    }
    const id = String(data.id ?? row.id ?? "");
    const name = String(data.name ?? "").trim();
    if (!id || !name) continue; // the bot's find_team skips these too
    out.push({
      id,
      name,
      tag: String(data.tag ?? ""),
      logoUrl: typeof data.logoUrl === "string" && data.logoUrl ? data.logoUrl : null,
      members: Array.isArray(data.members) ? data.members.length : 0,
      titles: byTeam.get(id) ?? [],
    });
  }
  return { teams: out };
}
