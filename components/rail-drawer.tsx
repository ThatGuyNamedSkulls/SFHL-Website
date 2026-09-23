"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const noopSubscribe = () => () => {};

/**
 * Full-height panel that slides out beside the right rail (Social, Party).
 * Closes on Esc and on a click outside both the panel and the rail.
 */
export function RailDrawer({
  open,
  onClose,
  title,
  actions,
  ignoreRef,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  actions?: React.ReactNode;
  /** Clicks inside this element (the rail) don't close the drawer. */
  ignoreRef?: React.RefObject<HTMLElement | null>;
  label: string;
  children: React.ReactNode;
}) {
  // Portals need document.body: true on the client, false while server-rendering.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || ignoreRef?.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, ignoreRef]);

  if (!mounted || !open) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className="fixed z-[80] top-2 bottom-2 w-[300px] max-w-[calc(100vw-var(--hl-sidebar-w)-16px)] flex flex-col rounded-xl border border-white/[0.08] bg-[#161616] shadow-2xl overflow-hidden"
      style={{ right: "calc(var(--hl-sidebar-w) + 8px)" }}
    >
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 shrink-0">
        <div className="min-w-0 flex-1 text-[17px] font-black text-white truncate">{title}</div>
        {actions}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 text-[#8a8a8a] hover:text-white rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ff5500]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>,
    document.body
  );
}

/** Icon tab strip (FACEIT party panel). */
export function IconTabs<T extends string>({
  tabs,
  value,
  onChange,
  trailing,
}: {
  tabs: { id: T; label: string; icon: React.ReactNode; dot?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-stretch border-b border-white/[0.06] px-2 shrink-0" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          title={t.label}
          aria-label={t.label}
          onClick={() => onChange(t.id)}
          className={`relative w-11 h-10 flex items-center justify-center transition-colors ${
            value === t.id ? "text-[#ff5500]" : "text-[#8a8a8a] hover:text-white"
          }`}
        >
          {t.icon}
          {t.dot ? (
            <span className="absolute top-2 right-2.5 w-1.5 h-1.5 rounded-full bg-[#ff5500]" />
          ) : null}
          {value === t.id ? (
            <span className="absolute left-2.5 right-2.5 bottom-0 h-[2px] rounded-full bg-[#ff5500]" />
          ) : null}
        </button>
      ))}
      <div className="flex-1" />
      {trailing}
    </div>
  );
}

/** Text tab strip (FACEIT Social panel: FRIENDS / CHATS). */
export function TextTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-6 px-4 border-b border-white/[0.06] shrink-0" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`relative py-2.5 text-[12px] font-black uppercase tracking-[0.08em] transition-colors ${
            value === t.id ? "text-[#ff5500]" : "text-[#9a9a9a] hover:text-white"
          }`}
        >
          {t.label}
          {t.badge ? (
            <span className="ml-1.5 inline-flex min-w-[16px] h-4 px-1 rounded-full bg-[#ff5500] text-[#111] text-[9px] leading-4 align-middle">
              {t.badge > 9 ? "9+" : t.badge}
            </span>
          ) : null}
          {value === t.id ? (
            <span className="absolute left-1 right-1 bottom-0 h-[2px] rounded-full bg-[#ff5500]" />
          ) : null}
        </button>
      ))}
    </div>
  );
}
