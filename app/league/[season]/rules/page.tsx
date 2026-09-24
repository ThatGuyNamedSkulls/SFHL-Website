import { notFound } from "next/navigation";
import { LeagueRulesEditor } from "@/components/league-rules-editor";
import { LeagueRulesView } from "@/components/league-rules-view";
import { getSession } from "@/lib/auth";
import { isMatchStaff } from "@/lib/discord-party-voice";
import { getSeason, PRIZES, ROSTER_MAX, ROSTER_MIN } from "@/lib/league";
import { defaultRules, parseRules, rulesToText } from "@/lib/league-rules";

export const dynamic = "force-dynamic";

/**
 * Rules (docs/LEAGUE_UI_PLAN.md step 8): the season's own rules (Match Staff
 * text, lib/league-rules.ts format) or the standard ones, with a section list.
 * Match Staff edit them here with a live preview.
 */
export default async function SeasonRulesPage({ params }: { params: Promise<{ season: string }> }) {
  const { season: raw } = await params;
  const season = /^\d+$/.test(raw) ? await getSeason(Number(raw)) : null;
  if (!season) notFound();
  const session = await getSession();
  const staff = session ? await isMatchStaff(session.discordId).catch(() => false) : false;

  const standard = defaultRules({ weeks: season.weeks, rosterMin: ROSTER_MIN, rosterMax: ROSTER_MAX, prizes: PRIZES });
  const sections = season.rules ? parseRules(season.rules) : standard;
  const toc = sections.filter((s) => s.title);

  return (
    <div className="space-y-5">
      {staff ? (
        <LeagueRulesEditor seasonId={season.id} rules={season.rules ?? null} standardText={rulesToText(standard)} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {toc.length > 1 ? (
          <nav aria-label="Rules sections" className="hidden lg:block">
            <div className="sticky top-24 space-y-0.5 border-l border-white/[0.08]">
              {toc.map((s) => (
                <a
                  key={s.anchor}
                  href={`#${s.anchor}`}
                  className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-sm font-bold text-white/60 hover:border-[#ff5500] hover:text-white"
                >
                  {s.title}
                </a>
              ))}
            </div>
          </nav>
        ) : (
          <div className="hidden lg:block" />
        )}

        <article className="rounded-xl border border-white/[0.08] bg-[#121212] p-6">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.06] pb-4">
            <h2 className="text-xl font-black text-white">Rules</h2>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">
              {season.rules ? `${season.name} rules` : "Standard league rules"}
            </span>
          </div>
          <LeagueRulesView sections={sections} />
          <p className="mt-8 border-t border-white/[0.06] pt-4 text-xs text-white/50">
            Match Staff have the final say on anything these rules don&apos;t cover. Questions? Ask them on Discord.
          </p>
        </article>
      </div>
    </div>
  );
}
