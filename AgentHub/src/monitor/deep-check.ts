import { createLogger } from "../logger";
import type { CronStore } from "../cron/store";

const log = createLogger("monitor:deep-check");

const DEEP_CHECK_JOB_NAME = "deep-health-check";
const DEEP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const DEEP_CHECK_TASK = [
  "Run a comprehensive system health check.",
  "Check all process heartbeats from the process_registry table.",
  "Analyze recent error logs from the last 6 hours.",
  "Check disk and memory usage.",
  "Review cron job statuses and recent failures.",
  "Check active alerts from the monitor_alerts table.",
  "Provide a full STATUS/FINDINGS/METRICS/ACTIONS report.",
].join(" ");

export async function ensureDeepHealthCheckJob(
  cronStore: CronStore,
  telegramChatId: string,
): Promise<void> {
  const jobs = await cronStore.listJobs();
  const existing = jobs.find((j) => j.name === DEEP_CHECK_JOB_NAME);

  if (existing) {
    log.info("Deep health check cron job already exists", { jobId: existing.id });
    return;
  }

  await cronStore.addJob({
    name: DEEP_CHECK_JOB_NAME,
    schedule: { kind: "every", everyMs: DEEP_CHECK_INTERVAL_MS },
    payload: {
      kind: "agentTurn",
      message: DEEP_CHECK_TASK,
      agentId: "monitor",
    },
    delivery: {
      mode: "announce",
      channel: "telegram",
      chatId: telegramChatId,
    },
    enabled: true,
  });

  log.info("Created deep health check cron job (every 6h)");
}
