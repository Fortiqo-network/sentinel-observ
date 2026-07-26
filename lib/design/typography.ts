/**
 * Typography tokens — mirrors sentinel-frontend so headings and data readouts
 * use the same typefaces (Archivo for display, IBM Plex Mono for metrics).
 *
 * Explicit types are required because TypeScript infers mixed arrays as
 * `(string | object)[]`, which doesn't satisfy Tailwind's tuple constraints.
 */

type FontSizeEntry = [
  size: string,
  config: Partial<{ lineHeight: string; letterSpacing: string; fontWeight: string | number }>,
];

export const fontFamily: Record<string, string[]> = {
  sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
  mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
  brand: ["var(--font-archivo)", "system-ui", "sans-serif"],
  "brand-mono": ["var(--font-plex-mono)", "ui-monospace", "monospace"],
};

export const fontSize: Record<string, FontSizeEntry> = {
  /** 36–56 px — page titles. */
  "display-sm": [
    "clamp(2.25rem, 6vw, 3.5rem)",
    { lineHeight: "1.04", letterSpacing: "-0.03em" },
  ],
  /** 44–96 px — the headline uptime readout. */
  display: [
    "clamp(2.75rem, 9vw, 6rem)",
    { lineHeight: "0.98", letterSpacing: "-0.035em" },
  ],
};
