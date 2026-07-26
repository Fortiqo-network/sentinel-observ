#!/usr/bin/env node
/**
 * One-shot health check of all Sentinel services. Zero dependencies (Node 18+).
 *
 *   node scripts/probe.mjs            # on the server: public + internal (localhost ports)
 *   node scripts/probe.mjs --public   # anywhere: public endpoints only
 */

const publicOnly = process.argv.includes("--public");

const TARGETS = [
  { name: "gateway",  url: "https://sentinel-api.fortiqo.xyz/health", public: true },
  { name: "frontend", url: "https://sentinel.fortiqo.xyz/",           public: true },
  { name: "core-api", url: "http://localhost:8000/v1/health" },
  { name: "verify",   url: "http://localhost:8001/api/v1/health" },
  { name: "billing",  url: "http://localhost:8002/v1/health" },
  { name: "registry", url: "http://localhost:8003/v1/health" },
  { name: "runtime",  url: "http://localhost:8004/v1/health" },
];

const TIMEOUT_MS = 10_000;

async function probe(t) {
  const started = Date.now();
  try {
    const res = await fetch(t.url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    return {
      ...t,
      ok: res.ok,
      status: res.status,
      latency: Date.now() - started,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const cause = err?.cause?.code ?? err?.name ?? "error";
    return {
      ...t,
      ok: false,
      status: null,
      latency: null,
      error: cause === "TimeoutError" || err?.name === "TimeoutError"
        ? `timeout ${TIMEOUT_MS / 1000}s`
        : String(cause),
    };
  }
}

const targets = publicOnly ? TARGETS.filter((t) => t.public) : TARGETS;
const results = await Promise.all(targets.map(probe));

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("SERVICE", 10) + pad("STATE", 7) + pad("HTTP", 6) + pad("MS", 7) + "URL / ERROR");
console.log("-".repeat(70));
for (const r of results) {
  console.log(
    pad(r.name, 10) +
    pad(r.ok ? "🟢 UP" : "🔴 DOWN", 7) +
    pad(r.status ?? "-", 6) +
    pad(r.latency ?? "-", 7) +
    (r.ok ? r.url : `${r.url}  (${r.error})`)
  );
}

const down = results.filter((r) => !r.ok);
console.log("-".repeat(70));
console.log(`${results.length - down.length}/${results.length} up${down.length ? ` — DOWN: ${down.map((d) => d.name).join(", ")}` : ""}`);
process.exit(down.length ? 1 : 0);
