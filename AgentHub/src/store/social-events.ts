import { getDb } from "./db";
import type { FusedSocialEvent, PlatformReport } from "../pipelines/social/schemas";
import {
  buildGlobalRadarOverview,
  type GlobalRadarEvent,
  type GlobalRadarOverview,
  type RadarSnapshotSample,
} from "../pipelines/social/radar";
import { SOCIAL_PLATFORMS } from "../pipelines/social/types";

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

interface SocialFusedEventRow {
  readonly id: string;
  readonly event_key: string;
  readonly radar_event_id: string | null;
  readonly radar_json: string | null;
  readonly first_seen_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface SocialRadarSnapshotRow {
  readonly captured_at: number;
  readonly verified_count: number;
  readonly platform_counts_json: string;
  readonly found_platforms_json: string;
  readonly attention_index: number;
  readonly status: RadarSnapshotSample["status"];
  readonly trend: FusedSocialEvent["trend"];
  readonly impact_level: FusedSocialEvent["impact_level"];
}

export interface SocialRadarEventContext {
  readonly radarEventId: string | null;
  readonly firstSeenAt: number;
  readonly updatedAt: number;
  readonly snapshots: readonly RadarSnapshotSample[];
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToRadarSnapshot(row: SocialRadarSnapshotRow): RadarSnapshotSample {
  return {
    capturedAt: Number(row.captured_at),
    verifiedCount: Number(row.verified_count),
    platformCounts: parseJson<Record<string, number>>(row.platform_counts_json, {}),
    foundPlatforms: parseJson<string[]>(row.found_platforms_json, []),
    attentionIndex: Number(row.attention_index),
    status: row.status,
    trend: row.trend,
    impactLevel: row.impact_level,
  };
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

export async function getSocialRadarEventContext(
  eventKey: string,
): Promise<SocialRadarEventContext | null> {
  const db = getDb();
  const rows = await db`
    SELECT radar_event_id, first_seen_at, created_at, updated_at
    FROM social_fused_events
    WHERE event_key = ${eventKey}
    LIMIT 1
  `;
  const row = (rows as SocialFusedEventRow[])[0];
  if (!row) return null;
  const snapshots = await db`
    SELECT captured_at, verified_count, platform_counts_json, found_platforms_json,
           attention_index, status, trend, impact_level
    FROM social_radar_snapshots
    WHERE event_key = ${eventKey}
    ORDER BY captured_at DESC
    LIMIT 12
  `;
  return {
    radarEventId: row.radar_event_id,
    firstSeenAt: Number(row.first_seen_at ?? row.created_at),
    updatedAt: Number(row.updated_at),
    snapshots: (snapshots as SocialRadarSnapshotRow[]).map(rowToRadarSnapshot),
  };
}

export async function upsertSocialFusedEvent(input: {
  readonly id: string;
  readonly event: FusedSocialEvent;
  readonly renderedText: string;
  readonly radar: GlobalRadarEvent;
  readonly now?: number;
}): Promise<void> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const db = getDb();
  const verifiedCount = input.radar.platformStats.reduce(
    (total, item) => total + item.verifiedCount,
    0,
  );
  const platformCounts = Object.fromEntries(
    input.radar.platformStats.map((item) => [item.platform, item.verifiedCount]),
  );
  await db.begin(async (tx) => {
    await tx`
      INSERT INTO social_fused_events
        (id, event_key, title, impact_level, trend, status, rendered_text, event_json,
         radar_event_id, radar_json, first_seen_at, created_at, updated_at)
      VALUES
        (${input.id}, ${input.event.event_key}, ${input.event.event_title},
         ${input.event.impact_level}, ${input.event.trend}, 'active',
         ${input.renderedText}, ${JSON.stringify(input.event)}, ${input.radar.eventId},
         ${JSON.stringify(input.radar)}, ${input.radar.firstSeenAt}, ${now}, ${now})
      ON CONFLICT (event_key) DO UPDATE SET
        title = EXCLUDED.title,
        impact_level = EXCLUDED.impact_level,
        trend = EXCLUDED.trend,
        rendered_text = EXCLUDED.rendered_text,
        event_json = EXCLUDED.event_json,
        radar_event_id = COALESCE(social_fused_events.radar_event_id, EXCLUDED.radar_event_id),
        radar_json = EXCLUDED.radar_json,
        first_seen_at = COALESCE(social_fused_events.first_seen_at, EXCLUDED.first_seen_at),
        updated_at = EXCLUDED.updated_at
    `;
    await tx`
      INSERT INTO social_radar_snapshots
        (id, event_key, captured_at, verified_count, platform_counts_json,
         found_platforms_json, attention_index, status, trend, impact_level)
      VALUES
        (${crypto.randomUUID()}, ${input.event.event_key}, ${now}, ${verifiedCount},
         ${JSON.stringify(platformCounts)}, ${JSON.stringify(input.radar.foundPlatforms)},
         ${input.radar.aiAssessment.attentionIndex}, ${input.radar.status},
         ${input.event.trend}, ${input.event.impact_level})
    `;
  });
}

export async function getGlobalRadarEvents(
  limit = 50,
): Promise<readonly GlobalRadarEvent[]> {
  const db = getDb();
  const rows = await db`
    SELECT radar_json
    FROM social_fused_events
    WHERE radar_event_id IS NOT NULL
      AND radar_json <> '{}'
    ORDER BY updated_at DESC
    LIMIT ${Math.min(100, Math.max(1, limit))}
  `;
  return (rows as Array<{ radar_json: string }>)
    .map((row) => parseJson<GlobalRadarEvent | null>(row.radar_json, null))
    .filter((event): event is GlobalRadarEvent => event?.schema === "global_radar_v1");
}

export async function getGlobalRadarEventById(
  eventId: string,
): Promise<GlobalRadarEvent | null> {
  const db = getDb();
  const rows = await db`
    SELECT radar_json
    FROM social_fused_events
    WHERE radar_event_id = ${eventId}
    LIMIT 1
  `;
  const row = (rows as Array<{ radar_json: string }>)[0];
  if (!row) return null;
  const event = parseJson<GlobalRadarEvent | null>(row.radar_json, null);
  return event?.schema === "global_radar_v1" ? event : null;
}

function chinaDayStartUnix(now: number): number {
  const date = new Date((now + 8 * 3600) * 1000);
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000 - 8 * 3600,
  );
}

export async function getGlobalRadarOverview(): Promise<GlobalRadarOverview> {
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  const [events, reportRows] = await Promise.all([
    getGlobalRadarEvents(50),
    db`
      SELECT COUNT(*)::int AS count
      FROM social_platform_reports
      WHERE created_at >= ${chinaDayStartUnix(now)}
    `,
  ]);
  const dailyVerifiedReportCount = Number(
    (reportRows as Array<{ count: number | string }>)[0]?.count ?? 0,
  );
  return buildGlobalRadarOverview({
    events,
    monitoredPlatformCount: SOCIAL_PLATFORMS.length,
    dailyVerifiedReportCount,
    updatedAt: now,
  });
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
