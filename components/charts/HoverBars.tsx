"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Bar strip with a real hover readout.
 *
 * Native `title` tooltips were the first attempt and were effectively
 * invisible: they take about a second to appear, render in OS chrome, and give
 * no affordance that a bar is inspectable at all. Every bar chart in the
 * dashboard uses this instead, so hovering anywhere always answers "what is
 * this number?".
 */

export type HoverBar = {
  key: string;
  /** Height as a fraction of the plot area, 0–1. */
  fraction: number;
  /** Tailwind classes for the bar fill. */
  className: string;
  /** Bold first line of the readout, e.g. the date or hour. */
  label: string;
  /** The number itself, e.g. "142 visits" or "100% up". */
  value: string;
  /** Optional third line for extra context. */
  detail?: string;
};

export function HoverBars({
  bars,
  heightClass = "h-8",
  minBarPct = 3,
  className,
}: {
  bars: HoverBar[];
  heightClass?: string;
  /** Floor applied to non-zero bars so a value of 1 is still visible. */
  minBarPct?: number;
  className?: string;
}): React.JSX.Element {
  const [active, setActive] = useState<number | null>(null);
  const hovered = active === null ? null : bars[active];

  return (
    <div className={cn("relative", className)}>
      {hovered && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-porcelain/15 bg-ink-800 px-3 py-2 shadow-xl"
          style={{
            left: `${Math.min(92, Math.max(8, ((active! + 0.5) / bars.length) * 100))}%`,
          }}
        >
          <div className="font-brand-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
            {hovered.label}
          </div>
          <div className="metric mt-0.5 text-sm font-semibold text-porcelain">{hovered.value}</div>
          {hovered.detail && (
            <div className="mt-0.5 text-[11px] text-graphite">{hovered.detail}</div>
          )}
        </div>
      )}

      <div
        className={cn("flex items-end gap-[2px]", heightClass)}
        onMouseLeave={() => setActive(null)}
      >
        {bars.map((bar, index) => (
          <button
            key={bar.key}
            type="button"
            aria-label={`${bar.label}: ${bar.value}`}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onClick={() => setActive(index === active ? null : index)}
            // The full-height wrapper keeps the hover target the whole column,
            // so short bars are as easy to inspect as tall ones.
            className="group relative flex h-full min-w-[2px] flex-1 items-end outline-none"
          >
            <span
              className={cn(
                "w-full rounded-t-[2px] transition-all",
                bar.className,
                active === index ? "brightness-150" : "group-hover:brightness-125",
              )}
              style={{
                height: `${bar.fraction <= 0 ? 0 : Math.max(minBarPct, bar.fraction * 100)}%`,
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
