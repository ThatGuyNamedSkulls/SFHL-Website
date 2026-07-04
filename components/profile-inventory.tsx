"use client";

import { useState } from "react";
import { InventoryItem, CosmeticType } from "@/types";
import { Award, Check, UserRound } from "lucide-react";

const FILTERS: { id: CosmeticType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "card", label: "Profile cards" },
  { id: "frame", label: "Avatar frames" },
  { id: "title", label: "Titles" },
  { id: "badge", label: "Badges" },
];

const TYPE_LABEL: Record<CosmeticType, string> = {
  card: "Profile card",
  frame: "Avatar frame",
  title: "Title",
  badge: "Badge",
};

const RARITY_COLORS: Record<string, string> = {
  common: "text-hl-muted",
  rare: "text-sky-400",
  epic: "text-purple-400",
  legendary: "text-hl-gold",
};

/** Portrait preview cell for one cosmetic item (FACEIT inventory style). */
function ItemPreview({ item }: { item: InventoryItem }) {
  const [broken, setBroken] = useState(false);
  if (item.type === "card" && item.asset && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.asset}
        alt={item.name}
        className="w-full h-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  if (item.type === "frame") {
    // Frame preview: the ring overlaid on a placeholder avatar (FACEIT-style).
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="relative w-24 h-24">
          <div className="w-full h-full rounded-full bg-hl-panel-light border border-hl-border flex items-center justify-center">
            <UserRound className="w-10 h-10 text-hl-muted" />
          </div>
          {item.asset && !broken && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.asset}
              alt={item.name}
              className="absolute -inset-[14%] w-[128%] h-[128%] max-w-none object-contain pointer-events-none"
              onError={() => setBroken(true)}
            />
          )}
        </div>
      </div>
    );
  }
  if (item.type === "badge") {
    return (
      <div className="w-full h-full flex items-center justify-center">
        {item.asset && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.asset} alt={item.name} className="w-16 h-16 object-contain" onError={() => setBroken(true)} />
        ) : (
          <Award className="w-12 h-12 text-hl-gold/70" />
        )}
      </div>
    );
  }
  if (item.type === "title") {
    return (
      <div className="w-full h-full flex items-center justify-center px-3">
        <span className="text-sm font-bold italic text-hl-gold text-center">{item.name}</span>
      </div>
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-hl-muted header-caps px-3 text-center">
      {item.name}
    </div>
  );
}

interface ProfileInventoryProps {
  /** The viewed player's items (public, from /api/players/[name]). */
  items: InventoryItem[];
  /** Equip/unequip enabled only on your own profile. */
  isOwn: boolean;
}

/** FACEIT-style inventory grid: portrait previews with Equipped chips. */
export function ProfileInventory({ items: initial, isOwn }: ProfileInventoryProps) {
  const [items, setItems] = useState<InventoryItem[]>(initial);
  const [filter, setFilter] = useState<CosmeticType | "all">("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = async (item: InventoryItem) => {
    setBusyId(item.id);
    setNotice(null);
    try {
      const res = await fetch("/api/inventory/equip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, equip: !item.equipped }),
      });
      const data = await res.json();
      if (res.ok && data.items) setItems(data.items);
      else {
        setNotice(data.error || "Failed to update item.");
        setTimeout(() => setNotice(null), 4000);
      }
    } catch {
      setNotice("Failed to update item.");
      setTimeout(() => setNotice(null), 4000);
    } finally {
      setBusyId(null);
    }
  };

  const visible = filter === "all" ? items : items.filter((i) => i.type === filter);

  return (
    <div>
      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
              filter === f.id
                ? "bg-gold-gradient text-hl-base border-transparent"
                : "border-hl-border text-hl-muted hover:text-white"
            }`}
          >
            {f.label}
            <span className="opacity-60 ml-1">
              ({f.id === "all" ? items.length : items.filter((i) => i.type === f.id).length})
            </span>
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-hl-red/10 border border-hl-red/30 text-hl-red text-xs">
          {notice}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-hl-muted py-10 text-center">
          Nothing here yet — cosmetics are granted by admins, seasons and events.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
          {visible.map((item) => (
            <div
              key={item.id}
              className={`rounded-xl border overflow-hidden bg-hl-panel ${
                item.equipped ? "border-hl-gold/40" : "border-hl-border"
              }`}
            >
              <div className="relative aspect-[3/4] bg-gradient-to-b from-hl-panel-light to-hl-base">
                <ItemPreview item={item} />
                {item.equipped && (
                  <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-hl-base/80 border border-hl-gold/40 text-hl-gold text-[10px] font-bold px-2 py-0.5">
                    <Check className="w-3 h-3" /> Equipped
                  </span>
                )}
              </div>
              <div className="p-3 border-t border-hl-border">
                <div className={`text-[9px] header-caps ${RARITY_COLORS[item.rarity] || RARITY_COLORS.common}`}>
                  {TYPE_LABEL[item.type]} · {item.rarity}
                </div>
                <div className="text-sm font-bold text-white truncate mt-0.5">{item.name}</div>
                {isOwn && (
                  <button
                    onClick={() => toggle(item)}
                    disabled={busyId === item.id}
                    className={`mt-2 w-full py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
                      item.equipped
                        ? "border border-hl-border text-hl-muted hover:text-white"
                        : "bg-gold-gradient text-hl-base hover:opacity-90"
                    }`}
                  >
                    {busyId === item.id ? "…" : item.equipped ? "Unequip" : "Equip"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
