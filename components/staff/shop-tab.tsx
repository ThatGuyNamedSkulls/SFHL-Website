"use client";

/**
 * Staff panel → Shop (CBL bot docs/STAFF_PANEL_PLAN.md step 5, Administrators):
 * the cosmetic catalog — create items, set or remove a price, delete — and
 * price everything at once. Same as /item create · price · priceall · delete.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, PackagePlus, RefreshCw, Search, Store, Tags, Trash2 } from "lucide-react";
import { StaffJobOutcome } from "@/components/staff/staff-job-outcome";
import {
  CardTitle,
  ConfirmButton,
  StaffCard,
  danger,
  fieldLabel,
  input,
  primary,
  secondary,
} from "@/components/staff/staff-ui";
import { useStaffJob } from "@/components/staff/use-staff-job";
import { optimizedAsset } from "@/lib/optimized-asset";
import {
  BADGE_CATEGORIES,
  ITEM_RARITIES,
  ITEM_SLUG_RE,
  ITEM_TYPES,
  MAX_ITEM_PRICE,
  MAX_TITLE_LENGTH,
  TOP10_BADGE_SLUG,
  slugify,
} from "@/lib/staff-shared";
import type { StaffJob } from "@/lib/staff-jobs";
import type { ShopCatalogItem } from "@/lib/staff-shop";

type Settled = (job: StaffJob) => void;

const RARITY_TONE: Record<string, string> = {
  common: "text-hl-muted",
  rare: "text-sky-400",
  epic: "text-purple-400",
  legendary: "text-hl-gold",
};

const typeLabel = (type: string) => ITEM_TYPES.find((t) => t.type === type)?.label ?? type;
const validPrice = (raw: string) => /^\d+$/.test(raw.trim()) && Number(raw) <= MAX_ITEM_PRICE;

function ItemThumb({ item }: { item: Pick<ShopCatalogItem, "type" | "asset" | "name"> }) {
  const [broken, setBroken] = useState(false);
  const box = "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-hl-border bg-hl-base";
  if (item.type === "background") {
    return <div className={box} style={{ background: item.asset || "#333" }} />;
  }
  if (item.type === "title") {
    return <div className={`${box} text-[0.625rem] font-bold italic text-hl-gold`}>Aa</div>;
  }
  if (item.asset && !broken) {
    return (
      <div className={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={optimizedAsset(item.asset)} alt="" className="h-full w-full object-contain" onError={() => setBroken(true)} />
      </div>
    );
  }
  return (
    <div className={box}>
      <Award className="h-5 w-5 text-hl-muted" />
    </div>
  );
}

function Catalog({ items, onReload, onSettled }: { items: ShopCatalogItem[]; onReload: () => void; onSettled: Settled }) {
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const price = useStaffJob(onSettled);
  const savePrice = async (slug: string, value: number) => {
    const job = await price.run("item_price", { slug, price: value });
    if (job?.status !== "done") return;
    setEdits((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
  };
  const remove = useStaffJob(onSettled);
  const busy = price.busy || remove.busy;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) => (type === "all" || i.type === type) && (!q || `${i.name} ${i.slug} ${i.description}`.toLowerCase().includes(q))
    );
  }, [items, type, query]);
  const onSale = items.filter((i) => i.price > 0).length;

  return (
    <StaffCard>
      <CardTitle
        icon={<Store className="h-4 w-4 text-hl-gold" />}
        title="Catalog"
        hint={`${items.length} items, ${onSale} in the shop. A price of 0 keeps an item out of the shop (grant-only).`}
        right={
          <button
            type="button"
            onClick={onReload}
            className="rounded-md p-1.5 text-hl-muted hover:bg-hl-panel-light hover:text-white"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[{ type: "all", label: "All" }, ...ITEM_TYPES].map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => setType(t.type)}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${
              type === t.type ? "border-transparent bg-gold-gradient text-hl-base" : "border-hl-border text-hl-muted hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="relative ml-auto min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hl-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items" className={`${input} w-full pl-8`} />
        </div>
      </div>
      <div className="mb-3 space-y-2">
        <StaffJobOutcome state={price.state} />
        <StaffJobOutcome state={remove.state} />
      </div>
      {!shown.length ? (
        <p className="text-sm text-hl-muted">{items.length ? "No items match." : "No items yet. Create one."}</p>
      ) : (
        <ul className="divide-y divide-hl-border">
          {shown.map((item) => {
            const builtIn = item.slug === TOP10_BADGE_SLUG;
            const draft = edits[item.slug] ?? String(item.price);
            const changed = draft !== String(item.price);
            return (
              <li key={item.slug} className="flex flex-wrap items-center gap-3 py-2.5">
                <ItemThumb item={item} />
                <div className="min-w-[10rem] flex-1">
                  <div className="truncate text-sm font-semibold text-white">
                    {item.name}
                    {builtIn ? (
                      <span className="ml-2 rounded bg-white/5 px-1.5 py-0.5 text-[0.6875rem] font-bold text-hl-muted">built-in</span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-hl-muted">
                    <span className="font-mono">{item.slug}</span> · {typeLabel(item.type)} ·{" "}
                    <span className={RARITY_TONE[item.rarity] ?? "text-hl-muted"}>{item.rarity}</span>
                    {item.category ? ` · ${item.category}` : ""} · {item.owners} owner{item.owners === 1 ? "" : "s"}
                  </div>
                </div>
                {builtIn ? (
                  <span className="text-xs text-hl-muted" title="Given to the Top 10 automatically">
                    Given automatically
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [item.slug]: e.target.value.replace(/\D/g, "").slice(0, 7) }))}
                      inputMode="numeric"
                      aria-label={`${item.name} price`}
                      className={`${input} w-24 text-right ${item.price > 0 || changed ? "" : "text-hl-muted"}`}
                    />
                    <button
                      type="button"
                      className={secondary}
                      disabled={!changed || !validPrice(draft) || busy}
                      onClick={() => void savePrice(item.slug, Number(draft))}
                    >
                      Save
                    </button>
                    <ConfirmButton
                      className={danger}
                      confirmText={item.owners ? `Remove from ${item.owners}?` : "Click again"}
                      disabled={busy}
                      onConfirm={() => void remove.run("item_delete", { slug: item.slug })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Delete</span>
                    </ConfirmButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </StaffCard>
  );
}

function CreateItem({ onSettled }: { onSettled: Settled }) {
  const [type, setType] = useState("card");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [asset, setAsset] = useState("");
  const [rarity, setRarity] = useState("common");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("0");
  const job = useStaffJob((done) => {
    onSettled(done);
    if (done.status !== "done") return;
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    setAsset("");
    setPrice("0");
  });

  const id = slugTouched ? slug : slugify(name);
  const folder = ITEM_TYPES.find((t) => t.type === type)?.folder ?? null;
  const titleTooLong = type === "title" && name.trim().length > MAX_TITLE_LENGTH;
  const valid = name.trim() && ITEM_SLUG_RE.test(id) && !titleTooLong && validPrice(price);

  return (
    <StaffCard>
      <CardTitle icon={<PackagePlus className="h-4 w-4 text-hl-gold" />} title="Create an item" hint="Same as /item create." />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={`${input} w-full`}>
            {ITEM_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Rarity</span>
          <select value={rarity} onChange={(e) => setRarity(e.target.value)} className={`${input} w-full`}>
            {ITEM_RARITIES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={fieldLabel}>{type === "title" ? `Title text (shown on profiles, max ${MAX_TITLE_LENGTH})` : "Name"}</span>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 64))} className={`${input} w-full`} />
          {titleTooLong ? <span className="mt-1 block text-xs text-hl-red">Too long for a title.</span> : null}
        </label>
        <label className="block sm:col-span-2">
          <span className={fieldLabel}>Id (stays the same forever)</span>
          <input
            value={id}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().slice(0, 40));
            }}
            placeholder="s1-gold-card"
            className={`${input} w-full font-mono`}
          />
          {id && !ITEM_SLUG_RE.test(id) ? (
            <span className="mt-1 block text-xs text-hl-red">2–40 lowercase letters, digits or dashes.</span>
          ) : null}
        </label>
        <label className="block sm:col-span-2">
          <span className={fieldLabel}>Description (optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value.slice(0, 200))} className={`${input} w-full`} />
        </label>
        {type === "background" ? (
          <label className="block">
            <span className={fieldLabel}>Colour</span>
            <div className="flex gap-2">
              <input value={asset} onChange={(e) => setAsset(e.target.value.slice(0, 9))} placeholder="#1e3a8a" className={`${input} min-w-0 flex-1 font-mono`} />
              <span className="h-9 w-9 shrink-0 rounded-lg border border-hl-border" style={{ background: asset ? (asset.startsWith("#") ? asset : `#${asset}`) : "#333" }} />
            </div>
          </label>
        ) : folder ? (
          <label className="block">
            <span className={fieldLabel}>Image file</span>
            <input value={asset} onChange={(e) => setAsset(e.target.value.slice(0, 120))} placeholder="gold.png" className={`${input} w-full font-mono`} />
            <span className="mt-1 block text-[0.6875rem] text-hl-muted">In the website&apos;s public{folder} folder.</span>
          </label>
        ) : (
          <div />
        )}
        {type === "badge" ? (
          <label className="block">
            <span className={fieldLabel}>Badge category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${input} w-full`}>
              <option value="">None</option>
              {BADGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className={fieldLabel}>Price (HL Coins, 0 = grant-only)</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 7))}
            inputMode="numeric"
            className={`${input} w-full`}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className={primary}
          disabled={!valid || job.busy}
          onClick={() =>
            void job.run("item_create", {
              item_type: type,
              slug: id,
              name: name.trim(),
              description: description.trim(),
              asset: asset.trim(),
              rarity,
              category: type === "badge" ? category : "",
              price: Number(price || 0),
            })
          }
        >
          Create item
        </button>
      </div>
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
    </StaffCard>
  );
}

function PriceAll({ onSettled }: { onSettled: Settled }) {
  const [price, setPrice] = useState("");
  const job = useStaffJob(onSettled);
  const n = Number(price);
  return (
    <StaffCard>
      <CardTitle
        icon={<Tags className="h-4 w-4 text-hl-gold" />}
        title="Price everything"
        hint="Puts every item in the shop at one price, or 0 to take them all out. The Top 10 badge stays grant-only. Same as /item priceall."
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 7))}
          inputMode="numeric"
          placeholder="HL Coins"
          aria-label="Price for every item"
          className={`${input} w-32`}
        />
        <ConfirmButton
          className={secondary}
          confirmText="Click again: every item"
          disabled={!validPrice(price) || job.busy}
          onConfirm={() => void job.run("item_priceall", { price: n })}
        >
          {price && n === 0 ? "Take all out of the shop" : "Price every item"}
        </ConfirmButton>
      </div>
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
    </StaffCard>
  );
}

export function ShopTab({ onSettled }: { onSettled: () => void }) {
  const [items, setItems] = useState<ShopCatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/staff/shop", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { items?: ShopCatalogItem[]; error?: string };
        if (!alive) return;
        if (res.ok) {
          setItems(json.items ?? []);
          setError(null);
        } else {
          setError(json.error || "Couldn't load the shop tab.");
        }
      })
      .catch(() => alive && setError("Couldn't load the shop tab."));
    return () => {
      alive = false;
    };
  }, [reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const settled = useCallback(() => {
    onSettled();
    refresh();
  }, [onSettled, refresh]);

  if (error && !items) return <p className="text-sm text-hl-red">{error}</p>;
  if (!items) return <div className="py-10 text-center text-sm text-hl-muted">Loading…</div>;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Catalog items={items} onReload={refresh} onSettled={settled} />
      <div className="space-y-5">
        <CreateItem onSettled={settled} />
        <PriceAll onSettled={settled} />
      </div>
    </div>
  );
}
