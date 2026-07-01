"use client";

import { useMemo, useState } from "react";
import { countryOptions, flagPath } from "@/lib/countries";
import { Flag } from "@/components/flag";
import { Search } from "lucide-react";

interface CountrySelectProps {
  value: string | null;
  onChange: (code: string) => void;
}

/** Searchable country picker with flag thumbnails. */
export function CountrySelect({ value, onChange }: CountrySelectProps) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => countryOptions(), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q) || o.code.includes(q));
  }, [options, query]);

  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hl-muted pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search country…"
          className="w-full bg-hl-base border border-hl-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-hl-border divide-y divide-hl-border">
        {filtered.map((o) => (
          <button
            key={o.code}
            onClick={() => onChange(o.code)}
            className={`flex items-center gap-3 w-full px-3 py-2 text-left text-sm transition-colors ${
              value === o.code ? "bg-hl-gold/15 text-hl-gold" : "text-white hover:bg-hl-panel-light/50"
            }`}
          >
            <Flag src={flagPath(o.code)} name={o.name} className="w-6 h-4" />
            {o.name}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-hl-muted">No matches</div>
        )}
      </div>
    </div>
  );
}
