import { Bracket } from "@/types";

/**
 * Sample bracket for the HyperLeague Invitational S3 (t1).
 * 8-team single elimination bracket with 3 rounds.
 */
export const SAMPLE_BRACKET: Bracket = {
  tournamentId: "t1",
  type: "single",
  rounds: [
    {
      name: "Quarter-Finals",
      matches: [
        {
          id: "b-qf1",
          round: 0,
          position: 0,
          teamA: "Team Alpha",
          teamB: "Team Echo",
          scoreA: 13,
          scoreB: 7,
          winner: "Team Alpha",
          status: "completed",
          scheduledTime: "2025-06-25 14:00",
          map: "Mirage",
        },
        {
          id: "b-qf2",
          round: 0,
          position: 1,
          teamA: "Team Bravo",
          teamB: "Team Foxtrot",
          scoreA: 13,
          scoreB: 11,
          winner: "Team Bravo",
          status: "completed",
          scheduledTime: "2025-06-25 15:30",
          map: "Vertigo",
        },
        {
          id: "b-qf3",
          round: 0,
          position: 2,
          teamA: "Team Charlie",
          teamB: "Team Golf",
          scoreA: 9,
          scoreB: 13,
          winner: "Team Golf",
          status: "completed",
          scheduledTime: "2025-06-25 17:00",
          map: "Anubis",
        },
        {
          id: "b-qf4",
          round: 0,
          position: 3,
          teamA: "Team Delta",
          teamB: "Team Hotel",
          scoreA: 13,
          scoreB: 10,
          winner: "Team Delta",
          status: "completed",
          scheduledTime: "2025-06-25 18:30",
          map: "Nuke",
        },
      ],
    },
    {
      name: "Semi-Finals",
      matches: [
        {
          id: "b-sf1",
          round: 1,
          position: 0,
          teamA: "Team Alpha",
          teamB: "Team Bravo",
          scoreA: 13,
          scoreB: 9,
          winner: "Team Alpha",
          status: "completed",
          scheduledTime: "2025-06-26 16:00",
          map: "Inferno",
        },
        {
          id: "b-sf2",
          round: 1,
          position: 1,
          teamA: "Team Golf",
          teamB: "Team Delta",
          scoreA: 11,
          scoreB: 13,
          winner: "Team Delta",
          status: "completed",
          scheduledTime: "2025-06-26 18:00",
          map: "Mirage",
        },
      ],
    },
    {
      name: "Grand Final",
      matches: [
        {
          id: "b-gf",
          round: 2,
          position: 0,
          teamA: "Team Alpha",
          teamB: "Team Delta",
          scoreA: 2,
          scoreB: 1,
          winner: null,
          status: "live",
          scheduledTime: "2025-06-28 20:00",
          map: "Nuke",
        },
      ],
    },
  ],
};

/**
 * Sample bracket for the HyperLeague Open S2 (t4) — completed.
 * 8-team single elimination, all matches completed.
 */
export const COMPLETED_BRACKET: Bracket = {
  tournamentId: "t4",
  type: "single",
  rounds: [
    {
      name: "Quarter-Finals",
      matches: [
        { id: "c-qf1", round: 0, position: 0, teamA: "Phoenix Rising", teamB: "Storm Legion", scoreA: 13, scoreB: 5, winner: "Phoenix Rising", status: "completed", map: "Vertigo" },
        { id: "c-qf2", round: 0, position: 1, teamA: "Void Walkers", teamB: "Neon Dynasty", scoreA: 13, scoreB: 8, winner: "Void Walkers", status: "completed", map: "Mirage" },
        { id: "c-qf3", round: 0, position: 2, teamA: "Iron Wolves", teamB: "Shadow Ops", scoreA: 11, scoreB: 13, winner: "Shadow Ops", status: "completed", map: "Nuke" },
        { id: "c-qf4", round: 0, position: 3, teamA: "Crimson Tide", teamB: "Arctic Fox", scoreA: 13, scoreB: 12, winner: "Crimson Tide", status: "completed", map: "Anubis" },
      ],
    },
    {
      name: "Semi-Finals",
      matches: [
        { id: "c-sf1", round: 1, position: 0, teamA: "Phoenix Rising", teamB: "Void Walkers", scoreA: 13, scoreB: 10, winner: "Phoenix Rising", status: "completed", map: "Inferno" },
        { id: "c-sf2", round: 1, position: 1, teamA: "Shadow Ops", teamB: "Crimson Tide", scoreA: 13, scoreB: 9, winner: "Shadow Ops", status: "completed", map: "Vertigo" },
      ],
    },
    {
      name: "Grand Final",
      matches: [
        { id: "c-gf", round: 2, position: 0, teamA: "Phoenix Rising", teamB: "Shadow Ops", scoreA: 13, scoreB: 11, winner: "Phoenix Rising", status: "completed", map: "Mirage" },
      ],
    },
  ],
};

/** Map tournament ID to its bracket */
export const BRACKETS: Record<string, Bracket> = {
  t1: SAMPLE_BRACKET,
  t4: COMPLETED_BRACKET,
};
