import { getDb } from "../store/db";
import { createLogger } from "../logger";
import type { CronStore } from "../cron/store";
import { createAlertStore } from "./alert-store";

const log = createLogger("monitor:hooks-health");

const HOOKS_HEALTH_CHECK_JOB_NAME = "hooks-health-check";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const HOOKS_HEALTH_TASK = [
  "Run a hooks-based health analysis.",
  "Check tool error rates from tool_audit_log (alert if >10% in last hour).",
  "Check subagent failure rates from subagent_audit_log (alert if >25% failures).",
  "Check for long-running sessions (>2 hours without completion).",
  "Check for spikes in user prompt activity (unusual patterns).",
  "Compare current metrics against baseline from previous 24h.",
  "Report findings with specific metrics and recommendations.",
].join(" ");

interface HealthMetrics {
  toolErrorRate: number;
  toolTotalCalls: number;
  toolErrors: number;
  subagentFailureRate: number;
  subagentTotalSpawns: number;
  subagentFailures: number;
  longRunningSessions: number;
  processErrors: number;
}

export async function checkHooksHealth(): Promise<{
  healthy: boolean;
  alerts: string[];
  metrics: HealthMetrics;
}> {
  const db = getDb();
  const alerts: string[] = [];
  const now = Date.now();

  // Date objects for TIMESTAMPTZ columns (tool_audit_log, subagent_audit_log, session_history)
  const oneHourAgoDate = new Date(now - 3600 * 1000);
  const twentyFourHoursAgoDate = new Date(now - 86400 * 1000);

  // Integer epochs for INTEGER columns (process_logs)
  const oneHourAgoEpoch = Math.floor(now / 1000) - 3600;
  const twentyFourHoursAgoEpoch = Math.floor(now / 1000) - 86400;

  // Tool error rate (last hour) — tool_audit_log.created_at is TIMESTAMPTZ
  const toolStats = await db`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN is_error THEN 1 ELSE 0 END) as errors
    FROM tool_audit_log
    WHERE created_at >= ${oneHourAgoDate}
  ` as { total: bigint; errors: bigint }[];

  const toolTotalCalls = Number(toolStats[0]?.total || 0);
  const toolErrors = Number(toolStats[0]?.errors || 0);
  const toolErrorRate = toolTotalCalls > 0 ? (toolErrors / toolTotalCalls) * 100 : 0;

  if (toolErrorRate > 10) {
    alerts.push(`HIGH TOOL ERROR RATE: ${toolErrorRate.toFixed(1)}% (${toolErrors}/${toolTotalCalls} calls)`);
  }

  // Subagent failure rate (last hour) — subagent_audit_log.created_at is TIMESTAMPTZ
  const subagentStats = await db`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status IN ('error', 'timeout') THEN 1 ELSE 0 END) as failures
    FROM subagent_audit_log
    WHERE created_at >= ${oneHourAgoDate}
  ` as { total: bigint; failures: bigint }[];

  const subagentTotalSpawns = Number(subagentStats[0]?.total || 0);
  const subagentFailures = Number(subagentStats[0]?.failures || 0);
  const subagentFailureRate = subagentTotalSpawns > 0 ? (subagentFailures / subagentTotalSpawns) * 100 : 0;

  if (subagentFailureRate > 25) {
    alerts.push(`HIGH SUBAGENT FAILURE RATE: ${subagentFailureRate.toFixed(1)}% (${subagentFailures}/${subagentTotalSpawns} spawns)`);
  }

  // Long-running sessions — session_history.created_at is TIMESTAMPTZ
  const twoHoursAgoDate = new Date(now - 7200 * 1000);
  const longRunningSessions = await db`
    SELECT COUNT(*) as count
    FROM session_history
    WHERE created_at >= ${twoHoursAgoDate}
      AND created_at < ${oneHourAgoDate}
      AND updated_at = created_at
  ` as { count: bigint }[];

  const longRunningCount = Number(longRunningSessions[0]?.count || 0);
  if (longRunningCount > 5) {
    alerts.push(`STALLED SESSIONS DETECTED: ${longRunningCount} sessions running >1 hour without update`);
  }

  // Process errors spike — process_logs.created_at is INTEGER
  const recentProcessErrors = await db`
    SELECT COUNT(*) as count
    FROM process_logs
    WHERE created_at >= ${oneHourAgoEpoch} AND level = 'error'
  ` as { count: bigint }[];

  const avgProcessErrors = await db`
    SELECT COUNT(*) as count
    FROM process_logs
    WHERE created_at >= ${twentyFourHoursAgoEpoch} AND level = 'error'
  ` as { count: bigint }[];

  const processErrors = Number(recentProcessErrors[0]?.count || 0);
  const totalProcessErrors = Number(avgProcessErrors[0]?.count || 0);
  const hourlyAverage = totalProcessErrors / 24;

  if (processErrors > hourlyAverage * 3 && processErrors > 10) {
    alerts.push(`PROCESS ERROR SPIKE: ${processErrors} errors/hour vs ${hourlyAverage.toFixed(1)} average`);
  }

  // Activity drop — session_history.created_at is TIMESTAMPTZ
  const recentSessions = await db`
    SELECT COUNT(*) as count
    FROM session_history
    WHERE created_at >= ${oneHourAgoDate}
  ` as { count: bigint }[];

  const prevSessions = await db`
    SELECT COUNT(*) as count
    FROM session_history
    WHERE created_at >= ${twentyFourHoursAgoDate}
      AND created_at < ${oneHourAgoDate}
  ` as { count: bigint }[];

  const recentSessionCount = Number(recentSessions[0]?.count || 0);
  const prevSessionCount = Number(prevSessions[0]?.count || 0);
  const hourlyAvg = prevSessionCount / 23;

  if (recentSessionCount === 0 && hourlyAvg > 2) {
    alerts.push(`ACTIVITY DROP: No sessions in last hour vs ${hourlyAvg.toFixed(1)}/hour average`);
  }

  return {
    healthy: alerts.length === 0,
    alerts,
    metrics: {
      toolErrorRate,
      toolTotalCalls,
      toolErrors,
      subagentFailureRate,
      subagentTotalSpawns,
      subagentFailures,
      longRunningSessions: longRunningCount,
      processErrors,
    },
  };
}

