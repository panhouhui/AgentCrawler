import { getDb } from "./db";
import type { FusedSocialEvent, PlatformReport } from "../pipelines/social/schemas";

export interface SocialPlatformReportRecord {
  readonly id: string;
  readonly eventKey: string;
  readonly platform: string;
  readonly agentId: string;
  readonly title: string;
  readonly renderedText: string;
  readonly report: PlatformReport;
  readonly status: string;
  readonly observedAt: number;
  readonly createdAt: number;
}

export interface SocialEventEdgeInput {
  readonly id: string;
  readonly fusedEventId: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly edgeType: string;
  readonly platform?: string;
  readonly weight?: number;
  readonly evidence?: readonly string[];
}

interface SocialPlatformReportRow {
  id: string;
  event_key: string;
  platform: string;
  agent_id: string;
  title: string;
  rendered_text: string;
  report_json: string;
  status: string;
  observed_at: number;
  created_at: number;
}

function rowToPlatformReport(row: SocialPlatformReportRow): SocialPlatformReportRecord {
  return {
    id: row.id,
    eventKey: row.event_key,
    platform: row.platform,
    agentId: row.agent_id,
    title: row.title,
    renderedText: row.rendered_text,
    report: JSON.parse(row.report_json) as PlatformReport,
    status: row.status,
    observedAt: row.observed_at,
    createdAt: row.created_at,
  };
}

export async function saveSocialPlatformReport(input: {
  readonly id: string;
  readonly agentId: string;
  readonly report: PlatformReport;
  readonly renderedText: string;
  readonly status?: string;
  readonly createdAt?: number;
}): Promise<void> {
  const now = input.createdAt ?? Math.floor(Date.now() / 1000);
  const db = getDb();
  await db`
    INSERT INTO social_platform_reports
      (id, event_key, platform, agent_id, title, rendered_text, report_json, china_relevance_json, status, observed_at, created_at)
    VALUES
      (${input.id}, ${input.report.event_key}, ${input.report.platform}, ${input.agentId}, ${input.report.event_title}, ${input.renderedText}, ${JSON.stringify(input.report)}, ${JSON.stringify(input.report.china_relevance)}, ${input.status ?? "reported"}, ${input.report.observed_at}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      rendered_text = EXCLUDED.rendered_text,
      report_json = EXCLUDED.report_json,
      china_relevance_json = EXCLUDED.china_relevance_json,
      status = EXCLUDED.status
  `;
}

export async function getSocialPlatformReports(eventKey: string): Promise<readonly SocialPlatformReportRecord[]> {
  const db = getDb();
  const rows = await db`
    SELECT * FROM social_platform_reports
    WHERE event_key = ${eventKey}
    ORDER BY observed_at DESC
  `;
  return (rows as SocialPlatformReportRow[]).map(rowToPlatformReport);
}

export async function upsertSocialFusedEvent(input: {
  readonly id: string;
  readonly event: FusedSocialEvent;
  readonly renderedText: string;
  readonly now?: number;
}): Promise<void> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const db = getDb();
  await db`
    INSERT INTO social_fused_events
      (id, event_key, title, impact_level, trend, status, rendered_text, event_json, created_at, updated_at)
    VALUES
      (${input.id}, ${input.event.event_key}, ${input.event.event_title}, ${input.event.impact_level}, ${input.event.trend}, 'active', ${input.renderedText}, ${JSON.stringify(input.event)}, ${now}, ${now})
    ON CONFLICT (event_key) DO UPDATE SET
      title = EXCLUDED.title,
      impact_level = EXCLUDED.impact_level,
      trend = EXCLUDED.trend,
      rendered_text = EXCLUDED.rendered_text,
      event_json = EXCLUDED.event_json,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function replaceSocialEventEdges(
  fusedEventId: string,
  edges: readonly SocialEventEdgeInput[],
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.begin(async (tx) => {
    await tx`DELETE FROM social_event_edges WHERE fused_event_id = ${fusedEventId}`;
    for (const edge of edges) {
      await tx`
        INSERT INTO social_event_edges
          (id, fused_event_id, from_node, to_node, edge_type, platform, weight, evidence_json, created_at)
        VALUES
          (${edge.id}, ${fusedEventId}, ${edge.fromNode}, ${edge.toNode}, ${edge.edgeType}, ${edge.platform ?? null}, ${edge.weight ?? 1}, ${JSON.stringify(edge.evidence ?? [])}, ${now})
      `;
    }
  });
}
