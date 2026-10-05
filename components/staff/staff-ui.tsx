"use client";

/** Shared look for the staff panel's forms (same styles as League → Manage). */
import { useEffect, useState, type ReactNode } from "react";

const btn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-black header-caps whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed";
export const primary = `find-match-btn text-hl-base ${btn}`;
export const secondary = `border border-hl-border text-white hover:border-hl-gold/50 ${btn}`;
export const danger = `border border-hl-red/50 text-hl-red hover:bg-hl-red/10 ${btn}`;
export const input =
  "h-9 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted [color-scheme:dark]";
export const fieldLabel = "mb-1 block text-[0.6875rem] font-bold header-caps text-hl-muted";

export function CardTitle({ icon, title, hint, right }: { icon: ReactNode; title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-black header-caps text-white">
          {icon}
          {title}
        </h2>
        {hint ? <p className="mt-1 text-xs text-hl-muted">{hint}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** A panel. Not ui/Card: that one spaces its children apart and clips overflow (the search dropdown). */
export function StaffCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-hl-border bg-hl-panel p-5 text-sm ${className}`}>{children}</div>;
}

/** A small sub-heading inside a card. */
export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-bold header-caps text-hl-muted">{children}</h3>;
}

/**
 * A button that needs a second click within 4 seconds, for actions that are
 * hard to undo (reset placements, ban). The first click only arms it.
 */
export function ConfirmButton({
  children,
  confirmText,
  onConfirm,
  disabled,
  className = danger,
}: {
  children: ReactNode;
  confirmText: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      className={className}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmText : children}
    </button>
  );
}

/** A removable tag (badges, rewards, items). `onRemove` absent = read-only. */
export function Tag({ children, onRemove, disabled }: { children: ReactNode; onRemove?: () => void; disabled?: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-hl-border bg-hl-base/70 px-2 py-1 text-xs text-white">
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Remove"
          title="Remove"
          className="-mr-0.5 rounded px-0.5 text-hl-muted hover:text-hl-red disabled:opacity-40"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
