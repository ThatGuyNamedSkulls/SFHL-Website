/**
 * A login cookie for local speed tests (docs/PERFORMANCE_PLAN.md step 16).
 *
 *   NEXTAUTH_SECRET=local-perf-secret npx tsx scripts/perf/mint-session.ts <discordId> [playerName]
 *
 * Prints the value of the `hl_session` cookie for that Discord id. Only useful
 * against a local server started with the same NEXTAUTH_SECRET.
 */
import { encodeSession } from "@/lib/auth";

async function main() {
  const [discordId, playerName] = process.argv.slice(2);
  if (!discordId) throw new Error("usage: mint-session.ts <discordId> [playerName]");
  if (!process.env.NEXTAUTH_SECRET) throw new Error("set NEXTAUTH_SECRET (the same one the local server uses)");
  const token = await encodeSession({
    discordId,
    username: `u${discordId}`,
    avatar: null,
    discriminator: "0",
    playerName: playerName ?? null,
    inGuild: true,
  } as never);
  console.log(token);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
