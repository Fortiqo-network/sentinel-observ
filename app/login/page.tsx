import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { Tessera } from "@/components/brand/Tessera";
import { isAuthConfigured } from "@/lib/password";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function LoginPage(): React.JSX.Element {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 aurora-wash" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Tessera className="h-10 w-10 text-porcelain" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-porcelain">
            Sentinel <span className="text-gold">Observ</span>
          </h1>
          <p className="mt-1.5 text-sm text-graphite">Private monitoring dashboard</p>
        </div>

        {isAuthConfigured() ? (
          <LoginForm />
        ) : (
          <div className="panel panel-pad text-sm leading-relaxed text-graphite">
            <p className="font-medium text-status-degraded">Access is not configured.</p>
            <p className="mt-2">
              Set <code className="text-gold">DASHBOARD_PASSWORD_HASH</code> in the Vercel project
              and redeploy. Until then the dashboard stays locked — it never falls back to public
              access.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
