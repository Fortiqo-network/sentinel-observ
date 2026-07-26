import Link from "next/link";
import { Tessera } from "@/components/brand/Tessera";
import { AutoRefresh } from "./AutoRefresh";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/incidents", label: "Incidents" },
  { href: "/api/status", label: "API" },
];

/** Sticky header: brand mark, section links, and the live-refresh control. */
export function TopBar({ generatedAt }: { generatedAt: string }): React.JSX.Element {
  return (
    <header className="sticky top-0 z-30 border-b border-porcelain/10 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-5 py-3.5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Tessera className="h-6 w-6 text-porcelain" />
          <span className="text-[15px] font-semibold tracking-tight text-porcelain">
            Sentinel <span className="text-gold">Observ</span>
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 sm:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-graphite transition hover:bg-porcelain/5 hover:text-porcelain"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <AutoRefresh generatedAt={generatedAt} />
        </div>
      </div>
    </header>
  );
}
