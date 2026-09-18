import { Hono } from "hono";
import { z } from "zod";
import type { AgentRegistry } from "../../agents/registry";
import type { ToolRegistry } from "../../tools/registry";
import { PLATFORM_AGENT_IDS } from "../../pipelines/social/agents";
import { runAutonomousSocialMonitor } from "../../pipelines/social/autonomous-monitor";
import { runSocialPipeline } from "../../pipelines/social/pipeline";
import {
  renderGlobalRadarKanMessage,
  renderSocialFusionKanMessage,
} from "../../pipelines/social/renderers";
import { createRouteBackedSocialAgentRunner } from "../../pipelines/social/runner";
import type { PlatformReport } from "../../pipelines/social/schemas";
import {
  buildGlobalRadarEvent,
  createGlobalRadarEventId,
  type GlobalRadarEvent,
} from "../../pipelines/social/radar";
import { SOCIAL_PLATFORMS } from "../../pipelines/social/types";
import {
  createSocialMonitorRun,
  getActiveSocialMonitorRun,
  getLatestSocialMonitorRun,
  getSocialMonitorRunDetail,
  requestStopSocialMonitorRun,
  stopOrphanedSocialMonitorRuns,
  type SocialMonitorRunRecord,
} from "../../store/social-monitor";
import {
  getGlobalRadarEventById,
  getGlobalRadarEvents,
  getGlobalRadarOverview,
  getSocialRadarEventContext,
  saveSocialPlatformReport,
  upsertSocialFusedEvent,
} from "../../store/social-events";
import { createLogger } from "../../logger";

const log = createLogger("routes:social");

const monitorControllers = new Map<string, AbortController>();
const STALE_MONITOR_SECONDS = 300;
const ORPHANED_MONITOR_ERROR = "服务重启后后台任务不存在，已自动停止";
let recoveryPromise: Promise<void> | null = null;

async function cleanupOrphanedMonitorRuns(
  reason: string,
  staleAfterSeconds = 0,
): Promise<void> {
  const stopped = await stopOrphanedSocialMonitorRuns([
    ...monitorControllers.keys(),
  ], staleAfterSeconds);
  if (stopped > 0) {
    log.warn("Stopped orphaned social monitor run(s)", { reason, stopped });
  }
}

function isStoredContinuousMonitor(run: SocialMonitorRunRecord | null): run is SocialMonitorRunRecord {
  return Boolean(
    run &&
      run.continuous &&
      !run.cancelRequested &&
      (run.mode === "probe" || run.mode === "crawl") &&
      run.selectedPlatforms.length > 0,
  );
}

function isAutoStoppedContinuousMonitor(
  run: SocialMonitorRunRecord | null,
): run is SocialMonitorRunRecord {
  return Boolean(
    run &&
      run.status === "stopped" &&
      run.continuous &&
      run.error === ORPHANED_MONITOR_ERROR &&
      (run.mode === "probe" || run.mode === "crawl") &&
      run.selectedPlatforms.length > 0,
  );
}

