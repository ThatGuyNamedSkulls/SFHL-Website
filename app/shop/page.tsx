"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShopItem, CosmeticType } from "@/types";
import { Coins, Check, Award, UserRound, Lock } from "lucide-react";
import { optimizedAsset } from "@/lib/optimized-asset";

type ShopFilter = CosmeticType | "all" | "featured";

const NAV: { id: ShopFilter; label: string }[] = [
  { id: "featured", label: "Discover" },
  { id: "all", label: "Cosmetics" },
  { id: "frame", label: "Avatar frames" },
  { id: "card", label: "Profile cards" },
  { id: "title", label: "Titles" },
  { id: "badge", label: "Badges" },
  { id: "background", label: "Backgrounds" },
];

const TYPE_LABEL: Record<CosmeticType, string> = {
  background: "Background",
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

function ShopPreview({ item }: { item: ShopItem }) {
  const [broken, setBroken] = useState(false);
  if (item.type === "card" && item.asset && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={optimizedAsset(item.asset)} alt={item.name} className="w-full h-full object-cover" onError={() => setBroken(true)} />;
  }
  if (item.type === "frame") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="relative h-24 w-24">
          <div className="flex h-full w-full items-center justify-center rounded-full border border-hl-border bg-hl-panel-light">
            <UserRound className="h-10 w-10 text-hl-muted" />
          </div>
          {item.asset && !broken && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={optimizedAsset(item.asset)}
              alt={item.name}
              className="absolute -inset-[14%] h-[128%] w-[128%] max-w-none object-contain"
              onError={() => setBroken(true)}
            />
          )}
        </div>
      </div>
    );
  }
  if (item.type === "badge") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        {item.asset && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={optimizedAsset(item.asset)} alt={item.name} className="h-16 w-16 object-contain" onError={() => setBroken(true)} />
        ) : (
          <Award className="h-12 w-12 text-hl-gold/70" />
        )}
      </div>
    );
  }
  if (item.type === "title") {
    return (
      <div className="flex h-full w-full items-center justify-center px-3">
        <span className="text-center text-sm font-bold italic text-hl-gold">{item.name}</span>
      </div>
    );
  }
  if (item.type === "background") {
    return (
      <div
        className="h-full w-full"
        style={{ backgroundImage: `linear-gradient(to top, ${item.asset || "#333"} 0%, #000000 100%)` }}
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs font-bold header-caps text-hl-muted">
      {item.name}
    </div>
  );
}

