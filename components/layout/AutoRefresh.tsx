"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the dashboard live without a websocket: it re-runs the server
 * components on an interval and shows how stale the current view is.
 *
 * Refreshing pauses while the tab is hidden — a backgrounded status page
 * should not keep probing seven services every 30 seconds.
 */
export function AutoRefresh({
  intervalSeconds = 60,
  generatedAt,
}: {
  intervalSeconds?: number;
  generatedAt: string;
}): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [age, setAge] = useState(0);

  useEffect(() => {
    setAge(0);
  }, [generatedAt]);

  useEffect(() => {
    const tick = setInterval(() => {
      setAge((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (age > 0 && age % intervalSeconds === 0 && !document.hidden) {
      startTransition(() => router.refresh());
    }
  }, [age, intervalSeconds, router]);

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      className="group inline-flex items-center gap-2 rounded-full border border-porcelain/10 bg-ink-800/70 px-3 py-1.5 font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite transition hover:border-gold/40 hover:text-porcelain"
    >
      <span
        className={
          isPending
            ? "h-1.5 w-1.5 rounded-full bg-gold"
            : "h-1.5 w-1.5 rounded-full bg-status-up"
        }
      />
      {isPending ? "refreshing" : `updated ${age}s ago`}
    </button>
  );
}
