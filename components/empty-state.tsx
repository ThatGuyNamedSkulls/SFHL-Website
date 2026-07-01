import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  className?: string;
  children?: React.ReactNode;
}

/** Consistent empty/no-data placeholder: icon + title + optional hint/action. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  className = "",
  children,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}
    >
      {Icon && (
        <div className="w-12 h-12 rounded-xl bg-hl-panel-light flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-hl-muted" />
        </div>
      )}
      <p className="text-sm font-semibold text-white">{title}</p>
      {hint && <p className="text-sm text-hl-muted mt-1 max-w-sm">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
