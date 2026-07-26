import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The single card treatment used across the dashboard. Every panel gets the
 * same border, surface and optional titled header, so a page of ten panels
 * reads as one system rather than ten widgets.
 */
export function Panel({
  title,
  eyebrow,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}): React.JSX.Element {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      {(title || eyebrow || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-porcelain/10 px-5 py-4 sm:px-6">
          <div>
            {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
            {title && (
              <h2 className="text-[15px] font-semibold tracking-tight text-porcelain">{title}</h2>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn("px-5 py-5 sm:px-6", bodyClassName)}>{children}</div>
    </section>
  );
}
