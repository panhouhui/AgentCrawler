import type { Channel } from "../channels/types";
import type { DeliveryStore } from "./delivery-store";
import { createLogger } from "../logger";

const log = createLogger("cron:delivery-poller");

const DEFAULT_POLL_INTERVAL_MS = 10_000;

export interface DeliveryPoller {
  start(): void;
  stop(): void;
}

export function createDeliveryPoller(
  channelName: string,
  channel: Channel,
  store: DeliveryStore,
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): DeliveryPoller {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function poll(): Promise<void> {
    try {
      if (!channel.isConnected()) return;

      const pending = await store.getPending(channelName);
      if (pending.length === 0) return;

      for (const delivery of pending) {
        try {
          const truncated =
            delivery.text.length > 3000
              ? delivery.text.slice(0, 3000) + "\n\n[Truncated]"
              : delivery.text;

          const message = delivery.preformatted
            ? truncated
            : `[Cron: ${delivery.jobName}]\n\n${truncated}`;

          await channel.sendMessage(delivery.chatId, { text: message });
          await store.markDelivered(delivery.id);

          log.info("Delivered cron result", {
            channel: channelName,
            chatId: delivery.chatId,
            jobName: delivery.jobName,
          });
        } catch (err) {
          log.error("Failed to deliver cron result", {
            channel: channelName,
            deliveryId: delivery.id,
            error: err,
          });
        }
      }
    } catch (err) {
      log.error("Delivery poll failed", { channel: channelName, error: err });
    }
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(poll, pollIntervalMs);
      log.info("Delivery poller started", {
        channel: channelName,
        pollIntervalMs,
      });
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
