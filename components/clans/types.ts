import type { ClanListStats } from "@/lib/clan-stats";
import type { ClanPayload } from "@/lib/clan-payload";

/** One clan in GET /api/clubs. */
export interface ClanListItem {
  id: string;
  name: string;
  tag: string;
  accentColor: string;
  logoUrl: string | null;
  description: string;
  region: string;
  ownerId: string;
  ownerName: string;
  memberCount: number;
  private: boolean;
  createdAt: number;
  mine: boolean;
  /** The viewer's role name in this clan, when a member. */
  myRole: string | null;
  stats: ClanListStats | null;
}

export interface ClanListData {
  count: number;
  createCost: number;
  maxOwned: number;
  ownedCount: number;
  clubs: ClanListItem[];
}

/** GET /api/clubs/[id] and every clan action. */
export type ClanData = ClanPayload;
export type ClanMember = ClanPayload["club"]["members"][number];
export type ClanRole = ClanPayload["club"]["roles"][number];
export type ClanEventData = ClanPayload["activity"][number];
