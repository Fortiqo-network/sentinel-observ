import { probeAll, type CheckResult } from "./probe";
import { hasDatabase } from "./db";
import { ensureSchema } from "./schema";
import {
  clearRecoveryPending,
  closeIncident,
  getIncident,
  getOpenIncidents,
  getPendingAlertIncidents,
  getServiceStates,
  openIncident,
  recordChecks,
  recordRun,
  setIncidentSlackTs,
  setReminderSent,
  touchDownIncident,
  touchUpState,
  type IncidentRow,
} from "./repo";
import { classify, detectStorm } from "./state";
import {
  downMessage,
  recoveryMessage,
  reminderMessage,
  serviceForAlert,
  stormMessage,
} from "./messages";
import { isSlackConfigured, postAlarm } from "./slack";

/**
 * One monitoring tick: probe → persist → decide → alert.
 *
 * The order matters. Checks are written before any alert is attempted, so a
 * Slack outage can never lose the underlying history, and every alert that
 * fails to send stays flagged `alert_pending` for the next tick to retry.
 */

export type TickSummary = {
  checkedAt: string;
  durationMs: number;
  up: number;
  total: number;
  services: CheckResult[];
  persisted: boolean;
  alertsSent: number;
  alertErrors: string[];
  transitions: Array<{ service: string; kind: string }>;
};

function syntheticResult(incident: IncidentRow, ok: boolean): CheckResult {
  return {
    id: incident.service_id,
    name: serviceForAlert(incident.service_id).name,
    ok,
    status: null,
    latencyMs: null,
    error: ok ? null : incident.error,
    attempts: 0,
    unknown: false,
  };
}

/**
 * Send the 🔴 alert for a freshly opened incident.
 *
 * `alert_pending` is only cleared once Slack has accepted the message, so a
 * failed delivery is retried by the next tick rather than lost.
 */
async function sendIncidentAlert(
  incident: IncidentRow,
  result: CheckResult,
  lastSeenUp: Date | null,
): Promise<boolean> {
  const posted = await postAlarm(
    downMessage({
      service: serviceForAlert(incident.service_id),
      result,
      startedAt: incident.started_at,
      lastSeenUp,
    }),
  );
  if (!posted.ok) return false;
  await setIncidentSlackTs(incident.id, posted.ts);
  return true;
}

/**
 * Re-send alerts and recoveries that a previous tick could not deliver.
 *
 * Storm incidents are re-sent as one combined message, so a Slack outage during
 * a platform-wide failure does not turn into a burst of individual alerts on
 * the next tick.
 */
async function flushPendingAlerts(results: Map<string, CheckResult>): Promise<{
  sent: number;
  errors: string[];
}> {
  const pending = await getPendingAlertIncidents();
  let sent = 0;
  const errors: string[] = [];

  const stormBacklog = pending.filter((i) => i.alert_pending && !i.ended_at && i.is_storm);
  if (stormBacklog.length > 0) {
    const posted = await postAlarm(
      stormMessage({
        downServices: stormBacklog.map((i) => i.service_id),
        upServices: [...results.values()].filter((r) => r.ok && !r.unknown).map((r) => r.id),
        startedAt: stormBacklog[0].started_at,
        reason: stormBacklog[0].error ?? "gateway unreachable",
      }),
    );
    for (const incident of stormBacklog) {
      if (posted.ok) await setIncidentSlackTs(incident.id, posted.ts);
    }
    if (posted.ok) sent += 1;
    else errors.push(`retry storm alert: ${posted.error}`);
  }

  for (const incident of pending) {
    if (incident.is_storm && incident.alert_pending && !incident.ended_at) continue;
    const service = serviceForAlert(incident.service_id);
    const result = results.get(incident.service_id);

    if (incident.alert_pending && !incident.ended_at) {
      const posted = await postAlarm(
        downMessage({
          service,
          result: result ?? syntheticResult(incident, false),
          startedAt: incident.started_at,
          lastSeenUp: null,
        }),
      );
      if (posted.ok) {
        await setIncidentSlackTs(incident.id, posted.ts);
        sent += 1;
      } else {
        errors.push(`retry down alert ${incident.service_id}: ${posted.error}`);
      }
      continue;
    }

    if (incident.recovery_pending && incident.ended_at) {
      const posted = await postAlarm({
        ...recoveryMessage({
          service,
          incident,
          result: result ?? syntheticResult(incident, true),
          endedAt: incident.ended_at,
        }),
        threadTs: incident.slack_ts,
      });
      if (posted.ok) {
        await clearRecoveryPending(incident.id);
        sent += 1;
      } else {
        errors.push(`retry recovery ${incident.service_id}: ${posted.error}`);
      }
    }
  }

  return { sent, errors };
}

/**
 * Run a full monitoring tick.
 *
 * Without `DATABASE_URL` this degrades to a stateless probe: results are
 * returned and the dashboard still works, but nothing is persisted and no
 * transition can be detected, so no alert fires. That keeps the very first
 * deploy useful before the database exists.
 */
