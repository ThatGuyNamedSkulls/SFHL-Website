/**
 * Renders league rules sections (lib/league-rules.ts). No hooks, so both the
 * server Rules page and the staff editor's live preview use it.
 */
import type { RulesSection } from "@/lib/league-rules";

export function LeagueRulesView({ sections, compact = false }: { sections: RulesSection[]; compact?: boolean }) {
  if (!sections.length) return <p className="text-sm text-white/50">Nothing written yet.</p>;
  return (
    <div className={compact ? "space-y-5" : "space-y-8"}>
      {sections.map((s) => (
        <section key={s.anchor} id={compact ? undefined : s.anchor} className="scroll-mt-24">
          {s.title ? (
            <h3 className={`mb-2 font-black text-white ${compact ? "text-sm" : "text-base"}`}>
              <span className="mr-2 inline-block h-3 w-1 rounded-full bg-[#ff5500] align-middle" />
              {s.title}
            </h3>
          ) : null}
          <div className="space-y-2.5">
            {s.blocks.map((b, i) =>
              b.kind === "ul" ? (
                <ul key={i} className="space-y-1.5 text-sm leading-relaxed text-white/80">
                  {b.lines.map((line, j) => (
                    <li key={j} className="flex gap-2.5">
                      <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-white/40" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="text-sm leading-relaxed text-white/80">
                  {b.lines.join(" ")}
                </p>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
