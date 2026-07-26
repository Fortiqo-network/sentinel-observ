import type { ReactNode } from "react";
import { TopBar } from "./TopBar";

/**
 * Shared page frame: sticky header with the live-refresh control, a centred
 * content column, and the provenance footer. Every page uses it so navigation
 * and refresh behaviour are identical everywhere.
 */
export function PageShell({
  generatedAt,
  children,
}: {
  generatedAt: Date;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-ink-950">
      <TopBar generatedAt={generatedAt.toISOString()} />
      <main className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 sm:py-10">
        <div className="animate-fade-in space-y-6">{children}</div>
      </main>
      <footer className="border-t border-porcelain/10 px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
          <span>sentinel-observ · probes every 5 min · alerts to #sentinel-alarms</span>
          <span>all times UTC</span>
        </div>
      </footer>
    </div>
  );
}
