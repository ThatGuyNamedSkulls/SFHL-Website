"use client";

import { useState } from "react";
import { ChevronDown, Crown, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** Shared look of the clan pages (docs/CLANS_UI_PLAN.md §2.6): serious, with some color. */
export const PANEL = "rounded-[0.625rem] border border-white/[0.07] bg-[#1c1c1c]";
const BTN =
  "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-xs font-bold uppercase tracking-[0.05em] transition-colors disabled:pointer-events-none disabled:opacity-50";
export const BTN_PRIMARY = `${BTN} bg-[#ff5500] text-white hover:bg-[#ff6a1f]`;
export const BTN_LINE = `${BTN} border border-white/15 text-[#ededed] hover:border-white/30`;
export const BTN_SOFT = `${BTN} border border-white/[0.09] bg-[#222] text-[#ededed] hover:border-white/20`;
export const BTN_DANGER = `${BTN} border border-[#e74c3c]/40 text-[#f08a7f] hover:border-[#e74c3c]/70`;
export const BTN_SM = "!h-[1.875rem] !rounded-md !px-2.5 !text-[0.6875rem]";
export const INPUT =
  "h-9 w-full rounded-lg border border-white/[0.07] bg-[#141414] px-3 text-sm font-normal text-[#ededed] outline-none placeholder:text-[#6a6a6a] focus:border-white/25 disabled:opacity-60";
/** A native select in the clan pages' style. */
export function NativeSelect({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        {...props}
        className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-white/[0.07] bg-[#141414] pl-3 pr-8 text-[0.8125rem] text-[#ededed] outline-none focus:border-white/25"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8a8a]" />
    </span>
  );
}

/** Section header inside a panel: a title and something on the right. */
export function BoxHead({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-[3.25rem] items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
      <h2 className="text-sm font-bold text-[#ededed]">{title}</h2>
      {children ? <div className="flex items-center gap-2 text-xs text-[#8a8a8a]">{children}</div> : null}
    </div>
  );
}

const hueOf = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 17);
const initials = (s: string) => (s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "?").toUpperCase();

/** A player's picture, or their initials on a muted color; a green dot while online. */
export function PlayerAvatar({
  name,
  src,
  size = 32,
  online = false,
}: {
  name: string;
  src?: string | null;
  size?: number;
  online?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const h = hueOf(name || "?");
  const showImg = !!src && failed !== src;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full rounded-full object-cover"
          onError={() => setFailed(src!)}
        />
      ) : (
        <span
          className="grid h-full w-full place-items-center rounded-full font-bold"
          style={{
            background: `hsl(${h} 28% 30%)`,
            color: `hsl(${h} 45% 88%)`,
            fontSize: Math.max(8, Math.round(size * 0.38)),
          }}
        >
          {size >= 20 ? initials(name) : ""}
        </span>
      )}
      {online ? (
        <span
          aria-label="Online"
          className="absolute -bottom-px -right-px rounded-full bg-[#2ecc71] ring-2 ring-[#1c1c1c]"
          style={{ width: Math.max(7, size * 0.28), height: Math.max(7, size * 0.28) }}
        />
      ) : null}
    </span>
  );
}

/** "Open" / "Invite only". */
export function JoiningChip({ isPrivate, className = "" }: { isPrivate: boolean; className?: string }) {
  return isPrivate ? (
    <span
      className={`inline-flex h-[1.375rem] items-center gap-1.5 whitespace-nowrap rounded-md border border-[#e9c27a]/30 bg-[#141008]/55 px-2 text-[0.71875rem] font-semibold text-[#e9c27a] ${className}`}
    >
      <Lock className="h-3 w-3" /> Invite only
    </span>
  ) : (
    <span
      className={`inline-flex h-[1.375rem] items-center whitespace-nowrap rounded-md border border-[#2ecc71]/30 bg-[#08140d]/55 px-2 text-[0.71875rem] font-semibold text-[#7fd8a4] ${className}`}
    >
      Open
    </span>
  );
}

/** Owner in gold, custom roles in the clan's color, Member as plain text. */
export function RoleChip({ roleId, name, color }: { roleId: string; name: string; color: string }) {
  if (roleId === "owner") {
    return (
      <span className="inline-flex h-[1.375rem] items-center gap-1 whitespace-nowrap rounded-md bg-[#d9b25f]/10 px-2 text-[0.6875rem] font-bold uppercase tracking-[0.04em] text-[#e3c27a] shadow-[inset_0_0_0_1px_rgba(217,178,95,0.3)]">
        <Crown className="h-3 w-3" /> {name}
      </span>
    );
  }
  if (roleId === "member") return <span className="text-[0.8125rem] font-semibold text-[#8a8a8a]">{name}</span>;
  return (
    <span
      className="inline-flex h-[1.375rem] items-center whitespace-nowrap rounded-md px-2 text-[0.6875rem] font-bold uppercase tracking-[0.04em]"
      style={{
        color: `color-mix(in srgb, ${color} 45%, #fff)`,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      {name}
    </span>
  );
}

const MEDALS = [
  "bg-[#d9b25f]/15 text-[#e3c27a] shadow-[inset_0_0_0_1px_rgba(217,178,95,0.38)]",
  "bg-[#bebebe]/10 text-[#d0d0d0] shadow-[inset_0_0_0_1px_rgba(190,190,190,0.32)]",
  "bg-[#c08457]/15 text-[#d29a6c] shadow-[inset_0_0_0_1px_rgba(192,132,87,0.38)]",
];

/** 1 / 2 / 3 in gold, silver and bronze; a plain number after that. */
export function Medal({ n }: { n: number }) {
  if (n > 3) return <span className="w-[1.375rem] shrink-0 text-center text-sm font-semibold tabular-nums text-[#8a8a8a]">{n}</span>;
  return (
    <span className={`grid h-[1.375rem] w-[1.375rem] shrink-0 place-items-center rounded-full text-[0.6875rem] font-extrabold ${MEDALS[n - 1]}`}>
      {n}
    </span>
  );
}

/** "[NOVA] name": inside a clan, everyone shows with its tag (Q5). */
export function TaggedName({ tag, name, className = "" }: { tag: string; name: string; className?: string }) {
  return (
    <span className={className}>
      <span className="mr-1.5 text-[0.86em] font-semibold tracking-[0.02em] text-[#ff5500]">[{tag}]</span>
      {name}
    </span>
  );
}

/** Matches together per day, oldest → newest. */
export function WeekBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <span className="flex h-[1.125rem] items-end gap-[2px]" aria-hidden>
      {counts.map((n, i) => (
        <i
          key={i}
          className={`w-[5px] rounded-[1px] ${n ? "bg-[#2ecc71]/70" : "bg-[#333]"}`}
          style={{ height: n ? 5 + Math.round((n / max) * 13) : 3 }}
        />
      ))}
    </span>
  );
}

/** A yes / no question before a lasting change (leave, remove, transfer, delete). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onCancel())}>
      <DialogContent showCloseButton={false} className="gap-0 border border-white/10 bg-[#1b1b1b] p-0 sm:max-w-[26rem]">
        <div className="px-[1.125rem] pb-4 pt-[1.125rem]">
          <DialogTitle className="text-base font-bold text-[#ededed]">{title}</DialogTitle>
          <div className="mt-2 text-[0.8125rem] leading-relaxed text-[#bdbdbd]">{body}</div>
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.07] px-[1.125rem] py-3">
          <button type="button" className={BTN_LINE} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={danger ? BTN_DANGER : BTN_PRIMARY} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
