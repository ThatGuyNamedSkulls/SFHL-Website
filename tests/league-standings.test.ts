/**
 * League UI step 4 (docs/LEAGUE_UI_PLAN.md): the Standings stage stepper
 * (Regular season → Playoffs → Final results) and the tiebreak badge. Pure — no DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultStage,
  parseStage,
  shortSpan,
  stageNote,
  standingsStages,
  tiebrokenTeams,
  type StageInput,
} from "@/lib/league-standings";

const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 7); // a Monday
const season = (status: StageInput["season"]["status"]) => ({ status, startDate: START, weeks: 6 });
const states = (input: StageInput) => standingsStages(input).map((s) => s.state);

describe("standingsStages", () => {
  it("drawn: everything still to come", () => {
    const st = standingsStages({ season: season("drawn"), playoffs: [], placed: 0, events: {} });
    assert.deepEqual(st.map((s) => s.state), ["upcoming", "upcoming", "upcoming"]);
    assert.equal(st[0].at, START);
    assert.equal(st[1].at, START + 6 * 7 * DAY);
    assert.equal(defaultStage(st), "regular");
  });

  it("regular: the regular season is live and ends after week 6", () => {
    const st = standingsStages({ season: season("regular"), playoffs: [], placed: 0, events: {} });
    assert.deepEqual(st.map((s) => s.state), ["live", "upcoming", "upcoming"]);
    assert.equal(st[0].at, START + 6 * 7 * DAY);
    assert.equal(stageNote(st[0], START + 6 * 7 * DAY - 3 * DAY), "Ends in 3d");
    assert.equal(stageNote(st[0], START + 6 * 7 * DAY + DAY), "Wrapping up");
  });

  it("playoffs: regular done at the playoffs_started event, playoffs live and the default tab", () => {
    const input: StageInput = {
      season: season("playoffs"),
      playoffs: [
        { round: "semi1", status: "scheduled" },
        { round: "semi2", status: "final" },
      ],
      placed: 0,
      events: { playoffs_started: START + 40 * DAY },
    };
    const st = standingsStages(input);
    assert.deepEqual(st.map((s) => s.state), ["done", "live", "upcoming"]);
    assert.equal(st[0].at, START + 40 * DAY);
    assert.equal(defaultStage(st), "playoffs");
  });

  it("playoffs: done once the final and third-place match are over", () => {
    const playoffs = [
      { round: "semi1", status: "final" },
      { round: "semi2", status: "final" },
      { round: "final", status: "forfeit" },
      { round: "third", status: "final" },
    ] as StageInput["playoffs"];
    assert.deepEqual(states({ season: season("playoffs"), playoffs, placed: 0, events: {} }), ["done", "done", "upcoming"]);
    const waiting = playoffs.map((m) => (m.round === "third" ? { ...m, status: "reported" as const } : m));
    assert.deepEqual(states({ season: season("playoffs"), playoffs: waiting, placed: 0, events: {} }), ["done", "live", "upcoming"]);
  });

  it("a division without playoff matches marks the stage 'none'", () => {
    const st = standingsStages({ season: season("playoffs"), playoffs: [], placed: 0, events: {} });
    assert.equal(st[1].state, "none");
    assert.equal(stageNote(st[1]), "No playoffs");
    assert.equal(defaultStage(st), "regular");
  });

  it("finished: all done, opens on final results", () => {
    const st = standingsStages({
      season: season("finished"),
      playoffs: [{ round: "final", status: "final" }],
      placed: 6,
      events: { season_finished: START + 55 * DAY },
    });
    assert.deepEqual(st.map((s) => s.state), ["done", "done", "done"]);
    assert.equal(st[2].at, START + 55 * DAY);
    assert.equal(stageNote(st[2]), "All placed");
    assert.equal(defaultStage(st), "final");
  });

  it("no start date: stages have no planned times", () => {
    const st = standingsStages({
      season: { status: "drawn", startDate: null, weeks: 6 },
      playoffs: [],
      placed: 0,
      events: {},
    });
    assert.deepEqual(st.map((s) => s.at), [null, null, null]);
    assert.equal(stageNote(st[0]), "Not started");
  });
});

describe("standings helpers", () => {
  it("parseStage only accepts the three stages", () => {
    assert.equal(parseStage("playoffs"), "playoffs");
    assert.equal(parseStage("final"), "final");
    assert.equal(parseStage("bogus"), null);
    assert.equal(parseStage(["regular"]), null);
    assert.equal(parseStage(undefined), null);
  });

  it("shortSpan rounds to days, hours or minutes", () => {
    assert.equal(shortSpan(3 * DAY, 0), "3d");
    assert.equal(shortSpan(5 * 3_600_000, 0), "5h");
    assert.equal(shortSpan(0, 20 * 60_000), "20m");
    assert.equal(shortSpan(1, 0), "1m");
  });

  it("tiebrokenTeams marks teams level on points, ignoring unplayed ones", () => {
    const rows = [
      { teamId: "a", points: 9, played: 3 },
      { teamId: "b", points: 6, played: 3 },
      { teamId: "c", points: 6, played: 3 },
      { teamId: "d", points: 3, played: 3 },
      { teamId: "e", points: 0, played: 0 },
      { teamId: "f", points: 0, played: 0 },
    ];
    assert.deepEqual([...tiebrokenTeams(rows)].sort(), ["b", "c"]);
  });
});
