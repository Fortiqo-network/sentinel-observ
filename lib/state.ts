import type { CheckResult } from "./probe";
import type { ServiceStateRow } from "./repo";
import { secondsBetween } from "./format";

/**
 * Alert state machine (docs/04-monitoring-spec.md).
 *
 * Pure decision logic: it takes this tick's probe results plus the previous
 * state from the database and returns what should happen. Nothing here does
 * I/O, so the transition rules can be reasoned about (and tested) on their own.
 *
 * Everything is keyed on *transitions*, which makes a tick idempotent: a
 * double-fired or late cron run re-evaluates the same states and produces no
 * duplicate alerts.
 */

export type Transition =
  | { kind: "baseline"; serviceId: string; ok: boolean; result: CheckResult }
  | { kind: "still_up"; serviceId: string; result: CheckResult }
  | { kind: "went_down"; serviceId: string; result: CheckResult }
  | { kind: "still_down"; serviceId: string; result: CheckResult; remind: boolean }
  | { kind: "recovered"; serviceId: string; result: CheckResult }
  | { kind: "muted"; serviceId: string; result: CheckResult };

/** First reminder after 30 minutes down, then one per hour. */
const FIRST_REMINDER_SECS = 30 * 60;
const REPEAT_REMINDER_SECS = 60 * 60;

/**
 * Decide whether an ongoing outage deserves another "still down" nudge.
 * Returns false while the incident is young or a reminder was sent recently.
 */
export function shouldRemind(params: {
  startedAt: Date;
  lastRemindAt: Date | null;
  now: Date;
}): boolean {
  const downFor = secondsBetween(params.startedAt, params.now);
  if (downFor < FIRST_REMINDER_SECS) return false;
  if (!params.lastRemindAt) return true;
  return secondsBetween(params.lastRemindAt, params.now) >= REPEAT_REMINDER_SECS;
}

/**
 * Classify every probe result against the last known state.
 *
 * Results flagged `unknown` (the gateway aggregate endpoint is not configured
 * yet) are skipped entirely — an unconfigured monitor must never page anyone.
 */
export function classify(params: {
  results: CheckResult[];
  states: Map<string, ServiceStateRow>;
  incidentStartedAt: Map<string, Date>;
  lastRemindAt: Map<string, Date | null>;
  now: Date;
}): Transition[] {
  const transitions: Transition[] = [];

  for (const result of params.results) {
    if (result.unknown) continue;

    const state = params.states.get(result.id);

    if (!state) {
      transitions.push({
        kind: "baseline",
        serviceId: result.id,
        ok: result.ok,
        result,
      });
      continue;
    }

    if (state.status === "maintenance") {
      transitions.push({ kind: "muted", serviceId: result.id, result });
      continue;
    }

    if (state.status === "up") {
      transitions.push(
        result.ok
          ? { kind: "still_up", serviceId: result.id, result }
          : { kind: "went_down", serviceId: result.id, result },
      );
      continue;
    }

    if (result.ok) {
      transitions.push({ kind: "recovered", serviceId: result.id, result });
    } else {
      const startedAt = params.incidentStartedAt.get(result.id) ?? state.since;
      transitions.push({
        kind: "still_down",
        serviceId: result.id,
        result,
        remind: shouldRemind({
          startedAt,
          lastRemindAt: params.lastRemindAt.get(result.id) ?? null,
          now: params.now,
        }),
      });
    }
  }

  return transitions;
}

/**
 * Detect a correlated platform outage.
 *
 * Every backend runs on one machine, so the gateway going down together with
 * two or more internal services means the box, Docker, or the tunnel died — one
 * root cause. Returns the service ids to collapse into a single alert, or null
 * when the failures should be reported individually.
 */
export function detectStorm(newlyDown: string[]): string[] | null {
  if (!newlyDown.includes("gateway")) return null;
  const internal = newlyDown.filter((id) => id !== "gateway" && id !== "frontend");
  if (internal.length < 2) return null;
  return newlyDown;
}
