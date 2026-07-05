"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ShopItem, CosmeticType } from "@/types";
import { Coins, Check, Award, UserRound, ShoppingBag, Lock } from "lucide-react";

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

/** Portrait preview for a shop item (card art / frame ring / badge / title). */
function ShopPreview({ item }: { item: ShopItem }) {
  const [broken, setBroken] = useState(false);
  if (item.type === "card" && item.asset && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.asset} alt={item.name} className="w-full h-full object-cover" onError={() => setBroken(true)} />;
  }
  if (item.type === "frame") {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="relative w-24 h-24">
          <div className="w-full h-full rounded-full bg-hl-panel-light border border-hl-border flex items-center justify-center">
            <UserRound className="w-10 h-10 text-hl-muted" />
          </div>
          {item.asset && !broken && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.asset} alt={item.name} className="absolute -inset-[14%] w-[128%] h-[128%] max-w-none object-contain" onError={() => setBroken(true)} />
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

export default function ShopPage() {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [coins, setCoins] = useState(0);
  const [linked, setLinked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CosmeticType | "all">("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/shop")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setLinked(d.linked !== false);
        setCoins(d.coins ?? 0);
        setItems(d.items ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const buy = async (item: ShopItem) => {
    setBusyId(item.id);
    setNotice(null);
    try {
      const res = await fetch("/api/shop/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
      const data = await res.json();
      if (typeof data.coins === "number") setCoins(data.coins);
      if (Array.isArray(data.items)) setItems(data.items);
      if (res.ok) {
        setNotice({ kind: "ok", text: `Purchased ${item.name}! Equip it in Settings.` });
      } else {
        setNotice({ kind: "err", text: data.error || "Purchase failed." });
      }
    } catch {
      setNotice({ kind: "err", text: "Purchase failed." });
    } finally {
      setBusyId(null);
      setTimeout(() => setNotice(null), 4000);
    }
  };

  const visible = filter === "all" ? items : items.filter((i) => i.type === filter);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hl-border mb-6 pb-3">
        <div className="inline-flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-hl-gold" />
          <span className="text-lg font-black text-white header-caps">Shop</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-hl-panel border border-hl-gold/40 px-4 py-1.5">
          <Coins className="w-4 h-4 text-hl-gold" />
          <span className="stat-number text-lg text-white">{coins.toLocaleString()}</span>
          <span className="text-xs text-hl-muted font-semibold">HL Coins</span>
        </div>
      </div>

      {!linked ? (
        <div className="py-16 text-center text-hl-muted">
          Your Discord account isn&apos;t linked to a HyperLeague player yet, so you can&apos;t shop.
        </div>
      ) : (
        <>
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
            <div
              className={`mb-4 px-3 py-2 rounded-lg border text-xs ${
                notice.kind === "ok"
                  ? "bg-hl-green/10 border-hl-green/30 text-hl-green"
                  : "bg-hl-red/10 border-hl-red/30 text-hl-red"
              }`}
            >
              {notice.text}
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-sm text-hl-muted">Loading shop…</div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-sm text-hl-muted">
              Nothing for sale here yet — items appear once an admin sets a price.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {visible.map((item) => {
                const affordable = coins >= item.price;
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border overflow-hidden bg-hl-panel ${
                      item.owned ? "border-hl-gold/40" : "border-hl-border"
                    }`}
                  >
                    <div className="relative aspect-[3/4] bg-gradient-to-b from-hl-panel-light to-hl-base">
                      <ShopPreview item={item} />
                      {item.owned && (
                        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-hl-base/80 border border-hl-gold/40 text-hl-gold text-[10px] font-bold px-2 py-0.5">
                          <Check className="w-3 h-3" /> Owned
                        </span>
                      )}
                    </div>
                    <div className="p-3 border-t border-hl-border">
                      <div className={`text-[9px] header-caps ${RARITY_COLORS[item.rarity] || RARITY_COLORS.common}`}>
                        {TYPE_LABEL[item.type]} · {item.rarity}
                      </div>
                      <div className="text-sm font-bold text-white truncate mt-0.5">{item.name}</div>
                      <div className="flex items-center gap-1.5 mt-1 text-hl-gold">
                        <Coins className="w-3.5 h-3.5" />
                        <span className="stat-number text-sm">{item.price.toLocaleString()}</span>
                      </div>
                      {item.owned ? (
                        <Link
                          href="/settings"
                          className="mt-2 w-full inline-flex items-center justify-center py-1.5 rounded-lg text-xs font-bold border border-hl-border text-hl-muted hover:text-white transition-colors"
                        >
                          Equip in Settings
                        </Link>
                      ) : (
                        <button
                          onClick={() => buy(item)}
                          disabled={busyId === item.id || !affordable}
                          className={`mt-2 w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:cursor-not-allowed ${
                            affordable
                              ? "bg-gold-gradient text-hl-base hover:opacity-90 disabled:opacity-50"
                              : "border border-hl-border text-hl-muted"
                          }`}
                        >
                          {busyId === item.id ? (
                            "…"
                          ) : affordable ? (
                            "Buy"
                          ) : (
                            <>
                              <Lock className="w-3 h-3" /> Not enough
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-8 text-center text-xs text-hl-muted">
            HL Coins are granted by admins for now. Bought items land in your{" "}
            <Link href="/settings" className="text-hl-gold hover:underline">inventory</Link>.
          </p>
        </>
      )}
    </div>
  );
}
