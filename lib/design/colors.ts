/**
 * Color palette — mirrors sentinel-frontend's design tokens so the monitoring
 * dashboard reads as the same product. The ink/porcelain/gold/graphite values
 * are copied verbatim from sentinel-frontend/src/lib/design/colors.ts; only the
 * `status` scale below is specific to this app.
 *
 * Imported by tailwind.config.ts, so Tailwind classes (bg-ink-950, text-gold,
 * text-status-up, …) always match these values.
 */

export const ink = {
  950: "#0B0C0F",
  900: "#0E1014",
  800: "#111318",
  700: "#191C23",
  600: "#23262e",
  500: "#2c2f38",
} as const;

/** Primary light text on dark (ink) surfaces. */
export const porcelain = "#ECEAE3";

/** Amber/gold — the sealed-core identity accent. */
export const gold = {
  DEFAULT: "#E7A03C",
  deep: "#B97718",
} as const;

/** Muted neutrals for secondary chrome on dark surfaces. */
export const graphite = {
  DEFAULT: "#80848F",
  dim: "#4A4E58",
} as const;

/** Sentinel indigo — the interactive accent shared with the app shell. */
export const sentinel = {
  50: "#f0f4ff",
  100: "#e0e9ff",
  200: "#c7d7fe",
  300: "#a5bafc",
  400: "#8193f8",
  500: "#6366f1",
  600: "#4f46e5",
  700: "#4338ca",
  800: "#3730a3",
  900: "#312e81",
  950: "#1e1b4b",
} as const;

/**
 * Operational status scale. Semantic, not brand-specific — every status dot,
 * uptime bar, chart series and alert chip resolves through these five values so
 * "green" means exactly one thing across the whole dashboard.
 */
export const status = {
  up: "#22c55e",
  degraded: "#f59e0b",
  down: "#ef4444",
  maintenance: "#6366f1",
  unknown: "#4A4E58",
} as const;

export const colors = {
  ink,
  porcelain,
  gold,
  graphite,
  sentinel,
  status,
} as const;
