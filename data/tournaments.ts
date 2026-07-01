import { Tournament } from "@/types";

/**
 * Preview tournaments. SFHL does not yet run tournaments through the site,
 * so these illustrate how the feature will look. The Tournaments page marks
 * this section as a preview.
 */
export const TOURNAMENTS: Tournament[] = [
  {
    id: "t1",
    name: "SFHL Season 1 Cup",
    status: "live",
    prizePool: "5,000 SP",
    teams: 8,
    maxTeams: 8,
    format: "Single Elimination · BO3",
    region: "EU",
    startDate: "2026-06-25",
    mapPool: ["Mirage", "Inferno", "Nuke", "Ancient"],
  },
  {
    id: "t2",
    name: "SFHL Weekly #4",
    status: "upcoming",
    prizePool: "1,500 SP",
    teams: 6,
    maxTeams: 8,
    format: "Single Elimination · BO1",
    region: "EU",
    startDate: "2026-07-10",
    mapPool: ["Mirage", "Overpass", "Anubis", "Vertigo"],
  },
  {
    id: "t3",
    name: "SFHL Newcomers Cup",
    status: "upcoming",
    prizePool: "Rank Rewards",
    teams: 4,
    maxTeams: 8,
    format: "Round Robin",
    region: "EU",
    startDate: "2026-07-20",
    mapPool: ["Inferno", "Dust II", "Mirage", "Ancient"],
  },
  {
    id: "t4",
    name: "SFHL Preseason Invitational",
    status: "completed",
    prizePool: "3,000 SP",
    teams: 8,
    maxTeams: 8,
    format: "Single Elimination · BO3",
    region: "EU",
    startDate: "2026-05-15",
    mapPool: ["Mirage", "Vertigo", "Nuke", "Inferno", "Ancient"],
  },
];
