"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

/**
 * Division filter on the Standings and Teams tabs. Sets ?division= and keeps
 * the other filters in `keep`; an empty value (e.g. "All divisions") drops it.
 */
export function LeagueDivisionSelect({
  base,
  keep = {},
  value,
  options,
}: {
  base: string;
  keep?: Record<string, string | null>;
  value: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">Division</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(e) => {
            const q = new URLSearchParams();
            if (e.target.value) q.set("division", e.target.value);
            for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
            const s = q.toString();
            router.push(s ? `${base}?${s}` : base, { scroll: false });
          }}
          className="h-10 w-full min-w-[220px] appearance-none rounded-lg border border-white/[0.12] bg-[#181818] pl-3 pr-9 text-sm font-bold text-white outline-none hover:border-white/25 focus:border-[#ff5500]"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
      </span>
    </label>
  );
}
