/**
 * Win chance shown on the website must match the bot, stay frozen per match,
 * and treat unrated players as the 1200 seed — never as 0 Elo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  expectedWinChance,
  perceivedSkill,
  preMatchElo,
  sideAverage,
  storedWinChances,
  teamWinChances,
} from "@/lib/win-chance";

/** The bot's expected_score (core/elo.py) with the shipped profile knobs. */
function botExpected(team: number, opp: number): number {
  const raw = 1 / (1 + 10 ** ((opp - team) / 400));
  return Math.round((0.5 + (raw - 0.5) * 0.7) * 100);
}

describe("seed and perceived skill", () => {
  it("counts a missing or 0 rating as the 1200 seed", () => {
    assert.equal(preMatchElo(0), 1200);
    assert.equal(preMatchElo(null), 1200);
    assert.equal(preMatchElo(undefined), 1200);
    assert.equal(preMatchElo(1450), 1450);
  });

  it("uses Elo for ranked players and the hidden rating while placing", () => {
    assert.equal(perceivedSkill({ placementDone: true, elo: 1500 }), 1500);
    assert.equal(perceivedSkill({ placementDone: true, elo: 1500, eloBefore: 1420 }), 1420);
    assert.equal(perceivedSkill({ placementDone: false, elo: 0, mmr: 1310 }), 1310);
    assert.equal(perceivedSkill({ placementDone: false, elo: 0, mmr: 0 }), 1200);
    assert.equal(perceivedSkill({ placementDone: false, elo: 0, mmr: null }), 1200);
  });
});

describe("expected win chance", () => {
  it("matches the bot's formula across rating gaps", () => {
    for (const [a, b] of [[1200, 1200], [1400, 1000], [900, 1500], [2000, 1990], [1200, 0]]) {
      assert.equal(expectedWinChance(a, b), botExpected(a, b), `${a} vs ${b}`);
    }
  });

  it("is 50/50 for an even match and always sums to 100", () => {
    const even = teamWinChances([{ skill: 1200 }], [{ skill: 1200 }]);
    assert.deepEqual(even, { teamA: 50, teamB: 50 });
    const uneven = teamWinChances([{ skill: 1500 }], [{ skill: 1100 }])!;
    assert.equal(uneven.teamA + uneven.teamB, 100);
    assert.ok(uneven.teamA > 50);
  });

  it("does not treat new players as free wins", () => {
    const got = teamWinChances(
      [{ elo_before: 0 }, { elo_before: 0 }],
      [{ elo_before: 1200 }, { elo_before: 1200 }]
    );
    assert.deepEqual(got, { teamA: 50, teamB: 50 });
  });

  it("returns null when a side is empty", () => {
    assert.equal(teamWinChances([], [{ skill: 1200 }]), null);
  });
});

describe("substitute slots", () => {
  it("weights a sub and the player they replaced by time played, like the bot", () => {
    // Slot: leaver 1000 for 40% of the match, sub 1500 for 60% -> 1300.
    const side = [
      { skill: 1100 },
      { skill: 1000, left_early: 1, sub_share: 0.4 },
      { skill: 1500, is_sub: 1, sub_share: 0.6 },
    ];
    assert.equal(sideAverage(side), (1100 + 1300) / 2);
  });

  it("falls back to dropping the leaver on legacy rows without shares", () => {
    const side = [{ skill: 1100 }, { skill: 1000, left_early: 1 }, { skill: 1500, is_sub: 1 }];
    assert.equal(sideAverage(side), (1100 + 1500) / 2);
  });
});

describe("frozen odds from the match rows", () => {
  it("uses the stored chance instead of recomputing", () => {
    const got = storedWinChances([{ win_chance: 34 }, { win_chance: 34 }], [{ win_chance: 66 }]);
    assert.deepEqual(got, { teamA: 34, teamB: 66 });
  });

  it("derives the other side when only one side has it", () => {
    assert.deepEqual(storedWinChances([{ win_chance: 70 }], [{}]), { teamA: 70, teamB: 30 });
    assert.deepEqual(storedWinChances([{}], [{ win_chance: 45 }]), { teamA: 55, teamB: 45 });
  });

  it("returns null for legacy rows so the caller can fall back", () => {
    assert.equal(storedWinChances([{ win_chance: null }], [{}]), null);
  });
});