function launchMonitorBackgroundTask(
  run: SocialMonitorRunRecord,
  deps: {
    readonly agentRegistry: AgentRegistry;
    readonly toolRegistry?: ToolRegistry;
  },
  reason: string,
): void {
  if (!deps.toolRegistry) {
    log.warn("Cannot recover social monitor: tool registry missing", {
      runId: run.id,
      reason,
    });
    return;
  }
  if (monitorControllers.has(run.id)) return;

  const controller = new AbortController();
  monitorControllers.set(run.id, controller);
  log.warn("Recovered continuous social monitor background task", {
    runId: run.id,
    reason,
    mode: run.mode,
    platforms: run.selectedPlatforms,
    cycleIntervalSeconds: run.cycleIntervalSeconds,
  });

  runAutonomousSocialMonitor({
    runId: run.id,
    agentRegistry: deps.agentRegistry,
    toolRegistry: deps.toolRegistry,
    platforms: run.selectedPlatforms,
    mode: run.mode === "crawl" ? "crawl" : "probe",
    limit: run.limitPerPlatform,
    maxCandidates: run.maxCandidates,
    continuous: run.continuous,
    cycleIntervalSeconds: run.cycleIntervalSeconds,
    retentionDays: run.retentionDays,
    analysisTimeoutMs: 180_000,
    abortSignal: controller.signal,
  })
    .catch((err) => {
      log.error("Recovered autonomous social monitor background task failed", {
        runId: run.id,
        err: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      monitorControllers.delete(run.id);
    });
}

async function createReplacementContinuousMonitor(
  previous: SocialMonitorRunRecord,
  deps: {
    readonly agentRegistry: AgentRegistry;
    readonly toolRegistry?: ToolRegistry;
  },
  reason: string,
): Promise<SocialMonitorRunRecord | null> {
  if (!deps.toolRegistry) return null;
  const replacement = await createSocialMonitorRun({
    id: crypto.randomUUID(),
    mode: previous.mode === "crawl" ? "crawl" : "probe",
    selectedPlatforms: previous.selectedPlatforms,
    maxCandidates: previous.maxCandidates,
    limitPerPlatform: previous.limitPerPlatform,
    continuous: true,
    cycleIntervalSeconds: previous.cycleIntervalSeconds,
    retentionDays: previous.retentionDays,
  });
  launchMonitorBackgroundTask(replacement, deps, reason);
  return replacement;
}

async function ensureContinuousMonitorRecovery(
  deps: {
    readonly agentRegistry: AgentRegistry;
    readonly toolRegistry?: ToolRegistry;
  },
  reason: string,
): Promise<void> {
  if (recoveryPromise) return recoveryPromise;
  recoveryPromise = (async () => {
    if (!deps.toolRegistry) {
      await cleanupOrphanedMonitorRuns(reason, STALE_MONITOR_SECONDS);
      return;
    }

    const active = await getActiveSocialMonitorRun();
    if (monitorControllers.has(active?.id ?? "")) return;

    if (isStoredContinuousMonitor(active)) {
      await cleanupOrphanedMonitorRuns(`${reason}:replace_orphaned_running`);
      await createReplacementContinuousMonitor(active, deps, `${reason}:replace_orphaned_running`);
      return;
    }

    await cleanupOrphanedMonitorRuns(reason, STALE_MONITOR_SECONDS);
    const latest = await getLatestSocialMonitorRun();
    if (isAutoStoppedContinuousMonitor(latest)) {
      await createReplacementContinuousMonitor(latest, deps, `${reason}:restart_auto_stopped`);
    }
  })().finally(() => {
    recoveryPromise = null;
  });
  return recoveryPromise;
}

const socialSignalSchema = z.object({
  id: z.string().min(1),
  platform: z.enum(SOCIAL_PLATFORMS),
  title: z.string().min(1),
  summary: z.string().default(""),
  observedAt: z.number().int().nonnegative().optional(),
  evidence: z.array(z.string()).default([]),
  metrics: z.record(z.string(), z.unknown()).optional(),
  raw: z.unknown().optional(),
});

const runBodySchema = z.object({
  signals: z.array(socialSignalSchema).min(1).max(20),
  persist: z.boolean().default(true),
  analysisTimeoutMs: z.number().int().min(5_000).max(600_000).default(90_000),
});

const monitorStartBodySchema = z.object({
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1).max(SOCIAL_PLATFORMS.length).optional(),
  mode: z.enum(["probe", "crawl"]).default("probe"),
  limit: z.number().int().min(1).max(10).default(3),
  maxCandidates: z.number().int().min(1).max(50).default(10),
  continuous: z.boolean().default(true),
  cycleIntervalSeconds: z.number().int().min(10).max(86_400).default(300),
  retentionDays: z.number().int().min(1).max(31).default(30),
  analysisTimeoutMs: z.number().int().min(30_000).max(600_000).default(180_000),
});

export function createSocialRoutes(deps: {
  readonly agentRegistry: AgentRegistry;
  readonly toolRegistry?: ToolRegistry;
}): Hono {
  const app = new Hono();

  app.get("/social/radar/overview", async (c) => {
    return c.json({ success: true, data: await getGlobalRadarOverview() });
  });

  app.get("/social/radar/events", async (c) => {
    const requested = Number(c.req.query("limit") ?? 30);
    const limit = Number.isFinite(requested) ? requested : 30;
    return c.json({ success: true, data: await getGlobalRadarEvents(limit) });
  });

  app.get("/social/radar/events/:eventId", async (c) => {
    const event = await getGlobalRadarEventById(c.req.param("eventId"));
    if (!event) {
      return c.json({ success: false, error: "未找到全域雷达事件" }, 404);
    }
    return c.json({ success: true, data: event });
  });

  app.get("/social/monitor/latest", async (c) => {
    await ensureContinuousMonitorRecovery(deps, "latest_status_read");
    const latest = await getLatestSocialMonitorRun();
    if (!latest) return c.json({ success: true, data: null });
    return c.json({
      success: true,
      data: await getSocialMonitorRunDetail(latest.id),
    });
  });

  app.get("/social/monitor/latest/kan-preview", async (c) => {
    await ensureContinuousMonitorRecovery(deps, "kan_preview_read");
    const latest = await getLatestSocialMonitorRun();
    if (!latest) return c.json({ success: true, data: null });

    const detail = await getSocialMonitorRunDetail(latest.id);
    const queueItem = detail?.kanQueue[0];
    if (!detail || !queueItem) return c.json({ success: true, data: null });

    const platformReports = platformReportsFromPayload(queueItem.payload);
    const radar = radarFromPayload(queueItem.payload);
    const payloadMessage =
      typeof queueItem.payload.message === "string" ? queueItem.payload.message : "";
    const message =
      payloadMessage ||
      (radar
        ? renderGlobalRadarKanMessage({
            radar,
            decisionReason: queueItem.reason,
          })
        : detail.fusion
        ? renderSocialFusionKanMessage({
            event: detail.fusion,
            platformReports,
            decisionReason: queueItem.reason,
          })
        : detail.renderedFusionText);

    return c.json({
      success: true,
      data: {
        runId: detail.id,
        queueId: queueItem.id,
        status: queueItem.status,
        reason: queueItem.reason,
        dryRun: true,
        message,
        event: detail.fusion,
        radar,
        platformReports,
        platformEvidence: Array.isArray(queueItem.payload.platformEvidence)
          ? queueItem.payload.platformEvidence
          : [],
      },
    });
  });

  app.get("/social/monitor/runs/:runId", async (c) => {
    await ensureContinuousMonitorRecovery(deps, "run_detail_read");
    const detail = await getSocialMonitorRunDetail(c.req.param("runId"));
    if (!detail) {
      return c.json({ success: false, error: "未找到该监控运行" }, 404);
    }
    return c.json({ success: true, data: detail });
  });

  app.post("/social/monitor/start", async (c) => {
    if (!deps.toolRegistry) {
      return c.json({ success: false, error: "社交爬虫工具未加载" }, 503);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "请求体不是合法 JSON" }, 400);
    }

    const parsed = monitorStartBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: "自主监控启动参数不合法", details: parsed.error.flatten() },
        400,
      );
    }

    await ensureContinuousMonitorRecovery(deps, "start_before_active_check");
    const active = await getActiveSocialMonitorRun();
    if (active) {
      return c.json(
        {
          success: false,
          error: "已有社交智能体正在运行，请先停止或等待完成",
          data: await getSocialMonitorRunDetail(active.id),
        },
        409,
      );
    }

    const runId = crypto.randomUUID();
    const platforms = parsed.data.platforms ?? SOCIAL_PLATFORMS;
    const run = await createSocialMonitorRun({
      id: runId,
      mode: parsed.data.mode,
      selectedPlatforms: platforms,
      maxCandidates: parsed.data.maxCandidates,
      limitPerPlatform: parsed.data.limit,
      continuous: parsed.data.continuous,
      cycleIntervalSeconds: parsed.data.cycleIntervalSeconds,
      retentionDays: parsed.data.retentionDays,
    });
    const controller = new AbortController();
    monitorControllers.set(runId, controller);

    runAutonomousSocialMonitor({
      runId,
      agentRegistry: deps.agentRegistry,
      toolRegistry: deps.toolRegistry,
      platforms,
      mode: parsed.data.mode,
      limit: parsed.data.limit,
      maxCandidates: parsed.data.maxCandidates,
      continuous: parsed.data.continuous,
      cycleIntervalSeconds: parsed.data.cycleIntervalSeconds,
      retentionDays: parsed.data.retentionDays,
      analysisTimeoutMs: parsed.data.analysisTimeoutMs,
      abortSignal: controller.signal,
    })
      .catch((err) => {
        log.error("Autonomous social monitor background task failed", {
          runId,
          err: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        monitorControllers.delete(runId);
      });

    return c.json({
      success: true,
      data: await getSocialMonitorRunDetail(run.id),
    });
  });

  app.post("/social/monitor/:runId/stop", async (c) => {
    const runId = c.req.param("runId");
    await requestStopSocialMonitorRun(runId);
    const controller = monitorControllers.get(runId);
    if (controller) {
      controller.abort();
    } else {
      await cleanupOrphanedMonitorRuns("stop_without_live_controller");
    }
    return c.json({
      success: true,
      data: await getSocialMonitorRunDetail(runId),
    });
  });

  app.post("/social/run", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "请求体不是合法 JSON" }, 400);
    }

    const parsed = runBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: "社交分析参数不合法", details: parsed.error.flatten() },
        400,
      );
    }

    const signals = parsed.data.signals.map((signal) => ({
      ...signal,
      observedAt: signal.observedAt ?? Math.floor(Date.now() / 1000),
    }));

    try {
      const result = await runSocialPipelineBounded({
        signals,
        agentRegistry: deps.agentRegistry,
        timeoutMs: parsed.data.analysisTimeoutMs,
      });

      if (parsed.data.persist) {
        for (const [index, report] of result.platformReports.entries()) {
          const agentId = PLATFORM_AGENT_IDS[report.platform];
          await saveSocialPlatformReport({
            id: crypto.randomUUID(),
            agentId,
            report,
            renderedText: result.renderedPlatformReports[index] ?? "",
          });
        }
        if (result.fusedEvent && result.renderedFusedEvent) {
          const existingRadar = await getSocialRadarEventContext(result.fusedEvent.event_key);
          const radar = buildGlobalRadarEvent({
            event: result.fusedEvent,
            platformReports: result.platformReports,
            eventId: existingRadar?.radarEventId ?? createGlobalRadarEventId(),
            firstSeenAt: existingRadar?.firstSeenAt ?? Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            monitoredPlatformCount: SOCIAL_PLATFORMS.length,
            history: existingRadar?.snapshots,
          });
          await upsertSocialFusedEvent({
            id: crypto.randomUUID(),
            event: result.fusedEvent,
            renderedText: renderGlobalRadarKanMessage({ radar }),
            radar,
          });
        }
      }

      return c.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("Social pipeline run failed", { err: message });
      return c.json(
        { success: false, error: message },
        isTimeoutError(err) ? 504 : 500,
      );
    }
  });

  return app;
}