export default function ShopPage() {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [coins, setCoins] = useState(0);
  const [linked, setLinked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ShopFilter>("featured");
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

  const byType = useMemo(() => {
    const map: Record<string, ShopItem[]> = {};
    for (const item of items) {
      (map[item.type] ??= []).push(item);
    }
    return map;
  }, [items]);

  const featured = useMemo(() => {
    const legendary = items.filter((i) => i.rarity === "legendary");
    const epic = items.filter((i) => i.rarity === "epic");
    const pool = [...legendary, ...epic, ...items];
    const seen = new Set<number>();
    return pool.filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    }).slice(0, 8);
  }, [items]);

  const visible =
    filter === "featured"
      ? featured
      : filter === "all"
        ? items
        : items.filter((i) => i.type === filter);

  return (
    <div className="hl-page">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <nav className="flex flex-wrap items-center gap-4">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setFilter(n.id)}
              className={`text-xs font-bold uppercase tracking-wide pb-2 border-b-2 ${
                filter === n.id
                  ? "border-[#ff5500] text-white"
                  : "border-transparent text-[#8a8a8a] hover:text-white"
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="inline-flex items-center gap-2 rounded-full border border-hl-gold/40 bg-hl-panel px-4 py-1.5">
          <Coins className="h-4 w-4 text-hl-gold" />
          <span className="stat-number text-lg text-white">{coins.toLocaleString()}</span>
          <span className="text-xs font-semibold text-hl-muted">HL Coins</span>
        </div>
      </div>

      {!linked ? (
        <div className="mb-4 rounded-lg border border-hl-border bg-hl-panel px-3 py-2 text-sm text-hl-muted">
          <Link href="/login" className="font-bold text-hl-gold hover:underline">
            Log in
          </Link>{" "}
          and link a player to buy — you can still browse the catalog.
        </div>
      ) : null}

      <>
          {notice && (
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
                notice.kind === "ok"
                  ? "border-hl-green/30 bg-hl-green/10 text-hl-green"
                  : "border-hl-red/30 bg-hl-red/10 text-hl-red"
              }`}
            >
              {notice.text}
            </div>
          )}

          {filter === "featured" ? (
            <>
              <div className="mb-6 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#151515] min-h-[220px]">
                  <div
                    className="absolute inset-0 opacity-80"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle at 70% 40%, rgba(255,85,0,0.35), transparent 55%), linear-gradient(120deg, #0d0d0d, #1a1a1a)",
                    }}
                  />
                  <div className="relative flex h-full flex-col justify-end p-6 md:p-8">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-[#ff5500]">
                      Strike Force Cosmetics
                    </div>
                    <h2 className="mt-2 max-w-md text-2xl font-black text-white md:text-3xl">
                      Fresh looks for your HyperLeague profile
                    </h2>
                    <p className="mt-2 max-w-md text-sm text-[#b0b0b0]">
                      Frames, cards, titles, and badges — no game skins, just how you show up on the site.
                    </p>
                    <button
                      type="button"
                      onClick={() => setFilter("all")}
                      className="find-match-btn mt-5 h-10 w-fit rounded-lg px-5 text-sm font-black header-caps text-hl-base"
                    >
                      Explore collection
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(featured.slice(1, 5).length ? featured.slice(1, 5) : featured.slice(0, 4)).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFilter(item.type)}
                      className="overflow-hidden rounded-xl border border-white/10 bg-[#151515] text-left hover:border-[#ff5500]/50 transition-colors"
                    >
                      <div className="aspect-[4/3] bg-[#1c1c1c]">
                        <ShopPreview item={item} />
                      </div>
                      <div className="px-2.5 py-2">
                        <div className="truncate text-xs font-bold text-white">{item.name}</div>
                        <div className="text-[10px] text-hl-muted">{TYPE_LABEL[item.type]}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4 flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[#ff5500] bg-[#ff5500]/10 px-3 py-1.5 text-xs font-bold text-white"
                >
                  SF
                </button>
                <span className="text-xs text-hl-muted">HyperLeague store · cosmetics only</span>
              </div>

              <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <CategoryTile
                  title="Avatar frames"
                  copy="Ring your profile picture with season and rarity frames."
                  count={byType.frame?.length ?? 0}
                  onClick={() => setFilter("frame")}
                  tone="orange"
                />
                <CategoryTile
                  title="Profile cards"
                  copy="Banner art behind your name on lobbies and profiles."
                  count={byType.card?.length ?? 0}
                  onClick={() => setFilter("card")}
                  tone="green"
                />
                <CategoryTile
                  title="Titles & badges"
                  copy="Show rank identity and milestones next to your name."
                  count={(byType.title?.length ?? 0) + (byType.badge?.length ?? 0)}
                  onClick={() => setFilter("title")}
                  tone="blue"
                />
              </div>
            </>
          ) : null}

          {loading ? (
            <div className="py-16 text-center text-sm text-hl-muted">Loading shop…</div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-sm text-hl-muted">
              Nothing for sale here yet — items appear once an admin sets a price.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((item) => {
                const affordable = coins >= item.price;
                return (
                  <div
                    key={item.id}
                    className={`overflow-hidden rounded-xl border bg-hl-panel ${
                      item.owned ? "border-hl-gold/40" : "border-hl-border"
                    }`}
                  >
                    <div className="relative aspect-[3/4] bg-gradient-to-b from-hl-panel-light to-hl-base">
                      <ShopPreview item={item} />
                      <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold text-hl-gold">
                        <Coins className="h-3 w-3" />
                        {item.price.toLocaleString()}
                      </span>
                      {item.owned && (
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-hl-gold/40 bg-hl-base/80 px-2 py-0.5 text-[10px] font-bold text-hl-gold">
                          <Check className="h-3 w-3" /> Owned
                        </span>
                      )}
                    </div>
                    <div className="border-t border-hl-border p-3">
                      <div className={`text-[9px] header-caps ${RARITY_COLORS[item.rarity] || RARITY_COLORS.common}`}>
                        {TYPE_LABEL[item.type]} · {item.rarity}
                      </div>
                      <div className="mt-0.5 truncate text-sm font-bold text-white">{item.name}</div>
                      {item.owned ? (
                        <Link
                          href="/settings"
                          className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-hl-border py-1.5 text-xs font-bold text-hl-muted transition-colors hover:text-white"
                        >
                          Equip in Settings
                        </Link>
                      ) : !linked ? (
                        <Link
                          href="/login"
                          className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-hl-border py-1.5 text-xs font-bold text-hl-muted hover:text-white"
                        >
                          Log in to buy
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => buy(item)}
                          disabled={busyId === item.id || !affordable}
                          className={`mt-2 inline-flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed ${
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
                              <Lock className="h-3 w-3" /> Not enough
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
            Earn coins from{" "}
            <Link href="/missions" className="text-hl-gold hover:underline">missions</Link>
            . Bought items land in your{" "}
            <Link href="/settings" className="text-hl-gold hover:underline">inventory</Link>.
          </p>
      </>
    </div>
  );
}

function CategoryTile({
  title,
  copy,
  count,
  onClick,
  tone,
}: {
  title: string;
  copy: string;
  count: number;
  onClick: () => void;
  tone: "orange" | "green" | "blue";
}) {
  const glow =
    tone === "orange"
      ? "rgba(255,85,0,0.28)"
      : tone === "green"
        ? "rgba(125,255,79,0.18)"
        : "rgba(90,160,255,0.22)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#151515] text-left hover:border-white/25 transition-colors"
    >
      <div
        className="aspect-[16/10]"
        style={{
          backgroundImage: `radial-gradient(circle at 70% 40%, ${glow}, transparent 55%), linear-gradient(160deg, #121212, #1c1c1c)`,
        }}
      />
      <div className="px-4 py-3">
        <div className="font-bold text-white">{title}</div>
        <p className="mt-1 text-xs text-hl-muted">{copy}</p>
        <div className="mt-2 text-[11px] font-bold text-[#ff5500]">{count} for sale</div>
      </div>
    </button>
  );
}
