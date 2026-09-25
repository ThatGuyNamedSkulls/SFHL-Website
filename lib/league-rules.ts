/**
 * League Rules tab (docs/LEAGUE_UI_PLAN.md step 8): the standard rules and
 * the small text format Match Staff write a season's own rules in:
 *
 *   # Section title
 *   - a bullet
 *   Any other line is a paragraph (a blank line ends a list).
 *
 * Pure — the Rules page renders it and the staff editor previews it live.
 */

export interface RulesBlock {
  kind: "p" | "ul";
  lines: string[];
}

export interface RulesSection {
  /** null for text before the first "# " heading. */
  title: string | null;
  /** URL fragment for the section list ("teams-rosters"). */
  anchor: string;
  blocks: RulesBlock[];
}

export interface RulesConstants {
  weeks: number;
  rosterMin: number;
  rosterMax: number;
  prizes: readonly number[];
}

/** The standard rules, used when Match Staff haven't written this season's own. */
export function defaultRules({ weeks, rosterMin, rosterMax, prizes }: RulesConstants): RulesSection[] {
  const raw: [string, string[]][] = [
    [
      "Teams & rosters",
      [
        `A team needs ${rosterMin}–${rosterMax} accepted players (up to 5 main roster + 6 substitutes), all linked to a HyperLeague player. A team can also have 1 coach, who doesn't play. Only the captain can sign it up.`,
        "Each player can play for one team per season.",
        "Rosters lock when sign-ups close.",
      ],
    ],
    [
      "Divisions",
      [
        "A new team starts in the Open division of its skill (the average Elo of its best 5 players): Open 10 (★), Open 8-9 (S2–S3), Open 5-7 (A2–S1), Open 1-4 (D–A1).",
        "Entry, Intermediate, Main, Advanced and Pro are earned: every season the top of each division moves up and the bottom moves down — Open 8-9 → Open 10 → Entry → Intermediate → Main → Advanced → Pro. Open 5-7 and Open 1-4 are just for fun (no promotion).",
        "Up to 4 teams go up and 4 go down in each conference (fewer in small divisions: 1 with 4–5 teams, 2 with 6–9, 3 with 10–13). Open 10 never goes down: an Open team's level comes from its players' Elo, so it only climbs by finishing on top. A team keeps its status between seasons; Match Staff can change it.",
        "A division with fewer than 4 teams plays together with the next one down; a division with more than 32 teams is split into conferences (A, B, …).",
      ],
    ],
    [
      "Season format",
      [
        `${weeks} weeks of regular season, best of 1. Up to 7 teams play everyone once (a round-robin); bigger divisions play Swiss — each week you meet a team with the same record you haven't played yet. An odd team out gets a bye, which counts as a win.`,
        "Win = 3 points. Round-robin ties: head-to-head, then round difference, then rounds won. Swiss ties: opponents' points (Buchholz), then round difference, then rounds won.",
        "The top 4 of each division play best-of-3 playoffs (1st v 4th, 2nd v 3rd), then a final and a third-place match.",
        "Best of 3: captains ban maps until three remain; they're played in that order.",
        "League matches never change ranked Elo.",
        "Matches in Open10 and above give Pro ladder Elo to the players on the saved scoreboard: Open10 ×1.0, Entry ×1.1, Intermediate ×1.2, Main ×1.3, Advanced ×1.4, Pro ×1.5. Everyone starts at 0.",
      ],
    ],
    [
      "Scheduling",
      [
        "Each match belongs to a match week (Monday 00:00 – Sunday 23:59 UTC).",
        "Captains agree a time on the website or with /leaguematch. With no agreement by Friday 23:59 UTC the match is played Sunday 20:00 UTC.",
        "The match room opens 15 minutes before the start; everyone gets reminders 24 hours and 1 hour before.",
      ],
    ],
    [
      "Results",
      [
        "A captain reports the score after the match; the other captain confirms it. Different reports, disputes and results nobody confirms within 12 hours go to Match Staff.",
        "If the other team hasn't shown 15 minutes after the start, the present team can claim the win. A captain can also concede.",
        "Match Staff can set or change any result.",
      ],
    ],
    [
      "Prizes",
      [
        `Per division, every rostered player of the top 3 teams gets ${prizes.map((p) => p.toLocaleString("en-US")).join(" / ")} HL Coins (1st / 2nd / 3rd).`,
        "Each division champion gets a team title.",
      ],
    ],
  ];
  return raw.map(([title, items]) => ({ title, anchor: anchorFor(title, new Set()), blocks: [{ kind: "ul", lines: items }] }));
}

function anchorFor(title: string, used: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

/** Parse Match Staff's rules text into sections (empty sections are dropped). */
export function parseRules(text: string): RulesSection[] {
  const used = new Set<string>(["intro"]);
  const sections: RulesSection[] = [];
  let current: RulesSection = { title: null, anchor: "intro", blocks: [] };
  // The block still being written: consecutive plain lines join one paragraph,
  // consecutive bullets one list; a blank line or a heading closes both.
  let para: RulesBlock | null = null;
  let list: RulesBlock | null = null;
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    if (!line) {
      para = list = null;
    } else if (heading) {
      sections.push(current);
      const title = heading[1].trim();
      current = { title, anchor: anchorFor(title, used), blocks: [] };
      para = list = null;
    } else if (bullet) {
      para = null;
      if (!list) current.blocks.push((list = { kind: "ul", lines: [] }));
      list.lines.push(bullet[1].trim());
    } else {
      list = null;
      if (!para) current.blocks.push((para = { kind: "p", lines: [] }));
      para.lines.push(line);
    }
  }
  sections.push(current);
  return sections.filter((s) => s.title !== null || s.blocks.length);
}

/** Sections → the text format (the editor's "Start from the standard rules"). */
export function rulesToText(sections: RulesSection[]): string {
  return sections
    .map((s) => {
      const body = s.blocks
        .map((b) => (b.kind === "ul" ? b.lines.map((l) => `- ${l}`).join("\n") : b.lines.join("\n")))
        .join("\n\n");
      return s.title ? `# ${s.title}\n${body}` : body;
    })
    .join("\n\n");
}

export const RULES_MAX = 20000;
