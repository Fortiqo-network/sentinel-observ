import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Sentinel Observ — platform status",
    template: "%s | Sentinel Observ",
  },
  description:
    "Live uptime, latency and incident history for every Sentinel platform service, probed every five minutes.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0B0C0F",
};

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
