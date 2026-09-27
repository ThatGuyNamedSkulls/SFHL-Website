/**
 * Allowed values for a new party (docs/WEBSITE_SECURITY_PLAN.md 2.2). Parties
 * are public, so every field is forced to a known string: a non-string value
 * (e.g. an object) used to be stored as-is and crashed the party finder for
 * every visitor when React tried to render it.
 */
import { RANK_TIERS } from "@/data/ranks";
import { containsProfanity } from "@/lib/content-moderation";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import { isQueueRegion } from "@/lib/regions";

export const PARTY_VIBES = ["Chill", "Fun", "Balanced", "Serious", "Intense"];
export const PARTY_LANGUAGES = ["Any", "English", "Portuguese", "Spanish", "German", "French"];
export const PARTY_MATCH_TYPES = ["Standard", "Super"];
const SKILL_LETTERS = RANK_TIERS.map((t) => t.letter).filter((l) => l !== "UNRANKED");

export class PartyInputError extends Error {}

function pick(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function text(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ").slice(0, max);
  return clean || fallback;
}

export interface CleanPartyFields {
  name: string;
  game: string;
  gameMode: string;
  matchType: string;
  region: string;
  minSkill: string;
  maxSkill: string;
  language: string;
  countries: string;
  vibe: string;
  verifiedOnly: boolean;
  voiceRequired: boolean;
  isPrivate: boolean;
}

/** Normalize untrusted party input. Throws PartyInputError for a rude name. */
export function cleanPartyFields(input: Record<string, unknown>): CleanPartyFields {
  const name = text(input.name, 40, "New Party");
  if (containsProfanity(name)) throw new PartyInputError("That party name isn't allowed.");
  const region = typeof input.region === "string" ? input.region.toUpperCase() : "";
  return {
    name,
    game: "Strike Force",
    gameMode: MATCH_MODE_LABEL,
    matchType: pick(input.matchType, PARTY_MATCH_TYPES, "Standard"),
    region: isQueueRegion(region) ? region : "EU",
    minSkill: pick(input.minSkill, SKILL_LETTERS, "D"),
    maxSkill: pick(input.maxSkill, SKILL_LETTERS, "STAR"),
    language: pick(input.language, PARTY_LANGUAGES, "Any"),
    countries: text(input.countries, 40, "Any"),
    vibe: pick(input.vibe, PARTY_VIBES, "Balanced"),
    verifiedOnly: input.verifiedOnly === true,
    voiceRequired: input.voiceRequired === true,
    isPrivate: input.isPrivate === true,
  };
}
