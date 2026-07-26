import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sentinel Observ",
  description: "Uptime monitoring and alerting for the Sentinel platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#0b0f14",
          color: "#e6edf3",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
