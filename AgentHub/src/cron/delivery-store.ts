import { getDb } from "../store/db";
import type { CronDelivery } from "../process/types";

export interface DeliveryStore {
  enqueue(delivery: {
    readonly channel: string;
    readonly chatId: string;
    readonly jobName: string;
    readonly text: string;
    readonly preformatted: boolean;
  }): Promise<string>;

  getPending(channel: string): Promise<readonly CronDelivery[]>;

  markDelivered(id: string): Promise<void>;
}

export function createDeliveryStore(): DeliveryStore {
  return {
    async enqueue(delivery): Promise<string> {
      const db = getDb();
      const id = crypto.randomUUID();

      await db`
        INSERT INTO cron_deliveries (id, channel, chat_id, job_name, text, preformatted)
        VALUES (
          ${id},
          ${delivery.channel},
          ${delivery.chatId},
          ${delivery.jobName},
          ${delivery.text},
          ${delivery.preformatted}
        )
      `;

      return id;
    },

    async getPending(channel: string): Promise<readonly CronDelivery[]> {
      const db = getDb();
      const rows = await db`
        SELECT * FROM cron_deliveries
        WHERE channel = ${channel} AND delivered_at IS NULL
        ORDER BY created_at ASC
      `;

      return rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        channel: r.channel as string,
        chatId: r.chat_id as string,
        jobName: r.job_name as string,
        text: r.text as string,
        preformatted: Boolean(r.preformatted),
        createdAt: Number(r.created_at),
        deliveredAt: null,
      }));
    },

    async markDelivered(id: string): Promise<void> {
      const db = getDb();
      const now = Math.floor(Date.now() / 1000);

      await db`
        UPDATE cron_deliveries
        SET delivered_at = ${now}
        WHERE id = ${id}
      `;
    },
  };
}
