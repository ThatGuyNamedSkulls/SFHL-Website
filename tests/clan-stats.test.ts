/**
 * The clan pages' pure helpers (docs/CLANS_UI_PLAN.md): matches together (2+
 * members on one team), averages, the activity feed, and the list's sorting,
 * 7-day bars, rules and links.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { averageElo, buildActivity, groupTogether, togetherCounts, type TogetherRow } from "@/lib/clan-together";
import { clanHref, isClanTab, kdOf, rulesLines, shortAgo, sortClans, weekBars } from "@/lib/clan-ui";
import { localDayKey } from "@/lib/profile-stats";
import { performanceRating } from "@/lib/match-stats";
import { getRankForElo } from "@/data/ranks";

const row = (over: Partial<TogetherRow>): TogetherRow => ({
  matchId: 1,
  team: 1,
  result: "W",
  timestamp: "2026-10-02 18:00:00",
  map: "de_mirage",
  roundScore: "13,9",
  player: "ana",
  eloChange: 20,
  ...over,
});

describe("groupTogether", () => {
  it("two or more members on the same team make a match together", () => {
    const out = groupTogether([
      row({ player: "ana", eloChange: 20 }),
      row({ player: "bo", eloChange: 22 }),
      row({ player: "cy", team: 2, result: "L" }), // other side: alone there
    ]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].players, ["ana", "bo"]);
    assert.equal(out[0].result, "W");
    assert.equal(out[0].map, "Mirage");
    assert.equal(out[0].score, "13:9");
    assert.equal(out[0].eloChange, 21);
  });

  it("the members' Elo after the match, average rating and best member from their scoreboard lines", () => {
    const line = { roundScore: "13,9", roundsPlayed: 22, mvps: 2, points: 50, assists: 3 };
    const [m] = groupTogether([
      row({ player: "ana", eloChange: 20, eloBefore: 1500, kills: 25, deaths: 10, ...line }),
      row({ player: "bo", eloChange: 22, eloBefore: 1600, kills: 12, deaths: 15, ...line }),
      row({ player: "cy", eloChange: 18, eloBefore: null, kills: 8, deaths: 16, ...line }), // no Elo: left out of it
    ]);
    assert.equal(m.elo, Math.round((1520 + 1622) / 2));
    assert.equal(m.rank, getRankForElo(1571).letter);
    const ratings = [25, 12, 8].map((kills, i) =>
      performanceRating({ kills, deaths: [10, 15, 16][i], assists: 3, rounds: 22, score: 50, mvps: 2 })
    );
    assert.equal(m.rating, Math.round((ratings.reduce((s, r) => s + r, 0) / 3) * 100) / 100);
    assert.deepEqual(m.best, { name: "ana", rating: ratings[0], kills: 25, deaths: 10, assists: 3 });
  });

  it("without scoreboard lines or Elo there's no rating, best member or Elo", () => {
    const [m] = groupTogether([row({ player: "ana" }), row({ player: "bo" })]);
    assert.equal(m.rating, null);
    assert.equal(m.best, null);
    assert.equal(m.elo, null);
    assert.equal(m.rank, "UNRANKED");
  });

  it("opponents in the same match are not together", () => {
    const out = groupTogether([row({ player: "ana", team: 1 }), row({ player: "bo", team: 2, result: "L" })]);
    assert.equal(out.length, 0);
  });

  it("old rows without a team group by result; a member counted twice still counts once", () => {
    const out = groupTogether([
      row({ matchId: 7, team: null, player: "ana" }),
      row({ matchId: 7, team: null, player: "ANA" }),
      row({ matchId: 7, team: null, player: "bo", result: "L" }),
    ]);
    assert.equal(out.length, 0);
    const pair = groupTogether([row({ matchId: 8, team: null, player: "ana" }), row({ matchId: 8, team: null, player: "bo" })]);
    assert.equal(pair.length, 1);
  });

  it("rows without a match id are skipped; newest first; counts per member", () => {
    const out = groupTogether([
      row({ matchId: null, player: "x" }),
      row({ matchId: 1, timestamp: "2026-10-01 10:00:00", player: "ana" }),
      row({ matchId: 1, timestamp: "2026-10-01 10:00:00", player: "bo" }),
      row({ matchId: 2, timestamp: "2026-10-02 10:00:00", player: "ana" }),
      row({ matchId: 2, timestamp: "2026-10-02 10:00:00", player: "cy" }),
    ]);
    assert.deepEqual(out.map((m) => m.matchId), [2, 1]);
    const counts = togetherCounts(out);
    assert.equal(counts.get("ana"), 2);
    assert.equal(counts.get("bo"), 1);
  });
});

describe("averageElo", () => {
  it("over placed members only, with the rank it falls in", () => {
    assert.deepEqual(
      averageElo([
        { elo: 1500, placementDone: true },
        { elo: 1600, placementDone: true },
        { elo: 0, placementDone: false },
      ]),
      { avg: 1550, ranked: 2, rank: "A3" }
    );
    assert.deepEqual(averageElo([{ elo: 0, placementDone: false }]), { avg: 0, ranked: 0, rank: "UNRANKED" });
  });
});

describe("buildActivity", () => {
  it("matches, joins, the creation and cups, newest first; the owner's own join is the creation", () => {
    const created = Date.UTC(2026, 8, 1);
    const events = buildActivity({
      together: groupTogether([row({ player: "ana" }), row({ player: "bo" })]),
      members: [
        { name: "ana", joinedAt: created, owner: true },
        { name: "bo", joinedAt: Date.UTC(2026, 8, 5), owner: false },
      ],
      createdAt: created,
      ownerName: "ana",
      cups: [{ id: "c1", name: "Cup", status: "open", teams: 2, size: 8, createdAt: Date.UTC(2026, 8, 20) }],
    });
    assert.deepEqual(events.map((e) => e.kind), ["match", "cup", "join", "created"]);
    assert.equal(events.filter((e) => e.kind === "join").length, 1);
  });

  it("keeps the newest `limit`", () => {
    const members = Array.from({ length: 30 }, (_, i) => ({ name: `p${i}`, joinedAt: 1000 + i * 60_000 * 5, owner: false }));
    const events = buildActivity({ together: [], members, createdAt: 0, ownerName: "x", cups: [], limit: 5 });
    assert.equal(events.length, 5);
    assert.equal(events[0].kind === "join" && events[0].name, "p29");
  });
});

describe("clan list helpers", () => {
  const clans = [
    { name: "B", memberCount: 9, createdAt: 3, stats: { avgElo: 1200, week: ["2026-10-02 10:00:00"] } },
    { name: "A", memberCount: 4, createdAt: 2, stats: { avgElo: 1700, week: ["2026-10-01 10:00:00", "2026-09-30 10:00:00"] } },
    { name: "C", memberCount: 12, createdAt: 1, stats: null },
  ];

  it("sorts by activity, members, average Elo or age", () => {
    assert.deepEqual(sortClans(clans, "active").map((c) => c.name), ["A", "B", "C"]);
    assert.deepEqual(sortClans(clans, "members").map((c) => c.name), ["C", "B", "A"]);
    assert.deepEqual(sortClans(clans, "elo").map((c) => c.name), ["A", "B", "C"]);
    assert.deepEqual(sortClans(clans, "new").map((c) => c.name), ["B", "A", "C"]);
  });

  it("7-day bars count matches per local day, oldest first", () => {
    const now = new Date(2026, 9, 3, 15, 0).getTime();
    const local = (d: number, h: number) => new Date(2026, 9, d, h).toISOString().slice(0, 19).replace("T", " ");
    const bars = weekBars([local(3, 9), local(3, 11), local(1, 20), local(20, 1), "nonsense"], now);
    assert.equal(bars.length, 7);
    assert.equal(bars[6], 2); // today
    assert.equal(bars[4], 1); // two days ago
    assert.equal(bars.reduce((a, b) => a + b, 0), 3);
    assert.equal(localDayKey(now), "2026-10-03");
  });

  it("rules: one per line, numbering and bullets dropped", () => {
    assert.deepEqual(rulesLines("1. Be on time\n2) No toxicity\n\n- Have fun\n"), ["Be on time", "No toxicity", "Have fun"]);
    assert.deepEqual(rulesLines(""), []);
  });

  it("K/D, short times and links", () => {
    assert.equal(kdOf(30, 20, 3), 1.5);
    assert.equal(kdOf(5, 0, 1), 5);
    assert.equal(kdOf(0, 0, 0), null);
    const now = Date.UTC(2026, 9, 3, 12);
    assert.equal(shortAgo(now - 30_000, now), "just now");
    assert.equal(shortAgo(now - 12 * 60_000, now), "12m ago");
    assert.equal(shortAgo(now - 2 * 3600_000, now), "2h ago");
    assert.equal(shortAgo(now - 26 * 3600_000, now), "Yesterday");
    assert.equal(shortAgo(now - 4 * 86_400_000, now), "4d ago");
    assert.equal(clanHref("NOVA"), "/clans/NOVA");
    assert.equal(clanHref("e113d3e7", "members"), "/clans/e113d3e7?tab=members");
    assert.equal(clanHref("NOVA", "overview"), "/clans/NOVA");
    assert.ok(isClanTab("manage"));
    assert.ok(!isClanTab("rules"));
  });
});
