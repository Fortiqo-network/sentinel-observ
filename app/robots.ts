import type { MetadataRoute } from "next";

/**
 * Disallow everything. This dashboard is private infrastructure — it is behind
 * a password, and it should not appear in any index even if a URL leaks.
 *
 * The per-page `robots: { index: false }` metadata covers crawlers that have
 * already fetched a page; this stops well-behaved ones from fetching at all.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
