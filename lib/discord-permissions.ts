/**
 * Discord permission maths, kept pure so it can be tested without Discord.
 * Used by `isGuildAdmin` (lib/discord-party-voice.ts) for the staff panel's
 * Admin-only actions — the same rule as the bot's admin commands.
 */

const ADMINISTRATOR = BigInt(8);

export interface GuildPermissionInfo {
  /** The guild's id; its @everyone role has the same id. */
  id: string;
  ownerId: string;
  roles: { id: string; permissions: string }[];
}

/** True for the server owner, or when @everyone or one of their roles has Administrator. */
export function hasAdministrator(userId: string, memberRoleIds: string[], guild: GuildPermissionInfo): boolean {
  if (!userId) return false;
  if (userId === guild.ownerId) return true;
  const mine = new Set([guild.id, ...memberRoleIds]);
  return guild.roles.some((role) => {
    if (!mine.has(role.id)) return false;
    try {
      return (BigInt(role.permissions || "0") & ADMINISTRATOR) === ADMINISTRATOR;
    } catch {
      return false;
    }
  });
}