export async function ensureHooksHealthCheckJob(
  cronStore: CronStore,
  telegramChatId: string,
): Promise<void> {
  const jobs = await cronStore.listJobs();
  const existing = jobs.find((j) => j.name === HOOKS_HEALTH_CHECK_JOB_NAME);

  if (existing) {
    log.info("Hooks health check cron job already exists", { jobId: existing.id });
    return;
  }

  await cronStore.addJob({
    name: HOOKS_HEALTH_CHECK_JOB_NAME,
    schedule: { kind: "every", everyMs: CHECK_INTERVAL_MS },
    payload: {
      kind: "agentTurn",
      message: HOOKS_HEALTH_TASK,
      agentId: "monitor",
    },
    delivery: {
      mode: "announce",
      channel: "telegram",
      chatId: telegramChatId,
    },
    enabled: true,
  });

  log.info("Created hooks health check cron job (every 30m)");
}

export async function runHooksHealthCheck(): Promise<void> {
  try {
    const result = await checkHooksHealth();
    const alertStore = createAlertStore();

    if (!result.healthy) {
      for (const alertText of result.alerts) {
        const category = alertText.includes("TOOL ERROR") ? "error_rate"
          : alertText.includes("SUBAGENT") ? "process"
          : alertText.includes("SESSION") ? "process"
          : "error_rate";

        await alertStore.recordAlert({
          category,
          level: "critical",
          title: "Hooks Health Alert",
          detail: alertText,
          metric: null,
          threshold: null,
          firedAt: Math.floor(Date.now() / 1000),
          resolvedAt: null,
        });
      }

      log.warn("Hooks health check detected issues", { alerts: result.alerts });
    } else {
      log.info("Hooks health check passed", { metrics: result.metrics });
    }
  } catch (error) {
    log.error("Hooks health check failed", { error });
  }
}
