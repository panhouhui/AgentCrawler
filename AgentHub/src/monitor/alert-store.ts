import { getDb } from "../store/db";
import type { CheckCategory, FiredAlert } from "./types";

export interface AlertStore {
  recordAlert(alert: Omit<FiredAlert, "id">): Promise<string>;
  resolveAlert(category: CheckCategory, title: string): Promise<void>;
  getRecentAlerts(limit?: number): Promise<readonly FiredAlert[]>;
  getActiveAlerts(): Promise<readonly FiredAlert[]>;
}

export function createAlertStore(): AlertStore {
  return {
    async recordAlert(alert): Promise<string> {
      const db = getDb();
      const id = crypto.randomUUID();
      await db`
        INSERT INTO monitor_alerts (id, category, level, title, detail, metric, threshold, fired_at)
        VALUES (${id}, ${alert.category}, ${alert.level}, ${alert.title},
                ${alert.detail}, ${alert.metric}, ${alert.threshold}, ${alert.firedAt})
      `;
      return id;
    },

    async resolveAlert(category, title): Promise<void> {
      const db = getDb();
      const now = Math.floor(Date.now() / 1000);
      await db`
        UPDATE monitor_alerts
        SET resolved_at = ${now}
        WHERE category = ${category} AND title = ${title} AND resolved_at IS NULL
      `;
    },

    async getRecentAlerts(limit = 50): Promise<readonly FiredAlert[]> {
      const db = getDb();
      const rows = await db`
        SELECT * FROM monitor_alerts ORDER BY fired_at DESC LIMIT ${limit}
      `;
      return rows.map(rowToAlert);
    },

    async getActiveAlerts(): Promise<readonly FiredAlert[]> {
      const db = getDb();
      const rows = await db`
        SELECT * FROM monitor_alerts
        WHERE resolved_at IS NULL
        ORDER BY fired_at DESC
      `;
      return rows.map(rowToAlert);
    },
  };
}

function rowToAlert(row: Record<string, unknown>): FiredAlert {
  return {
    id: row.id as string,
    category: row.category as CheckCategory,
    level: row.level as FiredAlert["level"],
    title: row.title as string,
    detail: row.detail as string,
    metric: row.metric != null ? Number(row.metric) : null,
    threshold: row.threshold != null ? Number(row.threshold) : null,
    firedAt: Number(row.fired_at),
    resolvedAt: row.resolved_at != null ? Number(row.resolved_at) : null,
  };
}
