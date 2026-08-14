import { getDb } from "./db";
import {
  compareSocialFusionDedupeFingerprints,
  deriveSocialFusionDedupeFingerprintFromPayload,
  type SocialFusionDedupeComparison,
  type SocialFusionDedupeFingerprint,
} from "../pipelines/social/dedupe";
import type { FusedSocialEvent, PlatformReport } from "../pipelines/social/schemas";
import type { ChinaRelevanceResult, SocialPlatform } from "../pipelines/social/types";

export type SocialMonitorStatus =
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "completed";

export type SocialCandidateStatus =
  | "discovered"
  | "relevant"
  | "skipped"
  | "deep_crawled"
  | "fused"
  | "error";

export type SocialEvidenceStatus =
  | "found"
  | "not_found"
  | "missing_config"
  | "error"
  | "skipped";

export type SocialKanQueueStatus = "pending" | "held" | "sent" | "skipped";

export interface SocialMonitorRunRecord {
  readonly id: string;
  readonly status: SocialMonitorStatus;
  readonly mode: string;
  readonly selectedPlatforms: readonly SocialPlatform[];
  readonly maxCandidates: number;
  readonly limitPerPlatform: number;
  readonly continuous: boolean;
  readonly cycleIntervalSeconds: number;
  readonly retentionDays: number;
  readonly currentCycle: number;
  readonly currentStep: string;
  readonly cancelRequested: boolean;
  readonly error: string | null;
  readonly fusion: FusedSocialEvent | null;
  readonly renderedFusionText: string;
  readonly kanDecision: Record<string, unknown> | null;
  readonly platformStates: SocialPlatformAgentStateMap;
  readonly lastCycleStartedAt: number | null;
  readonly lastCycleCompletedAt: number | null;
  readonly startedAt: number;
  readonly stoppedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type SocialPlatformAgentStatus =
  | "idle"
  | "running"
  | "watching"
  | "found"
  | "not_found"
  | "missing_config"
  | "skipped"
  | "error";

export interface SocialPlatformAgentState {
  readonly platform: SocialPlatform;
  readonly agentId: string;
  readonly cycle: number;
  readonly status: SocialPlatformAgentStatus;
  readonly lastStep: string;
  readonly lastCheckedAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly discoveredCount: number;
  readonly rawRecordCount: number;
  readonly evidenceCount: number;
  readonly skippedCount: number;
  readonly deepCrawlCount: number;
  readonly errorCount: number;
  readonly lastError: string;
  readonly lastFindings: readonly string[];
  readonly patternSummary: string;
  readonly failureSummary: string;
  readonly improvementPlan: string;
  readonly nextAction: string;
  readonly reflectionSummary: string;
  readonly observedPatterns: readonly string[];
}

export type SocialPlatformAgentStateMap = Partial<
  Record<SocialPlatform, SocialPlatformAgentState>
>;

export interface SocialCandidateEventRecord {
  readonly id: string;
  readonly runId: string;
  readonly sourcePlatform: SocialPlatform;
  readonly eventKey: string;
  readonly title: string;
  readonly summary: string;
  readonly discoveredAt: number;
  readonly raw: unknown;
  readonly status: SocialCandidateStatus;
  readonly chinaRelevance: ChinaRelevanceResult | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SocialPlatformEvidenceRecord {
  readonly id: string;
  readonly runId: string;
  readonly candidateEventId: string;
  readonly platform: SocialPlatform;
  readonly status: SocialEvidenceStatus;
  readonly title: string;
  readonly evidence: unknown;
  readonly metrics: Record<string, unknown>;
  readonly report: PlatformReport | null;
  readonly renderedReportText: string;
  readonly createdAt: number;
}

export interface SocialKanQueueRecord {
  readonly id: string;
  readonly runId: string;
  readonly fusedEventKey: string;
  readonly dedupeKey: string;
  readonly dedupeFingerprint: SocialFusionDedupeFingerprint | null;
  readonly duplicateOfQueueId: string | null;
  readonly status: SocialKanQueueStatus;
  readonly reason: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SocialKanDuplicateMatch {
  readonly queue: SocialKanQueueRecord;
  readonly matchedBy: "fused_event_key" | "dedupe_key" | "fingerprint";
  readonly comparison: SocialFusionDedupeComparison;
}

export interface SocialAgentStepLogRecord {
  readonly id: string;
  readonly runId: string;
  readonly agentId: string;
  readonly step: string;
  readonly status: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
  readonly createdAt: number;
}

export interface SocialMonitorRunDetail extends SocialMonitorRunRecord {
  readonly candidates: readonly SocialCandidateEventRecord[];
  readonly evidence: readonly SocialPlatformEvidenceRecord[];
  readonly kanQueue: readonly SocialKanQueueRecord[];
  readonly logs: readonly SocialAgentStepLogRecord[];
}

interface RunRow {
  readonly id: string;
  readonly status: SocialMonitorStatus;
  readonly mode: string;
  readonly selected_platforms_json: string;
  readonly max_candidates: number;
  readonly limit_per_platform: number;
  readonly continuous?: boolean;
  readonly cycle_interval_seconds?: number;
  readonly retention_days?: number;
  readonly current_cycle: number;
  readonly current_step: string;
  readonly cancel_requested: boolean;
  readonly error: string | null;
  readonly fusion_json: string | null;
  readonly rendered_fusion_text: string;
  readonly kan_decision_json: string | null;
  readonly platform_states_json?: string | null;
  readonly last_cycle_started_at?: number | null;
  readonly last_cycle_completed_at?: number | null;
  readonly started_at: number;
  readonly stopped_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface CandidateRow {
  readonly id: string;
  readonly run_id: string;
  readonly source_platform: SocialPlatform;
  readonly event_key: string;
  readonly title: string;
  readonly summary: string;
  readonly discovered_at: number;
  readonly raw_json: string;
  readonly status: SocialCandidateStatus;
  readonly china_relevance_json: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface EvidenceRow {
  readonly id: string;
  readonly run_id: string;
  readonly candidate_event_id: string;
  readonly platform: SocialPlatform;
  readonly status: SocialEvidenceStatus;
  readonly title: string;
  readonly evidence_json: string;
  readonly metrics_json: string;
  readonly report_json: string | null;
  readonly rendered_report_text: string;
  readonly created_at: number;
}

interface KanQueueRow {
  readonly id: string;
  readonly run_id: string;
  readonly fused_event_key: string;
  readonly dedupe_key?: string;
  readonly dedupe_fingerprint_json?: string;
  readonly duplicate_of_queue_id?: string | null;
  readonly status: SocialKanQueueStatus;
  readonly reason: string;
  readonly payload_json: string;
  readonly created_at: number;
  readonly updated_at: number;
}

interface LogRow {
  readonly id: string;
  readonly run_id: string;
  readonly agent_id: string;
  readonly step: string;
  readonly status: string;
  readonly message: string;
  readonly data_json: string;
  readonly created_at: number;
}

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function rowToRun(row: RunRow): SocialMonitorRunRecord {
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    selectedPlatforms: parseJson<SocialPlatform[]>(row.selected_platforms_json, []),
    maxCandidates: Number(row.max_candidates),
    limitPerPlatform: Number(row.limit_per_platform),
    continuous: Boolean(row.continuous),
    cycleIntervalSeconds: Number(row.cycle_interval_seconds ?? 300),
    retentionDays: Number(row.retention_days ?? 30),
    currentCycle: Number(row.current_cycle),
    currentStep: row.current_step,
    cancelRequested: Boolean(row.cancel_requested),
    error: row.error,
    fusion: parseJson<FusedSocialEvent | null>(row.fusion_json, null),
    renderedFusionText: row.rendered_fusion_text,
    kanDecision: parseJson<Record<string, unknown> | null>(
      row.kan_decision_json,
      null,
    ),
    platformStates: parseJson<SocialPlatformAgentStateMap>(
      row.platform_states_json,
      {},
    ),
    lastCycleStartedAt:
      row.last_cycle_started_at === null || row.last_cycle_started_at === undefined
        ? null
        : Number(row.last_cycle_started_at),
    lastCycleCompletedAt:
      row.last_cycle_completed_at === null || row.last_cycle_completed_at === undefined
        ? null
        : Number(row.last_cycle_completed_at),
    startedAt: Number(row.started_at),
    stoppedAt: row.stopped_at === null ? null : Number(row.stopped_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToCandidate(row: CandidateRow): SocialCandidateEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    sourcePlatform: row.source_platform,
    eventKey: row.event_key,
    title: row.title,
    summary: row.summary,
    discoveredAt: Number(row.discovered_at),
    raw: parseJson(row.raw_json, {}),
    status: row.status,
    chinaRelevance: parseJson<ChinaRelevanceResult | null>(
      row.china_relevance_json,
      null,
    ),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToEvidence(row: EvidenceRow): SocialPlatformEvidenceRecord {
  return {
    id: row.id,
    runId: row.run_id,
    candidateEventId: row.candidate_event_id,
    platform: row.platform,
    status: row.status,
    title: row.title,
    evidence: parseJson(row.evidence_json, {}),
    metrics: parseJson<Record<string, unknown>>(row.metrics_json, {}),
    report: parseJson<PlatformReport | null>(row.report_json, null),
    renderedReportText: row.rendered_report_text,
    createdAt: Number(row.created_at),
  };
}

function rowToKanQueue(row: KanQueueRow): SocialKanQueueRecord {
  const payload = parseJson<Record<string, unknown>>(row.payload_json, {});
  const dedupeFingerprint = parseDedupeFingerprint(row.dedupe_fingerprint_json);
  return {
    id: row.id,
    runId: row.run_id,
    fusedEventKey: row.fused_event_key,
    dedupeKey: row.dedupe_key ?? "",
    dedupeFingerprint,
    duplicateOfQueueId: row.duplicate_of_queue_id ?? null,
    status: row.status,
    reason: row.reason,
    payload,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function parseDedupeFingerprint(
  text: string | null | undefined,
): SocialFusionDedupeFingerprint | null {
  const parsed = parseJson<unknown>(text, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.eventKey !== "string" ||
    typeof record.eventTitle !== "string" ||
    !Array.isArray(record.urls) ||
    !Array.isArray(record.nodes) ||
    !Array.isArray(record.titleTokens) ||
    !Array.isArray(record.platforms)
  ) {
    return null;
  }
  return {
    eventKey: record.eventKey,
    eventTitle: record.eventTitle,
    urls: record.urls.filter((item): item is string => typeof item === "string"),
    nodes: record.nodes.filter((item): item is string => typeof item === "string"),
    titleTokens: record.titleTokens.filter((item): item is string => typeof item === "string"),
    platforms: record.platforms.filter((item): item is string => typeof item === "string"),
  };
}

function rowToLog(row: LogRow): SocialAgentStepLogRecord {
  return {
    id: row.id,
    runId: row.run_id,
    agentId: row.agent_id,
    step: row.step,
    status: row.status,
    message: row.message,
    data: parseJson<Record<string, unknown>>(row.data_json, {}),
    createdAt: Number(row.created_at),
  };
}

export async function createSocialMonitorRun(input: {
  readonly id: string;
  readonly mode: string;
  readonly selectedPlatforms: readonly SocialPlatform[];
  readonly maxCandidates: number;
  readonly limitPerPlatform: number;
  readonly continuous?: boolean;
  readonly cycleIntervalSeconds?: number;
  readonly retentionDays?: number;
  readonly platformStates?: SocialPlatformAgentStateMap;
  readonly now?: number;
}): Promise<SocialMonitorRunRecord> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const db = getDb();
  const rows = await db`
    INSERT INTO social_monitor_runs
      (id, status, mode, selected_platforms_json, max_candidates,
       limit_per_platform, continuous, cycle_interval_seconds, retention_days,
       current_cycle, current_step, cancel_requested, platform_states_json,
       started_at, created_at, updated_at)
    VALUES
      (${input.id}, 'running', ${input.mode}, ${JSON.stringify(input.selectedPlatforms)},
       ${input.maxCandidates}, ${input.limitPerPlatform},
       ${Boolean(input.continuous)}, ${input.cycleIntervalSeconds ?? 300},
       ${input.retentionDays ?? 30}, 1, '准备启动自主巡逻', FALSE,
       ${JSON.stringify(input.platformStates ?? {})}, ${now}, ${now}, ${now})
    RETURNING *
  `;
  return rowToRun((rows as RunRow[])[0]!);
}

export async function getActiveSocialMonitorRun(): Promise<SocialMonitorRunRecord | null> {
  const db = getDb();
  const rows = await db`
    SELECT * FROM social_monitor_runs
    WHERE status IN ('running', 'stopping')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = (rows as RunRow[])[0];
  return row ? rowToRun(row) : null;
}

export async function stopOrphanedSocialMonitorRuns(
  activeRunIds: readonly string[] = [],
  staleAfterSeconds = 0,
): Promise<number> {
  const keep = new Set(activeRunIds);
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  const rows = (await db`
    SELECT id, updated_at FROM social_monitor_runs
    WHERE status IN ('running', 'stopping')
  `) as Array<{ id: string; updated_at: number }>;

  let stopped = 0;
  for (const row of rows) {
    if (keep.has(row.id)) continue;
    if (staleAfterSeconds > 0 && now - Number(row.updated_at) < staleAfterSeconds) {
      continue;
    }
    await db`
      UPDATE social_monitor_runs
      SET status = 'stopped',
          cancel_requested = TRUE,
          current_step = '服务重启后已停止旧的巡逻任务',
          error = CASE
            WHEN error IS NULL
              OR error = 'Old background task disappeared after web restart; marked stopped'
              THEN '服务重启后后台任务不存在，已自动停止'
            ELSE error
          END,
          stopped_at = COALESCE(stopped_at, ${now}),
          updated_at = ${now}
      WHERE id = ${row.id}
        AND status IN ('running', 'stopping')
    `;
    stopped += 1;
  }
  return stopped;
}

export async function getLatestSocialMonitorRun(): Promise<SocialMonitorRunRecord | null> {
  const db = getDb();
  const rows = await db`
    SELECT * FROM social_monitor_runs
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = (rows as RunRow[])[0];
  return row ? rowToRun(row) : null;
}

export async function getSocialMonitorRunDetail(
  runId: string,
): Promise<SocialMonitorRunDetail | null> {
  const db = getDb();
  const runRows = await db`
    SELECT * FROM social_monitor_runs
    WHERE id = ${runId}
    LIMIT 1
  `;
  const runRow = (runRows as RunRow[])[0];
  if (!runRow) return null;

  const [candidateRows, evidenceRows, kanRows, logRows] = await Promise.all([
    db`
      SELECT * FROM social_candidate_events
      WHERE run_id = ${runId}
      ORDER BY created_at ASC
    `,
    db`
      SELECT * FROM social_platform_evidence
      WHERE run_id = ${runId}
      ORDER BY created_at ASC
    `,
    db`
      SELECT * FROM social_kan_queue
      WHERE run_id = ${runId}
      ORDER BY created_at DESC
    `,
    db`
      SELECT * FROM social_agent_step_logs
      WHERE run_id = ${runId}
      ORDER BY created_at ASC
    `,
  ]);

  return {
    ...rowToRun(runRow),
    candidates: (candidateRows as CandidateRow[]).map(rowToCandidate),
    evidence: (evidenceRows as EvidenceRow[]).map(rowToEvidence),
    kanQueue: (kanRows as KanQueueRow[]).map(rowToKanQueue),
    logs: (logRows as LogRow[]).map(rowToLog),
  };
}

export async function requestStopSocialMonitorRun(runId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  await db`
    UPDATE social_monitor_runs
    SET cancel_requested = TRUE,
        status = CASE WHEN status = 'running' THEN 'stopping' ELSE status END,
        current_step = CASE WHEN status = 'running' THEN '正在停止智能体' ELSE current_step END,
        updated_at = ${now}
    WHERE id = ${runId}
  `;
}

export async function isSocialMonitorStopRequested(runId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db`
    SELECT cancel_requested FROM social_monitor_runs
    WHERE id = ${runId}
    LIMIT 1
  `;
  return Boolean((rows as Array<{ cancel_requested: boolean }>)[0]?.cancel_requested);
}

export async function updateSocialMonitorRun(input: {
  readonly id: string;
  readonly status?: SocialMonitorStatus;
  readonly currentStep?: string;
  readonly currentCycle?: number;
  readonly error?: string | null;
  readonly stoppedAt?: number | null;
  readonly fusion?: FusedSocialEvent | null;
  readonly renderedFusionText?: string;
  readonly kanDecision?: Record<string, unknown> | null;
  readonly platformStates?: SocialPlatformAgentStateMap;
  readonly lastCycleStartedAt?: number | null;
  readonly lastCycleCompletedAt?: number | null;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  await db`
    UPDATE social_monitor_runs
    SET
      status = COALESCE(${input.status ?? null}, status),
      current_step = COALESCE(${input.currentStep ?? null}, current_step),
      current_cycle = COALESCE(${input.currentCycle ?? null}, current_cycle),
      error = COALESCE(${input.error ?? null}, error),
      stopped_at = COALESCE(${input.stoppedAt ?? null}, stopped_at),
      fusion_json = COALESCE(${input.fusion === undefined ? null : JSON.stringify(input.fusion)}, fusion_json),
      rendered_fusion_text = COALESCE(${input.renderedFusionText ?? null}, rendered_fusion_text),
      kan_decision_json = COALESCE(${input.kanDecision === undefined ? null : JSON.stringify(input.kanDecision)}, kan_decision_json),
      platform_states_json = COALESCE(${input.platformStates === undefined ? null : JSON.stringify(input.platformStates)}, platform_states_json),
      last_cycle_started_at = COALESCE(${input.lastCycleStartedAt ?? null}, last_cycle_started_at),
      last_cycle_completed_at = COALESCE(${input.lastCycleCompletedAt ?? null}, last_cycle_completed_at),
      updated_at = ${now}
    WHERE id = ${input.id}
  `;
}

export async function appendSocialAgentStepLog(input: {
  readonly runId: string;
  readonly agentId: string;
  readonly step: string;
  readonly status: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly now?: number;
}): Promise<void> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const db = getDb();
  await db`
    INSERT INTO social_agent_step_logs
      (id, run_id, agent_id, step, status, message, data_json, created_at)
    VALUES
      (${crypto.randomUUID()}, ${input.runId}, ${input.agentId}, ${input.step},
       ${input.status}, ${input.message}, ${JSON.stringify(input.data ?? {})}, ${now})
  `;
}

export async function insertSocialCandidateEvent(input: {
  readonly id: string;
  readonly runId: string;
  readonly sourcePlatform: SocialPlatform;
  readonly eventKey: string;
  readonly title: string;
  readonly summary: string;
  readonly discoveredAt: number;
  readonly raw: unknown;
  readonly status?: SocialCandidateStatus;
  readonly chinaRelevance?: ChinaRelevanceResult | null;
  readonly now?: number;
}): Promise<void> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const db = getDb();
  await db`
    INSERT INTO social_candidate_events
      (id, run_id, source_platform, event_key, title, summary, discovered_at,
       raw_json, status, china_relevance_json, created_at, updated_at)
    VALUES
      (${input.id}, ${input.runId}, ${input.sourcePlatform}, ${input.eventKey},
       ${input.title}, ${input.summary}, ${input.discoveredAt},
       ${JSON.stringify(input.raw ?? {})}, ${input.status ?? "discovered"},
       ${input.chinaRelevance ? JSON.stringify(input.chinaRelevance) : null},
       ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      raw_json = EXCLUDED.raw_json,
      status = EXCLUDED.status,
      china_relevance_json = EXCLUDED.china_relevance_json,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function updateSocialCandidateEvent(input: {
  readonly id: string;
  readonly status?: SocialCandidateStatus;
  readonly chinaRelevance?: ChinaRelevanceResult | null;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  await db`
    UPDATE social_candidate_events
    SET
      status = COALESCE(${input.status ?? null}, status),
      china_relevance_json = COALESCE(${input.chinaRelevance === undefined ? null : JSON.stringify(input.chinaRelevance)}, china_relevance_json),
      updated_at = ${now}
    WHERE id = ${input.id}
  `;
}

export async function insertSocialPlatformEvidence(input: {
  readonly id: string;
  readonly runId: string;
  readonly candidateEventId: string;
  readonly platform: SocialPlatform;
  readonly status: SocialEvidenceStatus;
  readonly title: string;
  readonly evidence: unknown;
  readonly metrics?: Record<string, unknown>;
  readonly report?: PlatformReport | null;
  readonly renderedReportText?: string;
  readonly now?: number;
}): Promise<void> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const db = getDb();
  await db`
    INSERT INTO social_platform_evidence
      (id, run_id, candidate_event_id, platform, status, title, evidence_json,
       metrics_json, report_json, rendered_report_text, created_at)
    VALUES
      (${input.id}, ${input.runId}, ${input.candidateEventId}, ${input.platform},
       ${input.status}, ${input.title}, ${JSON.stringify(input.evidence ?? {})},
       ${JSON.stringify(input.metrics ?? {})},
       ${input.report ? JSON.stringify(input.report) : null},
       ${input.renderedReportText ?? ""}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      title = EXCLUDED.title,
      evidence_json = EXCLUDED.evidence_json,
      metrics_json = EXCLUDED.metrics_json,
      report_json = EXCLUDED.report_json,
      rendered_report_text = EXCLUDED.rendered_report_text
  `;
}

export async function attachSocialEvidenceReport(input: {
  readonly id: string;
  readonly report: PlatformReport;
  readonly renderedReportText: string;
}): Promise<void> {
  const db = getDb();
  await db`
    UPDATE social_platform_evidence
    SET report_json = ${JSON.stringify(input.report)},
        rendered_report_text = ${input.renderedReportText}
    WHERE id = ${input.id}
  `;
}

export async function upsertSocialKanQueue(input: {
  readonly id: string;
  readonly runId: string;
  readonly fusedEventKey: string;
  readonly dedupeKey?: string;
  readonly dedupeFingerprint?: SocialFusionDedupeFingerprint | null;
  readonly duplicateOfQueueId?: string | null;
  readonly status: SocialKanQueueStatus;
  readonly reason: string;
  readonly payload: Record<string, unknown>;
  readonly now?: number;
}): Promise<void> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const db = getDb();
  await db`
    INSERT INTO social_kan_queue
      (id, run_id, fused_event_key, dedupe_key, dedupe_fingerprint_json,
       duplicate_of_queue_id, status, reason, payload_json, created_at, updated_at)
    VALUES
      (${input.id}, ${input.runId}, ${input.fusedEventKey}, ${input.dedupeKey ?? ""},
       ${JSON.stringify(input.dedupeFingerprint ?? null)},
       ${input.duplicateOfQueueId ?? null}, ${input.status}, ${input.reason},
       ${JSON.stringify(input.payload)}, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      dedupe_key = EXCLUDED.dedupe_key,
      dedupe_fingerprint_json = EXCLUDED.dedupe_fingerprint_json,
      duplicate_of_queue_id = EXCLUDED.duplicate_of_queue_id,
      status = EXCLUDED.status,
      reason = EXCLUDED.reason,
      payload_json = EXCLUDED.payload_json,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function findRecentSocialKanDuplicate(input: {
  readonly fusedEventKey: string;
  readonly dedupeKey: string;
  readonly dedupeFingerprint: SocialFusionDedupeFingerprint;
  readonly lookbackSeconds?: number;
  readonly now?: number;
}): Promise<SocialKanDuplicateMatch | null> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const since = now - Math.max(60, input.lookbackSeconds ?? 86_400);
  const db = getDb();
  const rows = (await db`
    SELECT * FROM social_kan_queue
    WHERE (
      status IN ('sent', 'pending')
      OR (status = 'skipped' AND duplicate_of_queue_id IS NOT NULL)
    )
      AND created_at >= ${since}
    ORDER BY created_at DESC
    LIMIT 200
  `) as KanQueueRow[];

  for (const row of rows) {
    const queue = rowToKanQueue(row);
    if (input.fusedEventKey && queue.fusedEventKey === input.fusedEventKey) {
      return {
        queue,
        matchedBy: "fused_event_key",
        comparison: {
          isDuplicate: true,
          score: 1,
          reasons: ["事件 key 完全相同"],
          commonUrls: [],
          commonNodes: [],
          commonTitleTokens: [],
        },
      };
    }
    if (input.dedupeKey && queue.dedupeKey === input.dedupeKey) {
      return {
        queue,
        matchedBy: "dedupe_key",
        comparison: {
          isDuplicate: true,
          score: 0.96,
          reasons: ["事件去重键完全相同"],
          commonUrls: [],
          commonNodes: [],
          commonTitleTokens: [],
        },
      };
    }

    const previousFingerprint =
      queue.dedupeFingerprint ??
      deriveSocialFusionDedupeFingerprintFromPayload(queue.payload);
    const comparison = compareSocialFusionDedupeFingerprints(
      input.dedupeFingerprint,
      previousFingerprint,
    );
    if (comparison.isDuplicate) {
      return {
        queue,
        matchedBy: "fingerprint",
        comparison,
      };
    }
  }

  return null;
}