function platformReportsFromPayload(payload: Record<string, unknown>): readonly PlatformReport[] {
  const value = payload.platformReports;
  return Array.isArray(value) ? (value as PlatformReport[]) : [];
}

function radarFromPayload(payload: Record<string, unknown>): GlobalRadarEvent | null {
  const value = payload.radar;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const radar = value as Partial<GlobalRadarEvent>;
  return radar.schema === "global_radar_v1" && typeof radar.eventId === "string"
    ? (radar as GlobalRadarEvent)
    : null;
}

async function runSocialPipelineBounded(input: {
  readonly signals: Parameters<typeof runSocialPipeline>[0]["signals"];
  readonly agentRegistry: AgentRegistry;
  readonly timeoutMs: number;
}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`社交分析超过 ${input.timeoutMs}ms`));
  }, input.timeoutMs);
  timer.unref?.();

  const work = runSocialPipeline({
    signals: input.signals,
    runner: createRouteBackedSocialAgentRunner(input.agentRegistry, {
      abortSignal: controller.signal,
      callTimeoutMs: Math.min(input.timeoutMs, 120_000),
    }),
  });
  work.catch(() => undefined);

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error(`社交分析超过 ${input.timeoutMs}ms`)),
          { once: true },
        );
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`社交分析超过 ${input.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout|timed out|exceeded|超过/i.test(error.message);
}
