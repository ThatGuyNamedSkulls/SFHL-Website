export type MissionTab = "upcoming" | "ongoing" | "ended";
export type MissionMetric = "wins" | "matches" | "placement_done";
export type MissionCategory = "all" | "monthly" | "sf" | "sponsored";

export interface MissionDef {
  id: string;
  title: string;
  description: string;
  goal: number;
  metric: MissionMetric;
  rewardCoins: number;
  startsAt: number;
  endsAt: number;
  category: Exclude<MissionCategory, "all">;
  organizedBy: string;
}

export interface MissionView extends MissionDef {
  tab: MissionTab;
  progress: number;
  claimed: boolean;
  claimable: boolean;
  endsInLabel: string | null;
}
