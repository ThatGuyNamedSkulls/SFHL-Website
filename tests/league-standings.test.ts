/**
 * League UI step 4 (docs/LEAGUE_UI_PLAN.md): the Standings stage stepper
 * (Regular season → Playoffs → Final results) and the tiebreak badge; league v2
 * (docs/LEAGUE_V2_PLAN.md C2/C3): outcome cards, promotion/relegation zones
 * (checked against seasonMoves) and the conference filters. Pure — no DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NO_MOVES,
  PLAYOFF_LINE,
  conferenceGroups,
  defaultStage,
  divisionMoves,
  downText,
  filterPicker,
  parseDivisionFilter,
  parseStage,
  regularZone,
  shortSpan,
  shownMoves,
  stageNote,
  stageOutcomes,
  standingsPicker,
  standingsStages,
  tiebrokenTeams,
  upText,
  type StageInput,
} from "@/lib/league-standings";
import { seasonMoves } from "@/lib/league-swiss";

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

describe("promotion / relegation on the Standings tab (league v2 C2)", () => {
  const PRIZES = [5000, 2500, 1000];

  it("divisionMoves: where each level goes and how many move", () => {
    assert.deepEqual(divisionMoves("main", 8), {
      levels: ["main"],
      up: 2,
      down: 2,
      upTo: [["main", "advanced"]],
      downTo: [["main", "intermediate"]],
    });
    assert.deepEqual([divisionMoves("pro", 16).up, divisionMoves("pro", 16).down], [0, 4]);
    assert.deepEqual([divisionMoves("open89", 9).up, divisionMoves("open89", 9).down], [2, 0]);
    assert.deepEqual([divisionMoves("open57", 9).up, divisionMoves("open57", 9).down], [0, 0]);
    assert.deepEqual(divisionMoves(null, 8), NO_MOVES);
  });

  it("the zones match seasonMoves for every level and size", () => {
    for (const code of ["pro", "advanced", "main", "intermediate", "entry", "open10", "open89", "open57", "open14"]) {
      for (let n = 4; n <= 32; n++) {
        const places = Array.from({ length: n }, (_, i) => `t${i}`);
        const moved = seasonMoves(places, Object.fromEntries(places.map((t) => [t, code])));
        const moves = divisionMoves(code, n);
        const ups = moved.filter((m) => m.direction === "up").map((m) => places.indexOf(m.teamId));
        const downs = moved.filter((m) => m.direction === "down").map((m) => places.indexOf(m.teamId));
        assert.deepEqual(ups, Array.from({ length: moves.up }, (_, i) => i), `${code} ${n} up`);
        assert.deepEqual(downs, Array.from({ length: moves.down }, (_, i) => n - moves.down + i), `${code} ${n} down`);
        // The red zone of the regular table is exactly the relegated places (when the table decides them).
        const red = places.map((_, i) => regularZone(i, n, moves)).flatMap((z, i) => (z === "relegation" ? [i] : []));
        assert.deepEqual(red, n - moves.down >= PLAYOFF_LINE ? downs : [], `${code} ${n} red zone`);
      }
    }
  });

  it("regular table zones: promotion playoffs on top, relegations at the bottom", () => {
    const main8 = divisionMoves("main", 8);
    assert.deepEqual(
      Array.from({ length: 8 }, (_, i) => regularZone(i, 8, main8)),
      ["promotion", "promotion", "promotion", "promotion", null, null, "relegation", "relegation"]
    );
    // Open 5-7: plain playoffs, nobody moves.
    const open57 = divisionMoves("open57", 6);
    assert.deepEqual(Array.from({ length: 6 }, (_, i) => regularZone(i, 6, open57)), [
      "playoffs", "playoffs", "playoffs", "playoffs", null, null,
    ]);
    // 4 teams: the 4th place after the playoffs goes down, so no red rows in the table.
    const entry4 = divisionMoves("entry", 4);
    assert.deepEqual(Array.from({ length: 4 }, (_, i) => regularZone(i, 4, entry4)), [
      "promotion", "promotion", "promotion", "promotion",
    ]);
  });

  it("outcome texts: single level, merged levels and Open 10", () => {
    assert.deepEqual(upText(divisionMoves("main", 8)), { title: "Promoted to Advanced status", short: "Up to Advanced", note: null });
    assert.deepEqual(downText(divisionMoves("main", 8)), { title: "Relegated to Intermediate status", short: "Down to Intermediate", note: null });
    const top = divisionMoves("pro+advanced", 6);
    assert.deepEqual(upText(top), { title: "Promoted to Pro status", short: "Up to Pro", note: "Advanced teams" });
    assert.deepEqual(downText(top), {
      title: "Relegated one level",
      short: "One level down",
      note: "Pro → Advanced · Advanced → Main",
    });
    // Open 10 only goes up (owner, 2026-09-25): its level comes from the players' Elo.
    assert.deepEqual([divisionMoves("open10", 12).up, divisionMoves("open10", 12).down], [3, 0]);
    assert.equal(upText(divisionMoves("open10", 12)).title, "Promoted to Entry status");
    assert.equal(upText(divisionMoves("open89", 9)).title, "Promoted to Open 10 status");
    assert.deepEqual(divisionMoves("entry+open10", 6).downTo, [["entry", "open10"]]);
    assert.equal(downText(divisionMoves("entry+open10", 6)).note, "Entry teams");
  });

  it("stage outcome cards", () => {
    const main8 = divisionMoves("main", 8);
    const cards = (stage: "regular" | "playoffs" | "final", moves = main8, n = 8) =>
      stageOutcomes(stage, moves, n, PRIZES).map((o) => [o.kind, o.tone, o.title, o.places]);
    assert.deepEqual(cards("regular"), [
      ["playoffs", "green", "Qualify for the playoffs", "1st–4th"],
      ["down", "red", "Relegated to Intermediate status", "7th–8th"],
    ]);
    assert.equal(stageOutcomes("regular", main8, 8, PRIZES)[0].note, "The top 2 after the playoffs go up to Advanced");
    assert.deepEqual(cards("playoffs"), [
      ["up", "green", "Promoted to Advanced status", "1st–2nd"],
      ["prize", "gold", "5,000 · 2,500 · 1,000 HL Coins", "1st–3rd"],
    ]);
    assert.deepEqual(cards("final"), [
      ["up", "green", "Promoted to Advanced status", "1st–2nd"],
      ["down", "red", "Relegated to Intermediate status", "7th–8th"],
      ["prize", "gold", "5,000 · 2,500 · 1,000 HL Coins", "1st–3rd"],
    ]);
    // Pro/Advanced, 5 teams: one goes up, and only an Advanced team can.
    assert.equal(
      stageOutcomes("regular", divisionMoves("pro+advanced", 5), 5, PRIZES)[0].note,
      "The playoff champion goes up to Pro · Advanced teams"
    );
    // 16 teams: all 4 playoff teams go up.
    assert.equal(stageOutcomes("regular", divisionMoves("main", 16), 16, PRIZES)[0].note, "All 4 go up to Advanced · the playoffs decide the champion");
    // 4 teams: the playoffs decide the relegated place.
    assert.deepEqual(cards("regular", divisionMoves("entry", 4), 4), [["playoffs", "green", "Qualify for the playoffs", "1st–4th"]]);
    assert.deepEqual(cards("playoffs", divisionMoves("entry", 4), 4).map((c) => [c[0], c[3]]), [
      ["up", "1st"],
      ["down", "4th"],
      ["prize", "1st–3rd"],
    ]);
    // Open 5-7: played for fun.
    assert.deepEqual(cards("regular", divisionMoves("open57", 6), 6), [
      ["playoffs", "orange", "Qualify for the playoffs", "1st–4th"],
      ["info", "neutral", "No promotion or relegation", "Every place"],
    ]);
  });

  it("a season that ended before promotion existed shows no moves", () => {
    assert.deepEqual(shownMoves("main", 8, [{ movement: null }, { movement: null }]), NO_MOVES);
    assert.equal(shownMoves("main", 8, [{ movement: "up" }, { movement: null }]).up, 2);
    assert.equal(shownMoves("main", 8, []).up, 2);
  });
});

describe("conferences (league v2 C3)", () => {
  const divisions = [
    { id: 1, name: "Pro/Advanced", code: "pro+advanced" },
    { id: 2, name: "Open 10 A", code: "open10" },
    { id: 3, name: "Open 10 B", code: "open10" },
    { id: 4, name: "Open 5-7", code: "open57" },
    { id: 5, name: "Group B", code: null },
  ];
  const groups = conferenceGroups(divisions);

  it("groups a split division's conferences", () => {
    assert.deepEqual(groups, [
      { name: "Pro/Advanced", code: "pro+advanced", conferences: [{ id: 1, letter: null }] },
      { name: "Open 10", code: "open10", conferences: [{ id: 2, letter: "A" }, { id: 3, letter: "B" }] },
      { name: "Open 5-7", code: "open57", conferences: [{ id: 4, letter: null }] },
      { name: "Group B", code: null, conferences: [{ id: 5, letter: null }] },
    ]);
  });

  it("Standings: the division opens your conference; the conference select lists A, B", () => {
    const picker = standingsPicker(groups, 3, new Set([2]));
    assert.deepEqual(picker.division, {
      value: "2",
      options: [
        { value: "1", label: "Pro/Advanced" },
        { value: "2", label: "Open 10 · your team" },
        { value: "4", label: "Open 5-7" },
        { value: "5", label: "Group B" },
      ],
    });
    assert.deepEqual(picker.conference, {
      value: "3",
      options: [
        { value: "2", label: "Conference A · your team" },
        { value: "3", label: "Conference B" },
      ],
    });
    assert.equal(standingsPicker(groups, 4).conference, null);
  });

  it("Teams / Stats: one conference, all of a division's conferences, or everything", () => {
    assert.deepEqual(parseDivisionFilter("3", groups).ids, [3]);
    assert.deepEqual(parseDivisionFilter("open10", groups).ids, [2, 3]);
    assert.deepEqual(parseDivisionFilter("open57", groups), { ids: null, group: null, value: "" });
    assert.deepEqual(parseDivisionFilter("99", groups).ids, null);
    assert.deepEqual(parseDivisionFilter(undefined, groups).ids, null);

    const all = filterPicker(groups, parseDivisionFilter(undefined, groups));
    assert.deepEqual(all.division.options.map((o) => o.value), ["", "1", "open10", "4", "5"]);
    assert.equal(all.conference, null);

    const split = filterPicker(groups, parseDivisionFilter("open10", groups), (ids) => ` · ${ids.length}`);
    assert.equal(split.division.value, "open10");
    assert.deepEqual(split.conference, {
      value: "open10",
      options: [
        { value: "open10", label: "All conferences · 2" },
        { value: "2", label: "Conference A · 1" },
        { value: "3", label: "Conference B · 1" },
      ],
    });
    assert.equal(filterPicker(groups, parseDivisionFilter("3", groups)).conference?.value, "3");
  });
});
