"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Password prompt for the dashboard. Posts to `/api/auth/login`, which sets the session cookie. */
export function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace(params.get("next") ?? "/");
        router.refresh();
        return;
      }
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? `Sign-in failed (${res.status})`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel panel-pad space-y-4">
      <div>
        <label htmlFor="password" className="eyebrow">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          className="mt-2 w-full rounded-lg border border-porcelain/15 bg-ink-950/60 px-3 py-2.5 font-brand-mono text-sm text-porcelain outline-none transition placeholder:text-graphite/60 focus:border-gold/50"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <p className="rounded-md bg-status-down/10 px-3 py-2 text-xs text-status-down">{error}</p>
      )}

      <button
        type="submit"
        disabled={pending || password.length === 0}
        className="w-full rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
