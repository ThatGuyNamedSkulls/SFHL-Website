/** Default queue format. The live one is the bot's `/queue mode` choice — read it with getQueueTeamSize(). */
export const MATCH_TEAM_SIZE = 5;
export const MATCH_QUEUE_SIZE = MATCH_TEAM_SIZE * 2;
export const MATCH_MODE_LABEL = `${MATCH_TEAM_SIZE}v${MATCH_TEAM_SIZE}`;
export const PARTY_MAX_SIZE = 3;
/** Team sizes the bot's `/queue mode` can switch the queue to. */
export const GAMEMODE_TEAM_SIZES = [2, 3, 5];
