import Link from "next/link";
import { Tessera } from "@/components/brand/Tessera";

export default function NotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <Tessera className="h-12 w-12 text-porcelain/60" />
      <h1 className="text-2xl font-semibold tracking-tight text-porcelain">Nothing monitored here</h1>
      <p className="max-w-md text-sm leading-relaxed text-graphite">
        That page does not exist. Services are listed on the overview, and every monitored service
        has a detail page at <code className="text-gold">/services/&lt;id&gt;</code>.
      </p>
      <Link
        href="/"
        className="rounded-full border border-porcelain/15 px-4 py-2 font-brand-mono text-[11px] uppercase tracking-[0.14em] text-porcelain transition hover:border-gold/40 hover:text-gold"
      >
        back to overview
      </Link>
    </main>
  );
}
