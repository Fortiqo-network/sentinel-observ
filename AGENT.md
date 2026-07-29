# sentinel-observ — developer guide

This is the canonical instruction file for sentinel-observ. `CLAUDE.md` and `AGENT.md` are
byte-identical copies — edit both together.

## Engineering standards (read before writing any code)

- **No system breakage is ever acceptable.** Every change must leave the app buildable. Run
  `npm run type-check` and `npm run build` before considering a task done.
- Prefer the smallest change that fully solves the problem. Do not refactor unrelated code or
  restyle files you were not asked to touch.
- Write reusable, DRY code; reuse existing helpers before adding new ones. Match the surrounding
  style and idioms.
- **If you are unsure, confused, or lack context to make a safe change, STOP and ask** rather than
  guessing. A blocked question is cheaper than a broken system.

### Comments and documentation

- **Prefer JSDoc over inline comments.** Every exported function/module gets a docstring saying what
  it does, its contract, and any non-obvious behaviour — the *why*, not the *what*.
- Inline comments are only permitted as genuine "come back later" markers, and must state the
  condition for their own removal. Remove them once resolved.

## What this service is

An external uptime monitor for the Sentinel platform. It probes every service from outside the
network every five minutes, alerts Slack on transitions, and serves a status dashboard.

**Deploys as its own Vercel project to https://monitor.fortiqo.xyz** (Cloudflare DNS, same shape as
`docs.fortiqo.xyz`). Push to `main` → Vercel build. The 5-minute cadence comes from this repo's own
GitHub Actions workflow, not Vercel Cron — Hobby-plan crons only fire once per day. Runbook:
[`docs/08-deployment.md`](docs/08-deployment.md).

It is **read-only with respect to running services**: it calls health endpoints and nothing else.
It never writes to a Sentinel service, never reads user data, and never proxies user traffic.

**One deliberate exception: ChatOps deploys.** `/api/slack/{command,interactive}` can trigger a
service's GitHub Actions deploy workflow from a Slack button. That makes this app a control plane,
not purely an observer, and it is the only part of the system that can change production. It is
built accordingly:

- Slack request-signature verification is the perimeter (these routes cannot sit behind the
  dashboard password — Slack cannot log in), with a 5-minute replay window.
- A **valid signature is not authorisation**: anyone in a shared channel can click a button, so a
  `SLACK_DEPLOY_ALLOWLIST` of Slack user ids gates the action. Unset ⇒ nobody can deploy.
- Every attempt is recorded in `deploys`, authorised or not.

Do not widen this surface. Anything beyond "dispatch an existing deploy workflow" — arbitrary
commands, config changes, database access — belongs somewhere with a real authorisation model.

## Architecture in one paragraph

Two public services (gateway, frontend) are probed directly. The five internal services sit on the
private `sentinel-net` Docker network, so they are read in a single call to the gateway's
token-protected `GET /internal/monitor/health` aggregate endpoint. Results go to Postgres; a pure
state machine (`lib/state.ts`) compares them with the previous state and returns transitions;
`lib/tick.ts` acts on those transitions (open/close incidents, post Slack messages). Vercel Cron on
Hobby cannot run every five minutes, so a GitHub Actions workflow in this repo is the scheduler.

Full detail: [`docs/01-architecture.md`](docs/01-architecture.md).

## Project layout

```
app/
├── page.tsx                  # dashboard overview
├── services/[id]/page.tsx    # per-service detail
├── incidents/page.tsx        # incident log
└── api/
    ├── status/               # public JSON snapshot
    ├── probe/                # one-shot live probe
    ├── slack/test/           # credential smoke test (CRON_SECRET)
    └── cron/{check,daily,weekly}/   # scheduled jobs (CRON_SECRET)
components/                   # brand mark, panels, charts, dashboard sections
lib/
├── services.ts               # the inventory — single source of truth for what is monitored
├── probe.ts                  # probe engine: retries, error normalization
├── state.ts                  # pure transition logic (no I/O — the testable core)
├── tick.ts                   # orchestration: probe → persist → decide → alert
├── slack.ts, messages.ts     # transport + Block Kit payloads
├── db.ts, schema.ts, repo.ts # Postgres access; schema is self-applying and idempotent
├── rollup.ts                 # uptime math + period reports
├── dashboard.ts              # everything the UI renders
├── format.ts, auth.ts        # shared formatting; CRON_SECRET guard
└── design/                   # colour + type tokens mirrored from sentinel-frontend
```

## Non-negotiable rules

- **Adding or changing a monitored service means editing `lib/services.ts` only.** Probe logic,
  alert copy and every dashboard panel read from it. Never hardcode a service id, port or health
  path anywhere else.
- **Every capability degrades honestly when unconfigured.** No `DATABASE_URL` ⇒ live-probe-only, not
  a crash. No `MONITOR_TOKEN` ⇒ internal services show "not monitored", never "up" and never a false
  alarm. Preserve this: a monitor that lies is worse than no monitor.
- **An alert is only considered delivered once Slack accepts it.** Never clear `alert_pending` /
  `recovery_pending` on a failed post.
- **Uptime is computed from incident spans, never from failed-check counts** — otherwise a missed
  scheduler tick becomes fake downtime.
- `/api/cron/*` and `/api/slack/test` must stay behind `CRON_SECRET`, failing closed when it is
  unset.
- **Never commit a secret.** All credentials live in Vercel env vars and GitHub Actions secrets.

## Design system

The UI mirrors sentinel-frontend so the monitor reads as the same product: the ink/porcelain/gold
palette, Archivo + IBM Plex Mono, and the Tessera mark. Tokens are copies in `lib/design/` (this app
is a separate deployment and does not import from the frontend). If sentinel-frontend's palette
changes, update `lib/design/colors.ts` to match.

## Common commands

```bash
npm run dev          # local dev server
npm run build        # production build — must pass before any task is done
npm run type-check   # tsc --noEmit
npm run probe        # zero-dependency one-shot checker, no app needed
```

## Conventions

### Commits
- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`,
  `build:`, `ci:` — optional scope, e.g. `fix(probe): retry on connection reset`.
- The message describes the change only. **Never** reference AI assistants, agents, or tooling, and
  never add `Co-Authored-By` or other attribution trailers.
- Commit logically-scoped units of work; do not push unless explicitly asked.

### Docs stay in sync (mandatory)
Every change updates its docs in the same commit: this file (and `AGENT.md`), the `README.md`, the
relevant `docs/0*.md`, and the central TODO board at `sentinel-core-api/master-doc/`
(`ops-sre-todo.md` for this repo, plus `platform-todo.md`). Tick `[ ]`→`[x]` — **never delete a
line**; append new TODOs for follow-ups discovered. Never leave docs describing behaviour the code
no longer has, and never claim an unbuilt capability as live.

### Workflow discipline — todo-first
**Every task goes on the todo list before any work starts, then gets marked done after** — feature,
fix, refactor or one-line chore. Add follow-up work as new items the moment you discover it, so the
list always reflects reality.

### Recommend before implementing
Do not assume a requested change is the best approach. Evaluate the underlying goal, state your
recommendation concisely (including where it differs from the literal ask), then implement the best
option. Confirm first only if it is a one-way door or materially changes scope.
