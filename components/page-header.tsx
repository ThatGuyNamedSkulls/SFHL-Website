import { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  /** Optional right-aligned content (actions, filters, counts). */
  actions?: React.ReactNode;
  className?: string;
}

/** Standard page header: icon + title + subtitle, with optional right-side actions. */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={`mb-8 flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div>
        <h1 className="text-2xl font-bold text-white header-caps flex items-center gap-3">
          {Icon && <Icon className="w-6 h-6 text-hl-gold" />}
          {title}
        </h1>
        {subtitle && <p className="text-sm text-hl-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
