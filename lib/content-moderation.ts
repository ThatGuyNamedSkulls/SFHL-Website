/** Shared guestbook / public-text checks. Server-side is authoritative. */

export const GUESTBOOK_MAX_LENGTH = 250;

const PROFANITY = [
  "anal", "anus", "arsehole", "asshole", "ballsack", "bastard", "bitch",
  "blowjob", "bollocks", "boner", "boob", "clit", "cock", "coon", "crap",
  "cum", "cunt", "dick", "dildo", "dyke", "fag", "faggot", "fuck", "fucker",
  "fucking", "goddamn", "homo", "jizz", "kike", "labia", "milf", "nazi",
  "nigga", "nigger", "nutsack", "orgasm", "penis", "piss", "pussy", "queer",
  "rape", "rapist", "retard", "retarded", "semen", "sex", "shit", "shitty",
  "slut", "spic", "spunk", "tit", "tits", "twat", "vagina", "wank", "whore",
];

const PROFANITY_RE = new RegExp(
  `\\b(?:${PROFANITY.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i"
);

/** True when the text contains a blocked word as a whole token. */
export function containsProfanity(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[@$0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b");
  return PROFANITY_RE.test(normalized);
}
