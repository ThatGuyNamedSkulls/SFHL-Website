/**
 * League UI step 8 (docs/LEAGUE_UI_PLAN.md): the Rules tab text format
 * (# section, - bullet, paragraphs) and the standard rules round trip. Pure.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultRules, parseRules, rulesToText } from "@/lib/league-rules";

const CONSTS = { weeks: 6, rosterMin: 5, rosterMax: 11, prizes: [5000, 2500, 1000] };

describe("rules format", () => {
  it("sections, bullets and paragraphs", () => {
    const got = parseRules(
      [
        "Welcome to the season.",
        "Read everything.",
        "",
        "# Teams",
        "- Five players",
        "* Seven at most",
        "Captains sign up.",
        "- A new list after a paragraph",
        "",
        "## Teams",
        "• Duplicate titles get their own anchor",
        "# Empty section",
      ].join("\r\n")
    );
    assert.deepEqual(
      got.map((s) => [s.title, s.anchor, s.blocks.map((b) => [b.kind, b.lines])]),
      [
        [null, "intro", [["p", ["Welcome to the season.", "Read everything."]]]],
        [
          "Teams",
          "teams",
          [
            ["ul", ["Five players", "Seven at most"]],
            ["p", ["Captains sign up."]],
            ["ul", ["A new list after a paragraph"]],
          ],
        ],
        ["Teams", "teams-2", [["ul", ["Duplicate titles get their own anchor"]]]],
        ["Empty section", "empty-section", []],
      ]
    );
  });

  it("a blank line splits paragraphs and lists", () => {
    const got = parseRules("one\ntwo\n\nthree\n- a\n\n- b");
    assert.deepEqual(got[0].blocks, [
      { kind: "p", lines: ["one", "two"] },
      { kind: "p", lines: ["three"] },
      { kind: "ul", lines: ["a"] },
      { kind: "ul", lines: ["b"] },
    ]);
    assert.deepEqual(parseRules("   \n\n"), [], "nothing written");
    assert.equal(parseRules("#no-space is a paragraph")[0].blocks[0].kind, "p");
  });

  it("the standard rules survive text → parse (the editor's starting point)", () => {
    const std = defaultRules(CONSTS);
    assert.deepEqual(
      std.map((s) => s.title),
      ["Teams & rosters", "Divisions", "Season format", "Scheduling", "Results", "Prizes"]
    );
    assert.match(std[0].blocks[0].lines[0], /needs 5–11 accepted players/);
    assert.match(std[5].blocks[0].lines[0], /5,000 \/ 2,500 \/ 1,000 HL Coins/);
    const round = parseRules(rulesToText(std));
    assert.deepEqual(round, std);
    assert.equal(std[0].anchor, "teams-rosters");
  });
});
