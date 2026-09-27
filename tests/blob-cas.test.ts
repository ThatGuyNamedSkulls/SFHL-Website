/**
 * M3 (docs/WEBSITE_SECURITY_REPORT.md): JSON-blob writes are compare-and-set.
 * A write that lands mid-request forces the change to re-run its checks on
 * the new data, and parallel edits no longer overwrite each other.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("blobcas");
let cas: typeof import("@/lib/blob-cas");
let teams: typeof import("@/lib/teams");
let client: typeof import("@/lib/db").client;

type Doc = { id: string; allowed: boolean; count: number };

before(async () => {
  cas = await import("@/lib/blob-cas");
  teams = await import("@/lib/teams");
  client = (await import("@/lib/db")).client;
  await teams.listTeams(); // creates web_teams
});

after(async () => {
  await tmp.cleanup(["web_teams"]);
});

describe("compare-and-set blob writes", () => {
  it("re-runs the checks when someone else wrote in between", async () => {
    await client.execute({
      sql: "INSERT INTO web_teams (id, data, updated_at) VALUES ('doc', ?, 0)",
      args: [JSON.stringify({ id: "doc", allowed: true, count: 0 })],
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const pending = cas.mutateBlob<Doc>({
      table: "web_teams",
      id: "doc",
      parse: (raw) => JSON.parse(raw) as Doc,
      notFound: "missing",
      mutate: async (doc) => {
        calls++;
        if (calls === 1) await gate; // the request is mid-flight…
        if (!doc.allowed) throw new Error("permission revoked");
        doc.count++;
      },
    });
    while (calls === 0) await new Promise((r) => setTimeout(r, 1));
    // …when another writer revokes the permission (e.g. a demotion).
    await client.execute({
      sql: "UPDATE web_teams SET data = ? WHERE id = 'doc'",
      args: [JSON.stringify({ id: "doc", allowed: false, count: 0 })],
    });
    release();
    await assert.rejects(pending, /permission revoked/);
    assert.equal(calls, 2);
    const rs = await client.execute("SELECT data FROM web_teams WHERE id = 'doc'");
    assert.equal((JSON.parse(String(rs.rows[0].data)) as Doc).count, 0, "the stale write never landed");
  });

  it("parallel team invites are all kept", async () => {
    const team = await teams.createTeam({
      name: "Racers",
      tag: "RACE",
      captain: { discordId: "c1", username: "cap", playerName: "cap", avatar: null },
    });
    await Promise.all(
      ["p1", "p2", "p3", "p4", "p5"].map((id) =>
        teams.inviteToTeam(team.id, "c1", { discordId: id, username: id, playerName: id, avatar: null })
      )
    );
    const after = (await teams.getTeam(team.id))!;
    assert.equal(after.members.length, 6);
  });

  it("a captain can't delete a team they just handed over", async () => {
    const team = await teams.createTeam({
      name: "Handover",
      tag: "HAND",
      captain: { discordId: "c2", username: "cap2", playerName: "cap2", avatar: null },
    });
    await teams.inviteToTeam(team.id, "c2", { discordId: "n2", username: "n2", playerName: "n2", avatar: null });
    await teams.respondToInvite(team.id, "n2", true);
    await teams.transferCaptain(team.id, "c2", "n2");
    await assert.rejects(teams.deleteTeam(team.id, "c2"), /Only the captain/);
    assert.ok(await teams.getTeam(team.id));
  });

  it("rejects non-https team images", async () => {
    await assert.rejects(
      teams.createTeam({
        name: "Links",
        tag: "LNK",
        logoUrl: "javascript:alert(1)",
        captain: { discordId: "c3", username: "cap3", playerName: "cap3", avatar: null },
      }),
      /https/
    );
  });
});
