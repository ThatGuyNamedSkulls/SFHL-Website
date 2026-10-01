/**
 * Shared guestbook / chat / public-text checks. Server-side is authoritative.
 *
 * Words match whole and case-insensitively once the usual disguises are folded
 * away: look-alike symbols ("$h1t", "@sshole"), stretched letters ("fuuuck"),
 * letters spaced out ("f u c k", "f.u.c.k"), accents, full-width or Cyrillic
 * look-alike letters and invisible characters. Whole-word matching keeps
 * "class", "cocktail" and "Scunthorpe" clean.
 */

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

/** Forms of the words above. Matching is whole-word, so a plural, a verb form
 *  or a compound needs its own entry ("fucked", "bitches", "bullshit"). */
const FORMS = [
  "fucks", "fucked", "fuckin", "fuckers", "fuckface", "fuckhead", "fucktard", "fuckwit",
  "motherfucker", "motherfuckers", "motherfucking", "motherfuckin",
  "fck", "fcking", "fcked", "fuk", "fuking", "fukin", "fking", "fkin", "fkn",
  "shits", "shitted", "shitting", "shitter", "shithead", "shitheads", "shithole", "shite",
  "bullshit", "horseshit", "dipshit",
  "bitches", "bitched", "bitching", "bitchin", "bitchy",
  "cunts", "dicks", "dickhead", "dickheads", "cocks", "cocksucker", "cocksuckers",
  "pussies", "whores", "sluts", "slutty", "twats", "wanker", "wankers", "wanked", "wanking",
  "fags", "faggots", "niggas", "niggaz", "niggers", "niqqa", "niqqas", "niqqer",
  "coons", "dykes", "homos", "kikes", "spics", "nazis", "queers", "retards",
  "bastards", "assholes", "arseholes", "anuses", "ballsacks", "nutsacks",
  "raped", "rapes", "raping", "rapists",
  "pissed", "pisses", "pissing", "crapped", "crapping", "cumshot", "jizzed", "goddamnit",
  "blowjobs", "boners", "boobs", "clits", "dildos", "milfs", "orgasms", "penises",
  "titty", "titties", "vaginas",
];

/** Symbols, digits and Cyrillic letters standing in for Latin ones. 1, ! and |
 *  are read both as "i" and as "l" (see fold). */
const LOOKALIKES: Record<string, string> = {
  "@": "a", "4": "a", "8": "b", "3": "e", "0": "o", "$": "s", "5": "s", "7": "t", "+": "t",
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
  "і": "i", "ј": "j", "ѕ": "s", "к": "k", "ԁ": "d", "һ": "h",
};

const INVISIBLE = /\p{Cf}/u; // zero-width spaces, soft hyphens, …
const ACCENT = /\p{M}/u;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORDS = [...PROFANITY, ...FORMS];
const PATTERN = `\\b(?:${[
  // "fuuuck": every letter may repeat.
  ...WORDS.map((w) => [...w].map((c) => `${escape(c)}+`).join("")),
  // "f u c k" / "f.u.c.k" — only for words of 4+ letters, so spaced-out
  // initials can't spell a short one by accident.
  ...WORDS.filter((w) => w.length >= 4).map((w) => [...w].map(escape).join("[\\s._-]+")),
].join("|")})\\b`;
const PROFANITY_RE = new RegExp(PATTERN);
const PROFANITY_ALL = new RegExp(PATTERN, "g");

interface Folded {
  text: string;
  /** The original [start, end) each folded UTF-16 unit came from (the units
   *  a match's index counts — an emoji is two). */
  from: [number, number][];
}

/** Lowercase, accent-free text with look-alikes replaced; `one` is what
 *  1 / ! / | become. Remembers where every character came from, so a match
 *  can be masked in the original text. */
function fold(text: string, one: "i" | "l"): Folded {
  let out = "";
  const from: [number, number][] = [];
  let at = 0;
  for (const ch of text) {
    const span: [number, number] = [at, at + ch.length];
    at += ch.length;
    if (INVISIBLE.test(ch)) continue;
    for (const c of ch.normalize("NFKD").toLowerCase()) {
      if (ACCENT.test(c)) continue;
      const letter = c === "1" || c === "!" || c === "|" ? one : LOOKALIKES[c] ?? c;
      out += letter;
      for (let i = 0; i < letter.length; i++) from.push(span);
    }
  }
  return { text: out, from };
}

/** True when the text contains a blocked word as a whole token. */
export function containsProfanity(text: string): boolean {
  return PROFANITY_RE.test(fold(text, "i").text) || PROFANITY_RE.test(fold(text, "l").text);
}

const MASKED_LIMIT = 500;
/** Chats are polled every few seconds and serve the same messages each time. */
const masked = new Map<string, string>();

/**
 * `text` with every blocked word replaced by #s, Roblox-style. For text the
 * site can't refuse when it's written: Discord messages mirrored into a match
 * chat, and messages saved before the word was blocked.
 */
export function maskProfanity(text: string): string {
  const hit = masked.get(text);
  if (hit !== undefined) return hit;
  const ranges: [number, number][] = [];
  for (const one of ["i", "l"] as const) {
    const { text: folded, from } = fold(text, one);
    for (const m of folded.matchAll(PROFANITY_ALL)) {
      const start = m.index ?? 0;
      ranges.push([from[start][0], from[start + m[0].length - 1][1]]);
    }
  }
  let out = text;
  if (ranges.length) {
    out = "";
    let at = 0;
    for (const ch of text) {
      out += ranges.some(([s, e]) => at >= s && at < e) ? "#" : ch;
      at += ch.length;
    }
  }
  if (masked.size >= MASKED_LIMIT) masked.delete(masked.keys().next().value as string);
  masked.set(text, out);
  return out;
}
