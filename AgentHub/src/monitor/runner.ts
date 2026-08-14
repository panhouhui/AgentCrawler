import { createLogger } from "../logger";
import type { DeliveryStore } from "../cron/delivery-store";
import type { AlertStore } from "./alert-store";
import { runAllChecks } from "./checks";
import { createAlertDeduplicator, dedupKey } from "./dedup";
import { formatBatchAlert, formatResolvedMessage } from "./formatter";
import type { CheckCategory, CheckResult, MonitorConfig } from "./types";

const log = createLogger("monitor");

export interface MonitorRunner {
  start(): void;
  stop(): void;
}

export interface MonitorRunnerDeps {
  readonly config: MonitorConfig;
  readonly deliveryStore: DeliveryStore;
  readonly alertStore: AlertStore;
  readonly telegramChatId: string;
}

export function createMonitorRunner(deps: MonitorRunnerDeps): MonitorRunner {
  const { config, deliveryStore, alertStore, telegramChatId } = deps;
  const dedup = createAlertDeduplicator(config.alertCooldownMs);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runChecks(): Promise<void> {
    try {
      const results = await runAllChecks(config.thresholds);
      const currentKeys = new Set(
        results.map((r) => dedupKey(r.category, r.title)),
      );

      await handleResolved(currentKeys);
      await handleNewAlerts(results);

      dedup.cleanup();
    } catch (err) {
      log.error("Monitor check cycle failed", { error: err });
    }
  }

  async function handleResolved(
    currentKeys: ReadonlySet<string>,
  ): Promise<void> {
    const previousKeys = dedup.getActiveKeys();
    for (const key of previousKeys) {
      if (!currentKeys.has(key)) {
        const [category, ...titleParts] = key.split(":");
        const title = titleParts.join(":");
        dedup.markResolved(key);
        await alertStore.resolveAlert(category as CheckCategory, title);
        await enqueueMessage(formatResolvedMessage(category as CheckCategory, title));
        log.info("Alert resolved", { key });
      }
    }
  }

  async function handleNewAlerts(
    results: readonly CheckResult[],
  ): Promise<void> {
    const toFire = results.filter((r) => {
      const key = dedupKey(r.category, r.title);
      return dedup.shouldFire(key, r.level);
    });

    if (toFire.length === 0) return;

    const message = formatBatchAlert(toFire);
    await enqueueMessage(message);

    for (const result of toFire) {
      const key = dedupKey(result.category, result.title);
      dedup.markFired(key, result.level);
      await alertStore.recordAlert({
        category: result.category,
        level: result.level,
        title: result.title,
        detail: result.detail,
        metric: result.metric ?? null,
        threshold: result.threshold ?? null,
        firedAt: Math.floor(Date.now() / 1000),
        resolvedAt: null,
      });
      log.info("Alert fired", { key, level: result.level });
    }
  }

  async function enqueueMessage(text: string): Promise<void> {
    await deliveryStore.enqueue({
      channel: "telegram",
      chatId: telegramChatId,
      jobName: "monitor",
      text,
      preformatted: true,
    });
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(runChecks, config.checkIntervalMs);
      // Run immediately on start
      runChecks().catch((err) => {
        log.error("Initial monitor check failed", { error: err });
      });
      log.info("Monitor started", {
        intervalMs: config.checkIntervalMs,
        cooldownMs: config.alertCooldownMs,
      });
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      log.info("Monitor stopped");
    },
  };
}
