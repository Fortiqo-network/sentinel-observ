/** Formatting helpers shared by the Slack messages and the dashboard UI. */

/** `2026-07-26 10:05 UTC` — the timestamp format used in every alert. */
export function formatUtc(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** `10:05 UTC` — short form for inline references. */
export function formatUtcTime(date: Date): string {
  return `${date.toISOString().slice(11, 16)} UTC`;
}

/** `2 d 3 h`, `23 m`, `41 s` — the largest two units that matter. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem ? `${hours} h ${rem} m` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days} d ${rem} h` : `${days} d`;
}

/** Elapsed seconds between two instants, floored at zero. */
export function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 1000);
}

/**
 * Uptime percentage from downtime seconds over a window.
 * Rendered with more precision the closer it is to 100 %, so a 3-minute outage
 * in a 30-day window does not round away to "100%".
 */
export function uptimePercent(downtimeSecs: number, windowSecs: number): number {
  if (windowSecs <= 0) return 100;
  const pct = (1 - downtimeSecs / windowSecs) * 100;
  return Math.max(0, Math.min(100, pct));
}

export function formatPercent(pct: number): string {
  if (pct >= 99.995) return "100%";
  if (pct >= 99.9) return `${pct.toFixed(3)}%`;
  if (pct >= 99) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
}

/** 🟢 100 % · 🟡 below 100 % · 🔴 below 99 % or currently down. */
export function healthEmoji(uptimePct: number, currentlyDown: boolean): string {
  if (currentlyDown || uptimePct < 99) return "🔴";
  if (uptimePct < 99.995) return "🟡";
  return "🟢";
}

/** Pad a cell for Slack's fixed-width context blocks (Slack has no tables). */
export function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

export function padStart(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : " ".repeat(width - value.length) + value;
}
