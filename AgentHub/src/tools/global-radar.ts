import type { ToolDefinition } from "./types";
import { getDb } from "../store/db";

function asPositiveInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? Math.floor(value) : Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : fallback;
}

export function createGlobalRadarTool(): ToolDefinition {
  return {
    name: "global_radar_query",
    description:
      "Read-only query over the unified social monitoring radar. Use it to answer questions about latest events, platform evidence, propagation paths, public KAN deliveries, private conversations, and monitor health. Never invent facts; state when data is missing.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["overview", "events", "health", "deliveries"] },
        query: { type: "string", description: "Optional event title, event key, platform, or keyword." },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
    },
    categories: ["social", "analytics", "memory"],
    async execute(input) {
      const db = getDb();
      const mode = typeof input.mode === "string" ? input.mode : "overview";
      const query = typeof input.query === "string" ? input.query.trim() : "";
      const limit = asPositiveInt(input.limit, 10, 30);
      try {
        if (mode === "health") {
          const rows = await db.unsafe(
            `SELECT platform, status, COUNT(*)::int AS count, MAX(observed_at)::bigint AS latest_observed_at
             FROM social_platform_reports GROUP BY platform, status ORDER BY platform, status`,
          );
          return { output: JSON.stringify({ mode, reports: rows }, null, 2), isError: false };
        }
        if (mode === "deliveries") {
          const rows = await db.unsafe(
            `SELECT destination_type, destination_id, user_id, message_id, status, error, created_at
             FROM kan_deliveries ORDER BY created_at DESC LIMIT ${limit}`,
          );
          return { output: JSON.stringify({ mode, deliveries: rows }, null, 2), isError: false };
        }
        if (mode === "events" || mode === "overview") {
          const where = query
            ? `WHERE (event_key ILIKE '%${query.replace(/'/g, "''")}%' OR title ILIKE '%${query.replace(/'/g, "''")}%')`
            : "";
          const rows = await db.unsafe(
            `SELECT id, event_key, title, impact_level, trend, status, rendered_text, created_at, updated_at
             FROM social_fused_events ${where} ORDER BY updated_at DESC LIMIT ${limit}`,
          );
          const evidence = await db.unsafe(
            `SELECT event_key, platform, title, status, observed_at FROM social_platform_reports
             ORDER BY observed_at DESC LIMIT ${limit * 3}`,
          );
          const paths = await db.unsafe(
            `SELECT fused_event_id, from_node, to_node, edge_type, platform, weight
             FROM social_event_edges ORDER BY created_at DESC LIMIT ${limit * 3}`,
          );
          return {
            output: JSON.stringify({ mode, events: rows, evidence, propagation_paths: paths }, null, 2),
            isError: false,
          };
        }
        return { output: `Unsupported mode: ${mode}`, isError: true, errorCode: "INVALID_INPUT" };
      } catch (error) {
        return { output: `Radar query failed: ${error instanceof Error ? error.message : String(error)}`, isError: true, errorCode: "INTERNAL" };
      }
    },
  };
}
