"use client";

/**
 * Match Staff edit a season's rules right on the Rules tab (docs/LEAGUE_UI_PLAN.md
 * step 8): text on the left, live preview on the right, "Start from the
 * standard rules", and "Use standard rules" to drop the season's own text.
 * Saves through /api/league/admin (updateDetails), which logs it.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, RotateCcw } from "lucide-react";
import { LeagueRulesView } from "@/components/league-rules-view";
import { RULES_MAX, parseRules } from "@/lib/league-rules";

async function saveRules(seasonId: number, rules: string): Promise<string | null> {
  const res = await fetch("/api/league/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateDetails", seasonId, rules }),
  });
  if (res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return json.error || "Couldn't save the rules.";
}

const btn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-black uppercase tracking-wide text-white/80 hover:border-white/35 hover:text-white disabled:opacity-40";

export function LeagueRulesEditor({
  seasonId,
  rules,
  standardText,
}: {
  seasonId: number;
  /** The season's own rules (null = the standard rules are shown). */
  rules: string | null;
  standardText: string;
}) {
  const router = useRouter();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (text === null ? [] : parseRules(text)), [text]);

  const save = async (value: string) => {
    setBusy(true);
    setError(null);
    const err = await saveRules(seasonId, value);
    setBusy(false);
    if (err) setError(err);
    else {
      setText(null);
      router.refresh();
    }
  };

  if (text === null) {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setText(rules ?? standardText)} className={btn}>
          <Pencil className="h-3.5 w-3.5" /> Edit rules
        </button>
        {rules ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => window.confirm("Drop this season's own rules and show the standard rules?") && save("")}
            className={btn}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Use standard rules
          </button>
        ) : null}
        {error ? <p className="w-full text-sm text-hl-red">{error}</p> : null}
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-[#ff5500]/35 bg-[#141414] p-4" aria-label="Edit rules">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black text-white">Editing the rules</h3>
        <p className="text-[11px] text-white/55">
          <code className="rounded bg-white/10 px-1"># Title</code> starts a section ·{" "}
          <code className="rounded bg-white/10 px-1">- item</code> is a bullet · other lines are paragraphs
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="sr-only">Rules text</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, RULES_MAX))}
            rows={22}
            spellCheck
            className="h-full min-h-[420px] w-full resize-y rounded-lg border border-white/[0.12] bg-[#1b1b1b] px-3 py-2 font-mono text-[13px] leading-relaxed text-white outline-none focus:border-[#ff5500]"
          />
          <span className="mt-1 block text-right text-[10px] text-white/40">
            {text.length.toLocaleString()} / {RULES_MAX.toLocaleString()}
          </span>
        </label>
        <div className="max-h-[520px] overflow-y-auto rounded-lg border border-white/[0.08] bg-[#101010] p-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">Preview</div>
          <LeagueRulesView sections={preview} compact />
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-hl-red">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => (text.trim() && text !== standardText ? window.confirm("Replace what you wrote with the standard rules?") : true) && setText(standardText)}
          className={btn}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Start from the standard rules
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={() => setText(null)} className={btn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !text.trim()}
            // Unchanged standard text is saved as "no own rules", so it keeps following the standard.
            onClick={() => save(text.trim() === standardText.trim() ? "" : text)}
            className="find-match-btn inline-flex h-9 items-center rounded-lg px-5 text-xs font-black uppercase tracking-wide text-hl-base disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save rules"}
          </button>
        </div>
      </div>
    </section>
  );
}
