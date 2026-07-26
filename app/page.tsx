import { probeAll } from "@/lib/probe";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const results = await probeAll();
  const up = results.filter((r) => r.ok).length;
  const configured = results.filter(
    (r) => !r.error?.includes("not configured")
  );
  const allUp = configured.length > 0 && configured.every((r) => r.ok);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Sentinel Observ</h1>
      <p style={{ color: "#8b949e", marginTop: 0 }}>
        Live platform status · probes run on page load · {up}/{results.length}{" "}
        up
      </p>

      <div
        style={{
          padding: "12px 16px",
          borderRadius: 8,
          margin: "24px 0",
          background: allUp ? "#12261b" : "#2a1517",
          border: `1px solid ${allUp ? "#1f6f3f" : "#8b2a2f"}`,
        }}
      >
        {allUp ? "🟢 All monitored systems operational" : "🔴 Some systems are degraded or unmonitored"}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#8b949e", fontSize: 13 }}>
            <th style={{ padding: "8px 4px" }}>Service</th>
            <th style={{ padding: "8px 4px" }}>State</th>
            <th style={{ padding: "8px 4px" }}>HTTP</th>
            <th style={{ padding: "8px 4px" }}>Latency</th>
            <th style={{ padding: "8px 4px" }}>Detail</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr
              key={r.id}
              style={{ borderTop: "1px solid #21262d", fontSize: 14 }}
            >
              <td style={{ padding: "10px 4px", fontWeight: 600 }}>{r.name}</td>
              <td style={{ padding: "10px 4px" }}>
                {r.ok ? "🟢 up" : r.error?.includes("not configured") ? "⚪ n/a" : "🔴 down"}
              </td>
              <td style={{ padding: "10px 4px", color: "#8b949e" }}>
                {r.status ?? "—"}
              </td>
              <td style={{ padding: "10px 4px", color: "#8b949e" }}>
                {r.latencyMs != null ? `${r.latencyMs} ms` : "—"}
              </td>
              <td style={{ padding: "10px 4px", color: "#8b949e", fontSize: 12 }}>
                {r.error ?? "ok"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ color: "#484f58", fontSize: 12, marginTop: 32 }}>
        Phase 1 preview — history, incidents, Slack alerting and daily/weekly
        reports land in Phase 2. Internal services show &quot;n/a&quot; until
        the gateway aggregate endpoint is deployed.
      </p>
    </main>
  );
}
