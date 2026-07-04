"use client";

import { useState, useEffect } from "react";
import { InventoryItem, CosmeticType } from "@/types";
import { CreditCard, Type, Award, Check, CircleUserRound, UserRound } from "lucide-react";

const TABS: { id: CosmeticType; label: string; icon: typeof Award }[] = [
  { id: "card", label: "Cards", icon: CreditCard },
  { id: "frame", label: "Frames", icon: CircleUserRound },
  { id: "title", label: "Titles", icon: Type },
  { id: "badge", label: "Badges", icon: Award },
];

const MAX_BADGES = 5;

const RARITY_COLORS: Record<string, string> = {
  common: "text-hl-muted border-hl-border",
  rare: "text-sky-400 border-sky-400/40",
  epic: "text-purple-400 border-purple-400/40",
  legendary: "text-hl-gold border-hl-gold/40",
};

const EMPTY_HINTS: Record<CosmeticType, string> = {
  card: "No profile cards yet — cards are granted by admins and events.",
  frame: "No avatar frames yet — frames are granted by admins and events.",
  title: "No titles yet — titles are granted by admins and events.",
  badge: "No badges yet — earn them through seasons, top placements and events.",
};

/** Wide card preview with a gradient fallback when the asset is missing. */
function CardPreview({ item }: { item: InventoryItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="w-full aspect-[3/1] rounded-lg overflow-hidden border border-hl-border bg-gradient-to-r from-hl-panel-light to-hl-base">
      {item.asset && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.asset}
          alt={item.name}
          className="w-full h-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs font-bold text-hl-muted header-caps">
          {item.name}
        </div>
      )}
    </div>
  );
}

/** Avatar-frame preview: the ring overlaid on a placeholder avatar. */
function FramePreview({ item }: { item: InventoryItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative w-14 h-14 shrink-0">
      <div className="w-full h-full rounded-full bg-hl-panel-light border border-hl-border flex items-center justify-center">
        <UserRound className="w-6 h-6 text-hl-muted" />
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
  );
}

/** Small badge icon with a letter-circle fallback. */
function BadgeIcon({ item, className = "w-10 h-10" }: { item: InventoryItem; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (item.asset && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.asset}
        alt={item.name}
        className={`${className} object-contain shrink-0`}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className={`${className} rounded-full bg-hl-panel-light border border-hl-border flex items-center justify-center text-sm font-bold text-hl-gold shrink-0`}
    >
      {item.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function InventoryPanel() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [tab, setTab] = useState<CosmeticType>("card");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/inventory")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setItems(d.items ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      if (res.ok && data.items) {
        setItems(data.items);
      } else {
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

  const tabItems = items.filter((i) => i.type === tab);
  const equippedBadges = items.filter((i) => i.type === "badge" && i.equipped).length;

  if (loading) {
    return <div className="py-6 text-center text-sm text-hl-muted">Loading inventory…</div>;
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold header-caps border transition-colors ${
              tab === id
                ? "border-hl-gold/50 bg-hl-gold/10 text-hl-gold"
                : "border-hl-border text-hl-muted hover:text-white"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            <span className="opacity-60">
              ({items.filter((i) => i.type === id).length})
            </span>
          </button>
        ))}
        {tab === "badge" && (
          <span className="ml-auto text-[11px] text-hl-muted">
            Equipped {equippedBadges}/{MAX_BADGES}
          </span>
        )}
      </div>

      {notice && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-hl-red/10 border border-hl-red/30 text-hl-red text-xs">
          {notice}
        </div>
      )}

      {/* Items */}
      {tabItems.length === 0 ? (
        <div className="py-8 text-center text-sm text-hl-muted">{EMPTY_HINTS[tab]}</div>
      ) : (
        <div className="space-y-3">
          {tabItems.map((item) => (
            <div
              key={item.id}
              className={`p-3 rounded-xl border transition-colors ${
                item.equipped ? "border-hl-gold/40 bg-hl-gold/5" : "border-hl-border bg-hl-panel-light/30"
              }`}
            >
              {item.type === "card" && <CardPreview item={item} />}
              <div className={`flex items-center gap-3 ${item.type === "card" ? "mt-3" : ""}`}>
                {item.type === "badge" && <BadgeIcon item={item} />}
                {item.type === "frame" && <FramePreview item={item} />}
                {item.type === "title" && (
                  <span className="px-2.5 py-1 rounded-md bg-hl-gold/10 border border-hl-gold/30 text-hl-gold text-sm font-bold italic shrink-0">
                    {item.name}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  {item.type !== "title" && (
                    <div className="text-sm font-bold text-white truncate">{item.name}</div>
                  )}
                  <div className="text-[11px] text-hl-muted truncate">
                    <span
                      className={`inline-block px-1.5 rounded border mr-1.5 header-caps ${
                        RARITY_COLORS[item.rarity] || RARITY_COLORS.common
                      }`}
                    >
                      {item.rarity}
                    </span>
                    {item.description || (item.season ? `Season: ${item.season}` : "")}
                  </div>
                </div>
                <button
                  onClick={() => toggle(item)}
                  disabled={busyId === item.id}
                  className={`shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
                    item.equipped
                      ? "border border-hl-border text-hl-muted hover:text-white"
                      : "bg-gold-gradient text-hl-base hover:opacity-90"
                  }`}
                >
                  {busyId === item.id ? "…" : item.equipped ? "Unequip" : "Equip"}
                </button>
                {item.equipped && <Check className="w-4 h-4 text-hl-gold shrink-0" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