export async function runCheckTick(): Promise<TickSummary> {
  const startedAt = Date.now();
  const now = new Date();
  const results = await probeAll();
  const up = results.filter((r) => r.ok).length;

  const summary: TickSummary = {
    checkedAt: now.toISOString(),
    durationMs: 0,
    up,
    total: results.length,
    services: results,
    persisted: false,
    alertsSent: 0,
    alertErrors: [],
    transitions: [],
  };

  if (!hasDatabase()) {
    summary.durationMs = Date.now() - startedAt;
    summary.alertErrors.push("DATABASE_URL not set — history and alerting are disabled");
    return summary;
  }

  await ensureSchema();
  await recordChecks(results, now);
  summary.persisted = true;

  const [states, openBefore] = await Promise.all([getServiceStates(), getOpenIncidents()]);
  const openByService = new Map(openBefore.map((i) => [i.service_id, i]));

  const transitions = classify({
    results,
    states,
    incidentStartedAt: new Map([...openByService].map(([id, i]) => [id, i.started_at])),
    lastRemindAt: new Map([...openByService].map(([id, i]) => [id, i.last_remind_at])),
    now,
  });
  summary.transitions = transitions.map((t) => ({ service: t.serviceId, kind: t.kind }));

  const resultsById = new Map(results.map((r) => [r.id, r]));
  const lastSeenUp = new Map(
    [...states].filter(([, s]) => s.status === "up").map(([id, s]) => [id, s.last_check_at]),
  );
  const newlyDown = transitions.filter((t) => t.kind === "went_down").map((t) => t.serviceId);
  const stormServices = detectStorm(newlyDown);
  const isStorm = stormServices !== null;
  const slackReady = isSlackConfigured();

  const openedIncidents: IncidentRow[] = [];

  for (const transition of transitions) {
    const result = resultsById.get(transition.serviceId)!;

    switch (transition.kind) {
      case "baseline": {
        if (transition.ok) {
          await touchUpState(transition.serviceId, now);
        } else {
          const id = await openIncident({
            serviceId: transition.serviceId,
            startedAt: now,
            error: result.error,
            isStorm: false,
          });
          await setIncidentSlackTs(id, null);
        }
        break;
      }

      case "still_up":
      case "muted":
        await touchUpState(transition.serviceId, now);
        break;

      case "went_down": {
        const id = await openIncident({
          serviceId: transition.serviceId,
          startedAt: now,
          error: result.error,
          isStorm,
        });
        const incident = await getIncident(id);
        if (incident) openedIncidents.push(incident);
        break;
      }

      case "still_down": {
        const incident = openByService.get(transition.serviceId);
        if (!incident) break;
        await touchDownIncident({
          incidentId: incident.id,
          serviceId: transition.serviceId,
          checkedAt: now,
        });
        if (transition.remind && slackReady) {
          const posted = await postAlarm({
            ...reminderMessage({
              service: serviceForAlert(transition.serviceId),
              incident: { ...incident, failed_checks: incident.failed_checks + 1 },
              now,
            }),
            threadTs: incident.slack_ts,
          });
          if (posted.ok) {
            await setReminderSent(incident.id, now);
            summary.alertsSent += 1;
          } else {
            summary.alertErrors.push(`reminder ${transition.serviceId}: ${posted.error}`);
          }
        }
        break;
      }

      case "recovered": {
        const incident = openByService.get(transition.serviceId);
        if (!incident) {
          await touchUpState(transition.serviceId, now);
          break;
        }
        await closeIncident({
          incidentId: incident.id,
          serviceId: transition.serviceId,
          endedAt: now,
        });
        if (slackReady) {
          const posted = await postAlarm({
            ...recoveryMessage({
              service: serviceForAlert(transition.serviceId),
              incident,
              result,
              endedAt: now,
            }),
            threadTs: incident.slack_ts,
          });
          if (posted.ok) {
            await clearRecoveryPending(incident.id);
            summary.alertsSent += 1;
          } else {
            summary.alertErrors.push(`recovery ${transition.serviceId}: ${posted.error}`);
          }
        }
        break;
      }
    }
  }

  if (slackReady && openedIncidents.length > 0) {
    if (isStorm) {
      const stillUp = results.filter((r) => r.ok && !r.unknown).map((r) => r.id);
      const posted = await postAlarm(
        stormMessage({
          downServices: stormServices,
          upServices: stillUp,
          startedAt: now,
          reason: resultsById.get("gateway")?.error ?? "gateway unreachable",
        }),
      );
      if (posted.ok) {
        for (const incident of openedIncidents) {
          await setIncidentSlackTs(incident.id, posted.ts);
        }
        summary.alertsSent += 1;
      } else {
        summary.alertErrors.push(`storm alert: ${posted.error}`);
      }
    } else {
      for (const incident of openedIncidents) {
        const result = resultsById.get(incident.service_id);
        if (!result) continue;
        const ok = await sendIncidentAlert(
          incident,
          result,
          lastSeenUp.get(incident.service_id) ?? null,
        );
        if (ok) summary.alertsSent += 1;
        else summary.alertErrors.push(`down alert ${incident.service_id}: delivery failed`);
      }
    }
  }

  if (slackReady) {
    const flushed = await flushPendingAlerts(resultsById);
    summary.alertsSent += flushed.sent;
    summary.alertErrors.push(...flushed.errors);
  }

  summary.durationMs = Date.now() - startedAt;

  await recordRun({
    kind: "check",
    durationMs: summary.durationMs,
    servicesUp: up,
    servicesTotal: results.length,
    alertsSent: summary.alertsSent,
    error: summary.alertErrors.length ? summary.alertErrors.join("; ").slice(0, 500) : null,
  });

  return summary;
}
