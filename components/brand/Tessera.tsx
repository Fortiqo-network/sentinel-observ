import { cn } from "@/lib/utils/cn";

/** The two counterpart halves of the token and the seam that runs between them. */
const HALF_LEFT = "M98 45 H69 A24 24 0 0 0 45 69 V171 A24 24 0 0 0 69 195 H128 V119 H98 Z";
const HALF_RIGHT = "M112 45 H171 A24 24 0 0 1 195 69 V171 A24 24 0 0 1 171 195 H142 V105 H112 Z";
const SEAM = "M105 45 V112 H135 V195";

/**
 * The Sentinel **Tessera** — two halves of one token with an amber seam that
 * scans top-to-bottom forever. Ported from sentinel-frontend so the monitor
 * carries the same mark as the product it watches. Pure SVG + CSS.
 */
export function Tessera({
  className,
  animate = true,
  fill = "currentColor",
}: {
  className?: string;
  animate?: boolean;
  fill?: string;
}): React.JSX.Element {
  return (
    <svg viewBox="0 0 240 240" fill="none" className={cn("overflow-visible", className)} aria-hidden>
      <path d={HALF_LEFT} fill={fill} />
      <path d={HALF_RIGHT} fill={fill} />
      {animate ? (
        <path
          className="tessera-scan"
          pathLength={180}
          d={SEAM}
          fill="none"
          stroke="#E7A03C"
          strokeWidth={14}
        />
      ) : (
        <path d={SEAM} fill="none" stroke="#E7A03C" strokeWidth={14} />
      )}
    </svg>
  );
}
