import type { AgentRegistry } from "../../agents/registry";
import { dispatchKanMessage } from "../../integrations/kan/client";
import { SOCIAL_FUSION_KAN_ROUTE_ID } from "../../integrations/kan/config";
import type { ToolRegistry } from "../../tools/registry";
import { SOCIAL_PLATFORM_CRAWLER_TOOLS } from "../../tools/crawler-tools";
import {
  CHINA_GATE_AGENT_ID,
  PLATFORM_AGENT_IDS,
  SOCIAL_CONTROL_AGENT_ID,
  SOCIAL_FUSION_AGENT_ID,
  buildFusionTask,
  buildPlatformReportTask,
  buildPlatformReflectionTask,
} from "./agents";
import {
  buildKeywordChinaGate,
  buildChinaRelevanceTask,
  isPoliticalSecurityThreat,
  parseAndNormalizeChinaGate,
  shouldAnalyzePlatform,
} from "./china-relevance";
import {
  buildSocialFusionDedupeFingerprint,
  buildSocialFusionDedupeKey,
} from "./dedupe";
import { deterministicFusion, sanitizeFusedSocialEvent } from "./fusion";
import { stableEventKey } from "./json";
import {
  parseFusedSocialEvent,
  parsePlatformReport,
  parsePlatformReflection,
  type FusedSocialEvent,
  type PlatformReport,
  type PlatformReflection,
} from "./schemas";
import {
  renderFusedEvent,
  renderPlatformReport,
  renderSocialFusionKanMessage,
} from "./renderers";
import { createRouteBackedSocialAgentRunner } from "./runner";
import {
  SOCIAL_PLATFORMS,
  type ChinaRelevanceResult,
  type LightweightSocialSignal,
  type SocialPlatform,
} from "./types";
import {
  appendSocialAgentStepLog,
  attachSocialEvidenceReport,
  insertSocialCandidateEvent,
  insertSocialPlatformEvidence,
  isSocialMonitorStopRequested,
  findRecentSocialKanDuplicate,
  updateSocialCandidateEvent,
  updateSocialMonitorRun,
  upsertSocialKanQueue,
  type SocialKanDuplicateMatch,
  type SocialEvidenceStatus,
  type SocialPlatformAgentState,
  type SocialPlatformAgentStateMap,
} from "../../store/social-monitor";
import {
  saveSocialPlatformReport,
  upsertSocialFusedEvent,
} from "../../store/social-events";
import { createLogger } from "../../logger";

const log = createLogger("social:autonomous-monitor");

const MAX_STORED_TEXT = 800;
const MAX_STORED_ARRAY = 8;
const MAX_EVIDENCE_CONTENT = 6000;
const DEFAULT_CYCLE_INTERVAL_SECONDS = 300;
const DEFAULT_RETENTION_DAYS = 30;
const SECONDS_PER_DAY = 86_400;
const RECENT_FUTURE_TOLERANCE_SECONDS = 7 * SECONDS_PER_DAY;

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  x: "X",
  telegram: "Telegram",
  lihkg: "LIHKG",
  facebook: "Facebook",
  github: "GitHub",
  instagram: "Instagram",
  lien: "Lien",
  netlight: "NetLight",
  ptt: "PTT",
  youtube: "YouTube",
};

const SECRET_KEY_PATTERN =
  /(?:api[-_]?key|access[-_]?token|refresh[-_]?token|bearer|cookie|password|passwd|secret|session[-_]?id|auth[-_]?token)/i;

export interface AutonomousSocialMonitorInput {
  readonly runId: string;
  readonly agentRegistry: AgentRegistry;
  readonly toolRegistry: ToolRegistry;
  readonly platforms?: readonly SocialPlatform[];
  readonly mode?: "probe" | "crawl";
  readonly limit?: number;
  readonly maxCandidates?: number;
  readonly continuous?: boolean;
  readonly cycleIntervalSeconds?: number;
  readonly retentionDays?: number;
  readonly analysisTimeoutMs?: number;
  readonly abortSignal?: AbortSignal;
}

interface ToolExecutionSummary {
  readonly platform: SocialPlatform;
  readonly toolName: string;
  readonly isError: boolean;
  readonly output: unknown;
  readonly qualityStatus: string;
  readonly recordCount: number;
  readonly rawRecordCount: number;
  readonly staleRecordCount: number;
  readonly undatedRecordCount: number;
  readonly samples: readonly unknown[];
  readonly evidenceItems: readonly NormalizedEvidenceItem[];
  readonly elapsedMs: number | null;
  readonly evidenceStatus: SocialEvidenceStatus;
}

interface NormalizedEvidenceItem {
  readonly type: string;
  readonly title: string;
  readonly content: string;
  readonly url?: string;
  readonly channelName?: string;
  readonly messageId?: string;
  readonly author?: string;
  readonly sourceName?: string;
  readonly publishedAt?: string | number;
  readonly metrics?: Record<string, number>;
  readonly hasContentBody?: boolean;
}

interface CandidateDraft {
  readonly platform: SocialPlatform;
  readonly title: string;
  readonly summary: string;
  readonly observedAt: number;
  readonly raw: unknown;
}

interface PersistedCandidateDraft {
  readonly candidateId: string;
  readonly eventKey: string;
  readonly draft: CandidateDraft;
}

interface EvidenceBundle {
  readonly evidenceId: string;
  readonly signal: LightweightSocialSignal;
  readonly status: SocialEvidenceStatus;
}

class StopRequestedError extends Error {
  constructor() {
    super("social monitor stop requested");
  }
}

function createInitialPlatformStates(
  platforms: readonly SocialPlatform[],
): SocialPlatformAgentStateMap {
  const states: SocialPlatformAgentStateMap = {};
  for (const platform of platforms) {
    states[platform] = defaultPlatformState(platform);
  }
  return states;
}

function defaultPlatformState(platform: SocialPlatform): SocialPlatformAgentState {
  return {
    platform,
    agentId: PLATFORM_AGENT_IDS[platform],
    cycle: 0,
    status: "idle",
    lastStep: "idle",
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    discoveredCount: 0,
    rawRecordCount: 0,
    evidenceCount: 0,
    skippedCount: 0,
    deepCrawlCount: 0,
    errorCount: 0,
    lastError: "",
    lastFindings: [],
    patternSummary: "尚未开始巡逻。",
    failureSummary: "",
    improvementPlan: "等待总控启动后，先执行本平台自主发现工具。",
    nextAction: "等待启动",
    reflectionSummary: "尚未形成自我复盘。",
    observedPatterns: [],
  };
}

function currentPlatformState(
  states: SocialPlatformAgentStateMap,
  platform: SocialPlatform,
): SocialPlatformAgentState {
  return states[platform] ?? defaultPlatformState(platform);
}

function updatePlatformState(
  states: SocialPlatformAgentStateMap,
  platform: SocialPlatform,
  patch: Partial<SocialPlatformAgentState>,
): SocialPlatformAgentStateMap {
  const previous = currentPlatformState(states, platform);
  return {
    ...states,
    [platform]: {
      ...previous,
      ...patch,
      lastFindings: patch.lastFindings
        ? [...patch.lastFindings].slice(0, MAX_STORED_ARRAY)
        : previous.lastFindings,
      observedPatterns: patch.observedPatterns
        ? [...patch.observedPatterns].slice(0, MAX_STORED_ARRAY)
        : previous.observedPatterns,
    },
  };
}

function toolFindingLines(
  platform: SocialPlatform,
  tool: ToolExecutionSummary,
): readonly string[] {
  if (tool.evidenceItems.length === 0) {
    return [evidenceSummary(platform, tool.evidenceStatus, tool.recordCount)];
  }
  return tool.evidenceItems.slice(0, 4).map((item, index) => {
    const pieces = [
      `${index + 1}. ${item.title || item.content || "未命名证据"}`,
      item.url ? `URL：${item.url}` : "",
      item.channelName ? `频道/节点：${item.channelName}` : "",
      item.publishedAt !== undefined ? `时间：${String(item.publishedAt)}` : "时间：爬虫未返回发布时间",
    ].filter(Boolean);
    return pieces.join("；");
  });
}

function summarizeToolPattern(
  platform: SocialPlatform,
  tool: ToolExecutionSummary,
  phase: "discover" | "search",
  retentionDays: number,
): string {
  const action = phase === "discover" ? "自主发现" : "同事件复核";
  if (tool.evidenceStatus === "found") {
    const timeNote =
      tool.undatedRecordCount > 0
        ? `其中 ${tool.undatedRecordCount} 条缺少发布时间，需要爬虫继续补齐时间字段。`
        : "返回证据带有可用于时间窗判断的字段。";
    return `${PLATFORM_LABELS[platform]} 本轮${action}返回 ${tool.recordCount} 条可核验证据，原始样本 ${tool.rawRecordCount} 条；${timeNote}`;
  }
  if (tool.staleRecordCount > 0) {
    return `${PLATFORM_LABELS[platform]} 本轮${action}有 ${tool.staleRecordCount} 条样本超过最近 ${retentionDays} 天窗口，已过滤。`;
  }
  if (tool.evidenceStatus === "missing_config") {
    return `${PLATFORM_LABELS[platform]} 配置不完整，暂时不能形成真实巡逻规律。`;
  }
  if (tool.evidenceStatus === "skipped") {
    return `${PLATFORM_LABELS[platform]} 当前爬虫缺少安全的一次性${action}入口，需要补工具能力。`;
  }
  if (tool.evidenceStatus === "error") {
    return `${PLATFORM_LABELS[platform]} 本轮${action}执行失败，需要检查网络、代理或账号配置。`;
  }
  return `${PLATFORM_LABELS[platform]} 本轮${action}没有最近 ${retentionDays} 天内的可核验证据。`;
}

function summarizeToolFailure(
  platform: SocialPlatform,
  tool: ToolExecutionSummary,
  phase: "discover" | "search",
  retentionDays: number,
): string {
  if (tool.evidenceStatus === "found") {
    if (tool.undatedRecordCount > 0) {
      return `有样本缺少发布时间，暂时只能作为弱证据；需要 ${PLATFORM_LABELS[platform]} 爬虫补齐发布时间或抓取时间。`;
    }
    return "";
  }
  if (tool.evidenceStatus === "missing_config") {
    return "平台账号、Cookie、Token 或环境配置不完整，不能真实爬取。";
  }
  if (tool.evidenceStatus === "error") {
    return "爬虫执行异常，优先检查代理端口、账号状态、平台限流和脚本报错。";
  }
  if (tool.evidenceStatus === "skipped") {
    return phase === "discover"
      ? "该平台还没有可被 Agent 调用的自主发现工具入口。"
      : "该平台还没有可被 Agent 调用的事件复核工具入口。";
  }
  if (tool.rawRecordCount > 0 && tool.recordCount === 0) {
    return `原始样本存在，但没有形成公开 URL/频道/正文/最近 ${retentionDays} 天时间窗内的可核验证据。`;
  }
  return "本轮未返回可核验的新内容。";
}

function improvementPlanForTool(
  platform: SocialPlatform,
  tool: ToolExecutionSummary,
  phase: "discover" | "search",
): string {
  if (tool.evidenceStatus === "found") {
    return phase === "discover"
      ? `${PLATFORM_LABELS[platform]} 继续观察相同节点和相似主题的增长速度；命中中国相关与风险门槛后交给总控复核。`
      : `${PLATFORM_LABELS[platform]} 把 URL、频道、正文、时间和传播指标交给平台报告与融合智能体，避免只返回状态。`;
  }
  if (tool.evidenceStatus === "missing_config") {
    return `${PLATFORM_LABELS[platform]} 补齐环境配置后再纳入强制真实爬取验收。`;
  }
  if (tool.evidenceStatus === "skipped") {
    return `${PLATFORM_LABELS[platform]} 需要补 discover_latest_events 或 search_event_evidence 工具入口。`;
  }
  if (tool.evidenceStatus === "error") {
    return `${PLATFORM_LABELS[platform]} 记录失败原因，下一轮先做小样本探测；若连续失败则暂停该平台并提示配置检查。`;
  }
  return `${PLATFORM_LABELS[platform]} 扩大最近一个月的热门/异常样本来源，优先保留公开链接、正文、发布时间和互动指标。`;
}

function nextActionForTool(
  platform: SocialPlatform,
  tool: ToolExecutionSummary,
  phase: "discover" | "search",
): string {
  if (tool.evidenceStatus === "found") {
    return phase === "discover"
      ? "送入中国相关性与风险判断"
      : "送入平台报告与社交融合";
  }
  if (tool.evidenceStatus === "missing_config") return "等待配置补齐";
  if (tool.evidenceStatus === "error") return "下一轮重试并保留失败总结";
  if (tool.evidenceStatus === "skipped") return "等待补充可调用工具入口";
  return `继续监听 ${PLATFORM_LABELS[platform]} 的最新高热内容`;
}

function fallbackReflectionForTool(
  platform: SocialPlatform,
  tool: ToolExecutionSummary,
  phase: "discover" | "search",
  retentionDays: number,
): PlatformReflection {
  return {
    schema: "platform_agent_reflection_v1",
    platform,
    phase,
    status: tool.evidenceStatus,
    reflection_summary: summarizeToolPattern(platform, tool, phase, retentionDays),
    observed_patterns: reflectionPatternsForTool(platform, tool, phase, retentionDays),
    failure_causes: summarizeToolFailure(platform, tool, phase, retentionDays)
      ? [summarizeToolFailure(platform, tool, phase, retentionDays)]
      : [],
    improvement_plan: improvementPlanForTool(platform, tool, phase),
    next_action: nextActionForTool(platform, tool, phase),
    confidence: tool.evidenceStatus === "found" ? 0.75 : 0.55,
  };
}

function fallbackReflectionForGate(
  platform: SocialPlatform,
  gate: ChinaRelevanceResult,
): PlatformReflection {
  const passed = shouldAnalyzePlatform(gate);
  return {
    schema: "platform_agent_reflection_v1",
    platform,
    phase: "china_gate",
    status: passed ? "relevant" : "skipped",
    reflection_summary: summarizeGatePattern(platform, gate),
    observed_patterns: [
      gate.is_china_related
        ? `中国相关性得分 ${Math.round(gate.score * 100)}。`
        : "本候选未达到中国相关门槛。",
      gate.threat_to_china_security || gate.negative_to_china
        ? `风险得分 ${Math.round(gate.risk_score * 100)}。`
        : "本候选未达到威胁/负面风险门槛。",
      ...gate.risk_categories
        .filter((item) => item !== "none")
        .map((item) => `风险类型：${item}`),
    ].slice(0, MAX_STORED_ARRAY),
    failure_causes: passed
      ? []
      : [`本候选没有同时满足中国相关和风险门槛：${gate.reason}`],
    improvement_plan: passed
      ? "围绕该候选提取实体、URL、节点和时间线，通知其他平台复核同一事件。"
      : "继续扩大本平台最近一个月内的异常传播样本，优先保留带正文、URL、时间和风险证据的内容。",
    next_action: passed ? "进入跨平台复核" : "跳过深挖，下一轮继续自主巡逻",
    confidence: passed ? 0.8 : 0.65,
  };
}

function reflectionPatternsForTool(
  platform: SocialPlatform,
  tool: ToolExecutionSummary,
  phase: "discover" | "search",
  retentionDays: number,
): string[] {
  const action = phase === "discover" ? "自主发现" : "同事件复核";
  const patterns = [
    `${PLATFORM_LABELS[platform]} 本轮${action}原始返回 ${tool.rawRecordCount} 条。`,
  ];
  if (tool.recordCount > 0) patterns.push(`形成 ${tool.recordCount} 条最近 ${retentionDays} 天内的可核验证据。`);
  if (tool.staleRecordCount > 0) patterns.push(`${tool.staleRecordCount} 条超过最近 ${retentionDays} 天窗口，已过滤。`);
  if (tool.undatedRecordCount > 0) patterns.push(`${tool.undatedRecordCount} 条缺少发布时间，需要补齐时间字段。`);
  if (tool.evidenceStatus === "not_found") patterns.push("没有匹配到公开 URL、频道、正文或消息 ID 级别的证据。");
  if (tool.evidenceStatus === "missing_config") patterns.push("平台配置未就绪，不能形成真实抓取结论。");
  if (tool.evidenceStatus === "error") patterns.push("工具执行异常，下一轮需要优先复查网络、代理、账号和脚本状态。");
  return patterns.slice(0, MAX_STORED_ARRAY);
}

async function runPlatformReflection(input: {
  readonly runId: string;
  readonly runner: ReturnType<typeof createRouteBackedSocialAgentRunner>;
  readonly platform: SocialPlatform;
  readonly phase: "discover" | "search" | "china_gate";
  readonly status: string;
  readonly previousState: SocialPlatformAgentState;
  readonly retentionDays: number;
  readonly fallback: PlatformReflection;
  readonly tool?: ToolExecutionSummary;
  readonly gate?: ChinaRelevanceResult;
  readonly findings?: readonly string[];
}): Promise<PlatformReflection> {
  if (!shouldUseModelReflection(input.tool, input.status, input.phase)) {
    await step(
      input.runId,
      PLATFORM_AGENT_IDS[input.platform],
      "self_reflection",
      "completed",
      `${PLATFORM_LABELS[input.platform]} 已根据工具结果完成自我复盘`,
      { reflection: compactReflection(input.fallback) },
    );
    return input.fallback;
  }

  try {
    const text = await input.runner.run({
      agentId: PLATFORM_AGENT_IDS[input.platform],
      routeKey: "social.platform",
      task: buildPlatformReflectionTask({
        platform: input.platform,
        phase: input.phase,
        status: input.status,
        previousState: compactPlatformState(input.previousState),
        retentionDays: input.retentionDays,
        toolSummary: input.tool ? compactToolForReflection(input.tool) : undefined,
        gate: input.gate,
        findings: input.findings,
      }),
    });
    const reflection = normalizePlatformReflection(
      parsePlatformReflection(text),
      input.fallback,
      input.platform,
      input.phase,
      input.status,
    );
    await step(
      input.runId,
      PLATFORM_AGENT_IDS[input.platform],
      "self_reflection",
      "completed",
      `${PLATFORM_LABELS[input.platform]} 自我复盘已更新`,
      { reflection: compactReflection(reflection) },
    );
    return reflection;
  } catch (error) {
    await step(
      input.runId,
      PLATFORM_AGENT_IDS[input.platform],
      "self_reflection",
      "fallback",
      `${PLATFORM_LABELS[input.platform]} 自我复盘未返回合规 JSON，已使用确定性复盘：${errorMessage(error)}`,
      { reflection: compactReflection(input.fallback) },
    );
    return input.fallback;
  }
}

function shouldUseModelReflection(
  tool: ToolExecutionSummary | undefined,
  status: string,
  phase: "discover" | "search" | "china_gate",
): boolean {
  if (phase === "china_gate") return false;
  if (!tool) return status === "relevant" || status === "skipped";
  if (tool.evidenceStatus === "missing_config" || tool.evidenceStatus === "skipped") return false;
  if (tool.evidenceStatus === "found" || tool.evidenceStatus === "error") return true;
  return tool.rawRecordCount > 0 || tool.staleRecordCount > 0 || tool.undatedRecordCount > 0;
}

function normalizePlatformReflection(
  reflection: PlatformReflection,
  fallback: PlatformReflection,
  platform: SocialPlatform,
  phase: "discover" | "search" | "china_gate",
  status: string,
): PlatformReflection {
  const summary = cleanReflectionText(reflection.reflection_summary) || fallback.reflection_summary;
  return {
    schema: "platform_agent_reflection_v1",
    platform,
    phase,
    status,
    reflection_summary: truncate(summary, 600),
    observed_patterns: cleanReflectionList(reflection.observed_patterns, fallback.observed_patterns),
    failure_causes: cleanReflectionList(reflection.failure_causes, fallback.failure_causes),
    improvement_plan:
      truncate(cleanReflectionText(reflection.improvement_plan), 600) ||
      fallback.improvement_plan,
    next_action:
      truncate(cleanReflectionText(reflection.next_action), 300) ||
      fallback.next_action,
    confidence: Math.max(0, Math.min(reflection.confidence ?? fallback.confidence, 1)),
  };
}

function reflectionStatePatch(
  reflection: PlatformReflection,
): Partial<SocialPlatformAgentState> {
  return {
    reflectionSummary: reflection.reflection_summary,
    observedPatterns: reflection.observed_patterns,
    failureSummary: reflection.failure_causes.join("；"),
    improvementPlan: reflection.improvement_plan,
    nextAction: reflection.next_action,
  };
}

function cleanReflectionList(
  items: readonly string[],
  fallback: readonly string[],
): string[] {
  const cleaned = items
    .map((item) => truncate(cleanReflectionText(item), 400))
    .filter(Boolean)
    .slice(0, MAX_STORED_ARRAY);
  return cleaned.length > 0 ? cleaned : [...fallback];
}

function cleanReflectionText(text: string): string {
  return redactLocalPathLiterals(text).replace(/\s+/g, " ").trim();
}

function compactToolForReflection(tool: ToolExecutionSummary): Record<string, unknown> {
  return {
    platform: tool.platform,
    toolName: tool.toolName,
    qualityStatus: tool.qualityStatus,
    evidenceStatus: tool.evidenceStatus,
    recordCount: tool.recordCount,
    rawRecordCount: tool.rawRecordCount,
    staleRecordCount: tool.staleRecordCount,
    undatedRecordCount: tool.undatedRecordCount,
    evidenceItems: tool.evidenceItems.slice(0, 5).map((item) => compactValue(item)),
    elapsedMs: tool.elapsedMs,
  };
}

function compactPlatformState(state: SocialPlatformAgentState): Record<string, unknown> {
  return {
    platform: state.platform,
    agentId: state.agentId,
    cycle: state.cycle,
    status: state.status,
    lastStep: state.lastStep,
    discoveredCount: state.discoveredCount,
    rawRecordCount: state.rawRecordCount,
    evidenceCount: state.evidenceCount,
    skippedCount: state.skippedCount,
    deepCrawlCount: state.deepCrawlCount,
    errorCount: state.errorCount,
    lastFindings: state.lastFindings,
    patternSummary: state.patternSummary,
    failureSummary: state.failureSummary,
    improvementPlan: state.improvementPlan,
    nextAction: state.nextAction,
    reflectionSummary: state.reflectionSummary,
    observedPatterns: state.observedPatterns,
  };
}

function compactReflection(reflection: PlatformReflection): Record<string, unknown> {
  return {
    platform: reflection.platform,
    phase: reflection.phase,
    status: reflection.status,
    reflection_summary: reflection.reflection_summary,
    observed_patterns: reflection.observed_patterns,
    failure_causes: reflection.failure_causes,
    improvement_plan: reflection.improvement_plan,
    next_action: reflection.next_action,
    confidence: reflection.confidence,
  };
}

export async function runAutonomousSocialMonitor(
  input: AutonomousSocialMonitorInput,
): Promise<void> {
  const platforms = input.platforms?.length ? input.platforms : SOCIAL_PLATFORMS;
  const mode = input.mode ?? "probe";
  const limit = Math.max(1, Math.min(input.limit ?? 3, 10));
  const maxCandidates = Math.max(1, Math.min(input.maxCandidates ?? 10, 50));
  const continuous = Boolean(input.continuous);
  const cycleIntervalSeconds = Math.max(
    10,
    Math.min(input.cycleIntervalSeconds ?? DEFAULT_CYCLE_INTERVAL_SECONDS, 86_400),
  );
  const retentionDays = Math.max(
    1,
    Math.min(input.retentionDays ?? DEFAULT_RETENTION_DAYS, 31),
  );
  let platformStates = createInitialPlatformStates(platforms);
  const runner = createRouteBackedSocialAgentRunner(input.agentRegistry, {
    abortSignal: input.abortSignal,
    callTimeoutMs: Math.min(input.analysisTimeoutMs ?? 120_000, 180_000),
  });

  try {
    await step(input.runId, SOCIAL_CONTROL_AGENT_ID, "start", "running", "启动自主社交巡逻", {
      platforms,
      mode,
      limit,
      maxCandidates,
      continuous,
      cycleIntervalSeconds,
      retentionDays,
      kanPush: "threshold-gated",
    });

    await updateSocialMonitorRun({
      id: input.runId,
      currentStep: continuous ? "持续巡逻已启动" : "平台发现智能体正在巡逻",
      currentCycle: 1,
      platformStates,
    });

    let cycle = 1;

    while (true) {
      await assertNotStopped(input.runId, input.abortSignal);
      const cycleStartedAt = Math.floor(Date.now() / 1000);
      await updateSocialMonitorRun({
        id: input.runId,
        currentStep: `第 ${cycle} 轮：平台智能体正在各自平台实时巡逻`,
        currentCycle: cycle,
        lastCycleStartedAt: cycleStartedAt,
        platformStates,
      });
      await step(
        input.runId,
        SOCIAL_CONTROL_AGENT_ID,
        "cycle_start",
        "running",
        `第 ${cycle} 轮巡逻开始`,
        { cycle, platforms, retentionDays, maxCandidates },
      );

      const discovery = await discoverCandidateEvents({
        runId: input.runId,
        toolRegistry: input.toolRegistry,
        runner,
        platforms,
        mode,
        limit,
        retentionDays,
        cycle,
        platformStates,
        abortSignal: input.abortSignal,
      });
      platformStates = discovery.platformStates;
      const drafts = discovery.drafts;

      if (drafts.length === 0) {
        await step(
          input.runId,
          SOCIAL_CONTROL_AGENT_ID,
          "candidate_pool",
          "completed",
          `第 ${cycle} 轮没有形成可进入判断的候选事件`,
          { cycle, retentionDays },
        );
        await updateSocialMonitorRun({
          id: input.runId,
          currentStep: continuous
            ? `第 ${cycle} 轮未发现可判断候选，等待下一轮`
            : "未发现可进入判断的候选事件",
          platformStates,
        });
        if (!continuous) {
          await completeRun(input.runId, "未发现可进入判断的候选事件");
          return;
        }
        await waitForNextCycle(input.runId, input.abortSignal, cycleIntervalSeconds, cycle);
        cycle += 1;
        continue;
      }

      await step(
        input.runId,
        SOCIAL_CONTROL_AGENT_ID,
        "candidate_pool",
        "completed",
        `第 ${cycle} 轮形成 ${drafts.length} 个候选事件；全部先做中国相关性与风险判断，最多深挖 ${maxCandidates} 个`,
        { cycle, candidateCount: drafts.length, deepDiveLimit: maxCandidates },
      );

      const persistedCandidates: PersistedCandidateDraft[] = [];
      for (const draft of drafts) {
        await assertNotStopped(input.runId, input.abortSignal);
        const candidateId = crypto.randomUUID();
        const eventKey = stableEventKey(draft.title);

        await insertSocialCandidateEvent({
          id: candidateId,
          runId: input.runId,
          sourcePlatform: draft.platform,
          eventKey,
          title: draft.title,
          summary: draft.summary,
          discoveredAt: draft.observedAt,
          raw: compactValue(draft.raw),
        });
        persistedCandidates.push({ candidateId, eventKey, draft });
      }

      let deepDiveCount = 0;
      for (const persistedCandidate of persistedCandidates) {
        await assertNotStopped(input.runId, input.abortSignal);
        const { candidateId, eventKey, draft } = persistedCandidate;
        await updateSocialMonitorRun({
          id: input.runId,
          currentStep: `第 ${cycle} 轮：中国相关性与风险判断：${draft.title}`,
        });

        const gateEvidenceItems = candidateEvidenceItems(draft.raw);
        const gateEvidenceUrls = [
          ...gateEvidenceItems
            .map((item) => item.url)
            .filter((url): url is string => Boolean(url)),
          ...extractUrls(draft.raw),
        ].filter((url, index, urls) => urls.indexOf(url) === index);

        const gate = await runChinaGate({
          runId: input.runId,
          runner,
          signal: {
            id: candidateId,
            platform: draft.platform,
            title: draft.title,
            summary: draft.summary,
            observedAt: draft.observedAt,
            evidence: buildEvidenceLines(draft.platform, {
              status: "found",
              items: gateEvidenceItems,
              urls: gateEvidenceUrls,
              nodes: extractNodeNames(draft.raw),
              recordCount: 1,
            }),
            raw: compactValue(draft.raw),
          },
        });

        const candidateStatus = shouldAnalyzePlatform(gate) ? "relevant" : "skipped";
        await updateSocialCandidateEvent({
          id: candidateId,
          status: candidateStatus,
          chinaRelevance: gate,
        });
        const gateReflection = fallbackReflectionForGate(draft.platform, gate);
        platformStates = updatePlatformState(platformStates, draft.platform, {
          cycle,
          status: candidateStatus === "relevant" ? "watching" : "skipped",
          lastStep: "china_gate",
          skippedCount: shouldAnalyzePlatform(gate)
            ? currentPlatformState(platformStates, draft.platform).skippedCount
            : currentPlatformState(platformStates, draft.platform).skippedCount + 1,
          deepCrawlCount: shouldAnalyzePlatform(gate)
            ? currentPlatformState(platformStates, draft.platform).deepCrawlCount + 1
            : currentPlatformState(platformStates, draft.platform).deepCrawlCount,
          patternSummary: summarizeGatePattern(draft.platform, gate),
          lastError: "",
          lastFindings: [
            `候选：${draft.title}`,
            ...gateEvidenceUrls.slice(0, 2).map((url) => `URL：${url}`),
            `中国相关：${gate.is_china_related ? "是" : "否"}；分数：${Math.round(gate.score * 100)}`,
            `风险分：${Math.round(gate.risk_score * 100)}；动作：${gate.recommended_action}`,
          ].slice(0, MAX_STORED_ARRAY),
          failureSummary: shouldAnalyzePlatform(gate)
            ? ""
            : `本候选没有同时满足中国相关和风险门槛：${gate.reason}`,
          improvementPlan: shouldAnalyzePlatform(gate)
            ? "围绕该候选提取实体、URL、节点和时间线，通知其他平台复核同一事件。"
            : "继续扩大本平台最近一个月内的异常传播样本，优先保留带正文、URL、时间和风险证据的内容。",
          nextAction: shouldAnalyzePlatform(gate)
            ? "进入跨平台复核"
            : "跳过深挖，下一轮继续自主巡逻",
          reflectionSummary: gateReflection.reflection_summary,
          observedPatterns: gateReflection.observed_patterns,
        });
        await updateSocialMonitorRun({ id: input.runId, platformStates });

        const reflection = await runPlatformReflection({
          runId: input.runId,
          runner,
          platform: draft.platform,
          phase: "china_gate",
          status: candidateStatus,
          previousState: currentPlatformState(platformStates, draft.platform),
          retentionDays,
          fallback: gateReflection,
          gate,
          findings: [
            draft.title,
            draft.summary,
            ...gate.evidence,
            ...gate.risk_evidence,
          ],
        });
        platformStates = updatePlatformState(
          platformStates,
          draft.platform,
          reflectionStatePatch(reflection),
        );
        await updateSocialMonitorRun({ id: input.runId, platformStates });

        if (!shouldAnalyzePlatform(gate)) {
          await step(
            input.runId,
            CHINA_GATE_AGENT_ID,
            "china_gate",
            "skipped",
            `候选事件未同时通过中国相关性与风险门槛：${draft.title}`,
            { gate },
          );
          continue;
        }

        if (deepDiveCount >= maxCandidates) {
          platformStates = updatePlatformState(platformStates, draft.platform, {
            cycle,
            status: "watching",
            lastStep: "deep_dive_limit",
            improvementPlan: "该候选已通过门槛，但本轮深挖名额已满；下一轮优先复核或人工提高深挖上限。",
            nextAction: "等待后续深挖名额",
          });
          await updateSocialMonitorRun({ id: input.runId, platformStates });
          await step(
            input.runId,
            SOCIAL_CONTROL_AGENT_ID,
            "deep_dive_limit",
            "held",
            `候选事件已通过门槛，但本轮深挖上限已满：${draft.title}`,
            { eventKey, title: draft.title, deepDiveLimit: maxCandidates },
          );
          continue;
        }

        deepDiveCount += 1;
        await updateSocialMonitorRun({
          id: input.runId,
          currentStep: `第 ${cycle} 轮：社交总控正在分发跨平台复核：${draft.title}`,
        });

        await step(
          input.runId,
          SOCIAL_CONTROL_AGENT_ID,
          "dispatch",
          "running",
          "通知其他平台智能体复核同一事件",
          { eventKey, title: draft.title, platforms },
        );

        const evidenceResult = await searchCrossPlatformEvidence({
          runId: input.runId,
          candidateId,
          candidate: draft,
          platforms,
          mode,
          limit,
          retentionDays,
          cycle,
          toolRegistry: input.toolRegistry,
          runner,
          platformStates,
          abortSignal: input.abortSignal,
        });
        platformStates = evidenceResult.platformStates;

        await updateSocialCandidateEvent({
          id: candidateId,
          status: "deep_crawled",
        });

        const reports = await analyzePlatformEvidence({
          runId: input.runId,
          runner,
          gate,
          evidenceBundles: evidenceResult.bundles,
          abortSignal: input.abortSignal,
        });

        if (reports.length === 0) {
          await step(
            input.runId,
            SOCIAL_FUSION_AGENT_ID,
            "fusion",
            "skipped",
            "没有可融合的平台证据报告",
          );
          continue;
        }

        const fused = await fuseReports({
          runId: input.runId,
          runner,
          reports,
          abortSignal: input.abortSignal,
        });
        const renderedFusion = renderFusedEvent(fused);

        await upsertSocialFusedEvent({
          id: crypto.randomUUID(),
          event: fused,
          renderedText: renderedFusion,
        });

        const dedupeFingerprint = buildSocialFusionDedupeFingerprint({
          fused,
          reports,
          evidenceBundles: evidenceResult.bundles,
        });
        const dedupeKey = buildSocialFusionDedupeKey(dedupeFingerprint, fused.event_key);
        const kanDecision = buildKanDecision(fused, reports);
        const duplicateMatch = kanDecision.shouldQueue
          ? await findRecentSocialKanDuplicate({
              fusedEventKey: fused.event_key,
              dedupeKey,
              dedupeFingerprint,
              lookbackSeconds: retentionDays * SECONDS_PER_DAY,
            })
          : null;
        if (duplicateMatch) {
          await step(
            input.runId,
            SOCIAL_FUSION_AGENT_ID,
            "kan_dedupe",
            "skipped",
            `重复事件已过滤：与历史 Kan 推送 ${duplicateMatch.queue.id} 相同或高度相似`,
            {
              matchedBy: duplicateMatch.matchedBy,
              score: duplicateMatch.comparison.score,
              reasons: duplicateMatch.comparison.reasons,
              duplicateOfQueueId: duplicateMatch.queue.id,
            },
          );
        }
        const kanMessage = renderSocialFusionKanMessage({
          event: fused,
          platformReports: reports,
          decisionReason: kanDecision.reason,
        });
        const kanDelivery = kanDecision.shouldQueue && !duplicateMatch
          ? await dispatchSocialFusionKanMessage(kanMessage, fused, dedupeKey)
          : null;
        const kanQueueStatus = duplicateMatch
          ? "skipped"
          : kanDecision.shouldQueue
          ? kanDelivery?.ok
            ? "sent"
            : "pending"
          : "held";
        const kanQueueReason =
          duplicateMatch
            ? duplicateReason(duplicateMatch)
            : kanDelivery?.ok || !kanDecision.shouldQueue
            ? kanDecision.reason
            : `${kanDecision.reason}；真实推送失败：${kanDelivery?.error ?? "社交融合 Kan 路由未配置完整"}`;
        const kanDecisionWithDedupe = {
          ...kanDecision,
          dedupe: {
            key: dedupeKey,
            duplicate: Boolean(duplicateMatch),
            matchedBy: duplicateMatch?.matchedBy ?? null,
            duplicateOfQueueId: duplicateMatch?.queue.id ?? null,
            score: duplicateMatch?.comparison.score ?? null,
            reasons: duplicateMatch?.comparison.reasons ?? [],
          },
        };
        await updateSocialMonitorRun({
          id: input.runId,
          currentStep: "融合完成，等待 Kan 推送阈值判断",
          fusion: fused,
          renderedFusionText: renderedFusion,
          kanDecision: kanDecisionWithDedupe,
          platformStates,
        });
        await upsertSocialKanQueue({
          id: crypto.randomUUID(),
          runId: input.runId,
          fusedEventKey: fused.event_key,
          dedupeKey,
          dedupeFingerprint,
          duplicateOfQueueId: duplicateMatch?.queue.id ?? null,
          status: kanQueueStatus,
          reason: kanQueueReason,
          payload: {
            dryRun: false,
            event: fused,
            platformReports: reports,
            platformEvidence: evidenceResult.bundles.map((bundle) => ({
              platform: bundle.signal.platform,
              status: bundle.status,
              title: bundle.signal.title,
              evidence: bundle.signal.raw,
              evidenceLines: bundle.signal.evidence,
            })),
            message: kanMessage,
            decision: kanDecisionWithDedupe,
            delivery: kanDelivery,
            routeId: SOCIAL_FUSION_KAN_ROUTE_ID,
            dedupe: {
              key: dedupeKey,
              fingerprint: dedupeFingerprint,
              duplicate: Boolean(duplicateMatch),
              matchedBy: duplicateMatch?.matchedBy ?? null,
              duplicateOfQueueId: duplicateMatch?.queue.id ?? null,
              score: duplicateMatch?.comparison.score ?? null,
              reasons: duplicateMatch?.comparison.reasons ?? [],
              commonUrls: duplicateMatch?.comparison.commonUrls ?? [],
              commonNodes: duplicateMatch?.comparison.commonNodes ?? [],
              commonTitleTokens: duplicateMatch?.comparison.commonTitleTokens ?? [],
            },
          },
        });

        await updateSocialCandidateEvent({ id: candidateId, status: "fused" });
      }

      const cycleCompletedAt = Math.floor(Date.now() / 1000);
      await step(
        input.runId,
        SOCIAL_CONTROL_AGENT_ID,
        "cycle_complete",
        "completed",
        `第 ${cycle} 轮巡逻完成`,
        { cycle, nextCycleInSeconds: continuous ? cycleIntervalSeconds : null },
      );
      await updateSocialMonitorRun({
        id: input.runId,
        currentStep: continuous
          ? `第 ${cycle} 轮完成，等待下一轮巡逻`
          : "自主社交巡逻完成",
        platformStates,
        lastCycleCompletedAt: cycleCompletedAt,
      });

      if (!continuous) break;
      await waitForNextCycle(input.runId, input.abortSignal, cycleIntervalSeconds, cycle);
      cycle += 1;
    }

    await completeRun(input.runId, "自主社交巡逻完成");
  } catch (error) {
    const stopped =
      error instanceof StopRequestedError ||
      input.abortSignal?.aborted ||
      (await isSocialMonitorStopRequested(input.runId).catch(() => false));

    if (stopped) {
      await step(
        input.runId,
        SOCIAL_CONTROL_AGENT_ID,
        "stop",
        "stopped",
        "智能体已停止",
      ).catch(() => undefined);
      await updateSocialMonitorRun({
        id: input.runId,
        status: "stopped",
        currentStep: "智能体已停止",
        stoppedAt: Math.floor(Date.now() / 1000),
      }).catch(() => undefined);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    log.error("Autonomous social monitor failed", { runId: input.runId, error: message });
    await step(
      input.runId,
      SOCIAL_CONTROL_AGENT_ID,
      "failed",
      "error",
      message,
    ).catch(() => undefined);
    await updateSocialMonitorRun({
      id: input.runId,
      status: "failed",
      currentStep: "自主社交巡逻失败",
      error: message,
      stoppedAt: Math.floor(Date.now() / 1000),
    }).catch(() => undefined);
  }
}

async function discoverCandidateEvents(input: {
  readonly runId: string;
  readonly toolRegistry: ToolRegistry;
  readonly runner: ReturnType<typeof createRouteBackedSocialAgentRunner>;
  readonly platforms: readonly SocialPlatform[];
  readonly mode: "probe" | "crawl";
  readonly limit: number;
  readonly retentionDays: number;
  readonly cycle: number;
  readonly platformStates: SocialPlatformAgentStateMap;
  readonly abortSignal?: AbortSignal;
}): Promise<{
  readonly drafts: readonly CandidateDraft[];
  readonly platformStates: SocialPlatformAgentStateMap;
}> {
  const drafts: CandidateDraft[] = [];
  const seen = new Set<string>();
  let platformStates = input.platformStates;

  for (const platform of input.platforms) {
    await assertNotStopped(input.runId, input.abortSignal);
    platformStates = updatePlatformState(platformStates, platform, {
      cycle: input.cycle,
      status: "running",
      lastStep: "discover_latest_events",
      lastCheckedAt: Math.floor(Date.now() / 1000),
      nextAction: "正在自主发现最近一个月内的最新、热门或异常内容",
    });
    await updateSocialMonitorRun({ id: input.runId, platformStates });

    await step(
      input.runId,
      PLATFORM_AGENT_IDS[platform],
      "discover_latest_events",
      "running",
      `${PLATFORM_LABELS[platform]} 正在发现最新/热门/异常事件`,
    );

    const tool = await runCrawlerTool({
      toolRegistry: input.toolRegistry,
      platform,
      mode: input.mode,
      limit: input.limit,
      retentionDays: input.retentionDays,
      phase: "discover",
    });
    const previous = currentPlatformState(platformStates, platform);
    const now = Math.floor(Date.now() / 1000);
    const fallbackReflection = fallbackReflectionForTool(
      platform,
      tool,
      "discover",
      input.retentionDays,
    );
    platformStates = updatePlatformState(platformStates, platform, {
      cycle: input.cycle,
      status: tool.evidenceStatus,
      lastStep: "discover_latest_events",
      lastCheckedAt: now,
      lastSuccessAt: tool.evidenceStatus === "error" ? previous.lastSuccessAt : now,
      lastFailureAt:
        tool.evidenceStatus === "error" || tool.evidenceStatus === "missing_config"
          ? now
          : previous.lastFailureAt,
      discoveredCount: previous.discoveredCount + tool.evidenceItems.length,
      rawRecordCount: previous.rawRecordCount + tool.rawRecordCount,
      evidenceCount: previous.evidenceCount + tool.evidenceItems.length,
      errorCount: previous.errorCount + (tool.evidenceStatus === "error" ? 1 : 0),
      lastError: tool.evidenceStatus === "error" ? evidenceSummary(platform, tool.evidenceStatus, tool.recordCount) : "",
      lastFindings: toolFindingLines(platform, tool),
      patternSummary: summarizeToolPattern(platform, tool, "discover", input.retentionDays),
      failureSummary: summarizeToolFailure(platform, tool, "discover", input.retentionDays),
      improvementPlan: improvementPlanForTool(platform, tool, "discover"),
      nextAction: nextActionForTool(platform, tool, "discover"),
      reflectionSummary: fallbackReflection.reflection_summary,
      observedPatterns: fallbackReflection.observed_patterns,
    });
    await updateSocialMonitorRun({ id: input.runId, platformStates });

    await step(
      input.runId,
      PLATFORM_AGENT_IDS[platform],
      "discover_latest_events",
      tool.evidenceStatus === "found" ? "found" : tool.evidenceStatus,
      discoveryStatusMessage(platform, tool),
      toolLogData(tool),
    );

    const reflection = await runPlatformReflection({
      runId: input.runId,
      runner: input.runner,
      platform,
      phase: "discover",
      status: tool.evidenceStatus,
      previousState: currentPlatformState(platformStates, platform),
      retentionDays: input.retentionDays,
      fallback: fallbackReflection,
      tool,
      findings: toolFindingLines(platform, tool),
    });
    platformStates = updatePlatformState(platformStates, platform, reflectionStatePatch(reflection));
    await updateSocialMonitorRun({ id: input.runId, platformStates });

    if (tool.evidenceStatus !== "found") continue;

    for (const item of tool.evidenceItems) {
      const draft = candidateFromEvidenceItem(platform, item);
      const key = stableEventKey(draft.title);
      if (seen.has(key)) continue;
      seen.add(key);
      drafts.push(draft);
    }
  }

  return { drafts, platformStates };
}

async function searchCrossPlatformEvidence(input: {
  readonly runId: string;
  readonly candidateId: string;
  readonly candidate: CandidateDraft;
  readonly platforms: readonly SocialPlatform[];
  readonly mode: "probe" | "crawl";
  readonly limit: number;
  readonly retentionDays: number;
  readonly cycle: number;
  readonly toolRegistry: ToolRegistry;
  readonly runner: ReturnType<typeof createRouteBackedSocialAgentRunner>;
  readonly platformStates: SocialPlatformAgentStateMap;
  readonly abortSignal?: AbortSignal;
}): Promise<{
  readonly bundles: readonly EvidenceBundle[];
  readonly platformStates: SocialPlatformAgentStateMap;
}> {
  const bundles: EvidenceBundle[] = [];
  let platformStates = input.platformStates;

  for (const platform of input.platforms) {
    await assertNotStopped(input.runId, input.abortSignal);
    platformStates = updatePlatformState(platformStates, platform, {
      cycle: input.cycle,
      status: "running",
      lastStep: "search_event_evidence",
      lastCheckedAt: Math.floor(Date.now() / 1000),
      nextAction: `正在复核同一事件：${input.candidate.title}`,
    });
    await updateSocialMonitorRun({ id: input.runId, platformStates });

    await updateSocialMonitorRun({
      id: input.runId,
      currentStep: `${PLATFORM_LABELS[platform]} 正在复核同一事件`,
    });

    const tool = await runCrawlerTool({
      toolRegistry: input.toolRegistry,
      platform,
      mode: input.mode,
      eventTitle: input.candidate.title,
      limit: input.limit,
      retentionDays: input.retentionDays,
      phase: "search",
    });
    const previous = currentPlatformState(platformStates, platform);
    const now = Math.floor(Date.now() / 1000);
    const fallbackReflection = fallbackReflectionForTool(
      platform,
      tool,
      "search",
      input.retentionDays,
    );
    platformStates = updatePlatformState(platformStates, platform, {
      cycle: input.cycle,
      status: tool.evidenceStatus,
      lastStep: "search_event_evidence",
      lastCheckedAt: now,
      lastSuccessAt: tool.evidenceStatus === "error" ? previous.lastSuccessAt : now,
      lastFailureAt:
        tool.evidenceStatus === "error" || tool.evidenceStatus === "missing_config"
          ? now
          : previous.lastFailureAt,
      rawRecordCount: previous.rawRecordCount + tool.rawRecordCount,
      evidenceCount: previous.evidenceCount + tool.evidenceItems.length,
      errorCount: previous.errorCount + (tool.evidenceStatus === "error" ? 1 : 0),
      lastError: tool.evidenceStatus === "error" ? evidenceSummary(platform, tool.evidenceStatus, tool.recordCount) : "",
      lastFindings: toolFindingLines(platform, tool),
      patternSummary: summarizeToolPattern(platform, tool, "search", input.retentionDays),
      failureSummary: summarizeToolFailure(platform, tool, "search", input.retentionDays),
      improvementPlan: improvementPlanForTool(platform, tool, "search"),
      nextAction: nextActionForTool(platform, tool, "search"),
      reflectionSummary: fallbackReflection.reflection_summary,
      observedPatterns: fallbackReflection.observed_patterns,
    });
    await updateSocialMonitorRun({ id: input.runId, platformStates });

    const urls = evidenceUrls(tool.evidenceItems);
    const nodes = evidenceNodeNames(tool.evidenceItems);
    const evidenceLines = buildEvidenceLines(platform, {
      status: tool.evidenceStatus,
      items: tool.evidenceItems,
      urls,
      nodes,
      recordCount: tool.recordCount,
    });
    const signal: LightweightSocialSignal = {
      id: `${input.candidateId}-${platform}`,
      platform,
      title: input.candidate.title,
      summary: evidenceSummary(platform, tool.evidenceStatus, tool.recordCount),
      observedAt: Math.floor(Date.now() / 1000),
      evidence: evidenceLines,
      metrics: {
        item_count: tool.recordCount,
        raw_item_count: tool.rawRecordCount,
        stale_item_count: tool.staleRecordCount,
        undated_item_count: tool.undatedRecordCount,
        crawler_status: tool.qualityStatus,
        evidence_status: tool.evidenceStatus,
        elapsed_ms: tool.elapsedMs,
        content_overlap_percent: 0,
        has_verifiable_metrics: false,
      },
      raw: {
        status: tool.evidenceStatus,
        qualityStatus: tool.qualityStatus,
        recordCount: tool.recordCount,
        rawRecordCount: tool.rawRecordCount,
        items: tool.evidenceItems,
        samples: compactValue(tool.samples),
        staleRecordCount: tool.staleRecordCount,
        undatedRecordCount: tool.undatedRecordCount,
        urls,
        nodes,
      },
    };

    const evidenceId = crypto.randomUUID();
    await insertSocialPlatformEvidence({
      id: evidenceId,
      runId: input.runId,
      candidateEventId: input.candidateId,
      platform,
      status: tool.evidenceStatus,
      title: input.candidate.title,
      evidence: {
        status: tool.evidenceStatus,
        items: tool.evidenceItems,
        urls,
        nodes,
        samples: compactValue(tool.samples),
      },
      metrics: {
        recordCount: tool.recordCount,
        rawRecordCount: tool.rawRecordCount,
        staleRecordCount: tool.staleRecordCount,
        undatedRecordCount: tool.undatedRecordCount,
        qualityStatus: tool.qualityStatus,
        elapsedMs: tool.elapsedMs,
        verifiableEvidenceCount: tool.evidenceItems.length,
      },
    });

    await step(
      input.runId,
      PLATFORM_AGENT_IDS[platform],
      "search_event_evidence",
      tool.evidenceStatus === "found" ? "found" : tool.evidenceStatus,
      evidenceSummary(platform, tool.evidenceStatus, tool.recordCount),
      {
        recordCount: tool.recordCount,
        rawRecordCount: tool.rawRecordCount,
        staleRecordCount: tool.staleRecordCount,
        undatedRecordCount: tool.undatedRecordCount,
        evidenceItems: tool.evidenceItems.slice(0, 3),
        qualityStatus: tool.qualityStatus,
        urls: urls.slice(0, 5),
        nodes: nodes.slice(0, 5),
      },
    );

    const reflection = await runPlatformReflection({
      runId: input.runId,
      runner: input.runner,
      platform,
      phase: "search",
      status: tool.evidenceStatus,
      previousState: currentPlatformState(platformStates, platform),
      retentionDays: input.retentionDays,
      fallback: fallbackReflection,
      tool,
      findings: evidenceLines,
    });
    platformStates = updatePlatformState(platformStates, platform, reflectionStatePatch(reflection));
    await updateSocialMonitorRun({ id: input.runId, platformStates });

    bundles.push({
      evidenceId,
      signal,
      status: tool.evidenceStatus,
    });
  }

  return { bundles, platformStates };
}

async function analyzePlatformEvidence(input: {
  readonly runId: string;
  readonly runner: ReturnType<typeof createRouteBackedSocialAgentRunner>;
  readonly gate: ChinaRelevanceResult;
  readonly evidenceBundles: readonly EvidenceBundle[];
  readonly abortSignal?: AbortSignal;
}): Promise<readonly PlatformReport[]> {
  const reports: PlatformReport[] = [];

  for (const bundle of input.evidenceBundles) {
    await assertNotStopped(input.runId, input.abortSignal);
    const agentId = PLATFORM_AGENT_IDS[bundle.signal.platform];
    let report: PlatformReport;

    if (bundle.status !== "found") {
      report = fallbackReport(bundle.signal, input.gate, bundle.status);
      await step(
        input.runId,
        agentId,
        "normalize_platform_evidence",
        bundle.status,
        `${PLATFORM_LABELS[bundle.signal.platform]} 没有可核验证据，按未发现处理`,
      );
    } else try {
      const text = await input.runner.run({
        agentId,
        routeKey: "social.platform",
        task: buildPlatformReportTask(bundle.signal, input.gate),
      });
      report = enforceEvidenceReport(
        parsePlatformReport(text, input.gate),
        bundle.signal,
        input.gate,
        bundle.status,
      );
      await step(
        input.runId,
        agentId,
        "normalize_platform_evidence",
        "completed",
        `${PLATFORM_LABELS[bundle.signal.platform]} 平台报告已生成`,
      );
    } catch (error) {
      report = fallbackReport(bundle.signal, input.gate, bundle.status);
      await step(
        input.runId,
        agentId,
        "normalize_platform_evidence",
        "fallback",
        `平台 Agent 未返回合规 JSON，已使用确定性兜底报告：${errorMessage(error)}`,
      );
    }

    const rendered = renderPlatformReport(report);
    reports.push(report);
    await attachSocialEvidenceReport({
      id: bundle.evidenceId,
      report,
      renderedReportText: rendered,
    });
    await saveSocialPlatformReport({
      id: crypto.randomUUID(),
      agentId,
      report,
      renderedText: rendered,
      status: report.detection_status === "not_found" ? "not_found" : "reported",
    });
  }

  return reports;
}

async function fuseReports(input: {
  readonly runId: string;
  readonly runner: ReturnType<typeof createRouteBackedSocialAgentRunner>;
  readonly reports: readonly PlatformReport[];
  readonly abortSignal?: AbortSignal;
}): Promise<FusedSocialEvent> {
  await assertNotStopped(input.runId, input.abortSignal);
  await updateSocialMonitorRun({
    id: input.runId,
    currentStep: "Social Fusion Agent 正在融合跨平台证据",
  });

  try {
    const text = await input.runner.run({
      agentId: SOCIAL_FUSION_AGENT_ID,
      routeKey: "social.fusion",
      task: buildFusionTask(input.reports),
    });
    const fused = sanitizeFusedSocialEvent(parseFusedSocialEvent(text), input.reports);
    await step(
      input.runId,
      SOCIAL_FUSION_AGENT_ID,
      "fusion",
      "completed",
      "融合智能体已生成跨平台事件判断",
      { eventKey: fused.event_key, impactLevel: fused.impact_level },
    );
    return fused;
  } catch (error) {
    const fused = deterministicFusion(input.reports);
    await step(
      input.runId,
      SOCIAL_FUSION_AGENT_ID,
      "fusion",
      "fallback",
      `融合智能体未返回合规 JSON，已使用确定性融合：${errorMessage(error)}`,
      { eventKey: fused.event_key, impactLevel: fused.impact_level },
    );
    return fused;
  }
}

async function runChinaGate(input: {
  readonly runId: string;
  readonly runner: ReturnType<typeof createRouteBackedSocialAgentRunner>;
  readonly signal: LightweightSocialSignal;
}): Promise<ChinaRelevanceResult> {
  try {
    const text = await input.runner.run({
      agentId: CHINA_GATE_AGENT_ID,
      routeKey: "social.gate",
      task: buildChinaRelevanceTask(input.signal),
    });
    const gate = parseAndNormalizeChinaGate(text);
    await step(
      input.runId,
      CHINA_GATE_AGENT_ID,
      "china_gate",
      shouldAnalyzePlatform(gate) ? "relevant" : "skipped",
      shouldAnalyzePlatform(gate)
        ? "候选事件与中国相关且存在对中国的安全或负面风险，进入深挖"
        : "候选事件未同时满足中国相关与风险门槛，暂不深挖",
      { gate },
    );
    return gate;
  } catch (error) {
    const gate = fallbackChinaGate(input.signal);
    await step(
      input.runId,
      CHINA_GATE_AGENT_ID,
      "china_gate",
      "fallback",
      `中国相关性与风险判断 Agent 未返回合规 JSON，已使用本地兜底判断：${errorMessage(error)}`,
      { gate },
    );
    return gate;
  }
}

async function runCrawlerTool(input: {
  readonly toolRegistry: ToolRegistry;
  readonly platform: SocialPlatform;
  readonly mode: "probe" | "crawl";
  readonly eventTitle?: string;
  readonly limit: number;
  readonly retentionDays: number;
  readonly phase: "discover" | "search";
}): Promise<ToolExecutionSummary> {
  const toolName = SOCIAL_PLATFORM_CRAWLER_TOOLS[input.platform];
  const result = await input.toolRegistry.executeTool(toolName, {
    mode: input.mode,
    phase: input.phase,
    ...(input.eventTitle ? { eventTitle: input.eventTitle } : {}),
    limit: input.limit,
    dryRun: true,
    timeoutMs: 120_000,
  });
  const rawOutput = parseToolJson(result.output) ?? result.output;
  const quality = dataQualityRecord(rawOutput);
  const qualityStatus = stringField(quality, "status") ?? (result.isError ? "error" : "unknown");
  const samples = sampleRecords(rawOutput);
  const rawRecordCount =
    numberField(quality, "recordCount") ??
    samples.length ??
    0;
  const normalizedCandidates = samples
    .map((sample) => evidenceItemFromSample(input.platform, sample))
    .filter((item): item is NormalizedEvidenceItem =>
      Boolean(item && hasVerifiableEvidence(input.platform, item)),
    );
  const now = Math.floor(Date.now() / 1000);
  const staleRecordCount = normalizedCandidates.filter(
    (item) => publishedAtRecencyStatus(item, input.retentionDays, now) === "stale",
  ).length;
  const undatedRecordCount = normalizedCandidates.filter(
    (item) => publishedAtRecencyStatus(item, input.retentionDays, now) === "undated",
  ).length;
  const evidenceItems = normalizeEvidenceItems(
    input.platform,
    normalizedCandidates,
    input.eventTitle ?? "",
    input.phase,
    input.retentionDays,
  );
  const evidenceStatus = toEvidenceStatus({
    isError: result.isError,
    qualityStatus,
    rawRecordCount,
    evidenceCount: evidenceItems.length,
  });
  const output = compactValue(rawOutput);

  return {
    platform: input.platform,
    toolName,
    isError: result.isError,
    output,
    qualityStatus,
    recordCount: evidenceItems.length,
    rawRecordCount,
    staleRecordCount,
    undatedRecordCount,
    samples: samples.slice(0, MAX_STORED_ARRAY).map((sample) => compactValue(sample)),
    evidenceItems,
    elapsedMs: numberField(output, "elapsedMs"),
    evidenceStatus,
  };
}

function toEvidenceStatus(input: {
  readonly isError: boolean;
  readonly qualityStatus: string;
  readonly rawRecordCount: number;
  readonly evidenceCount: number;
}): SocialEvidenceStatus {
  if (input.qualityStatus === "missing_config") return "missing_config";
  if (input.qualityStatus === "probe_not_supported" || input.qualityStatus === "smoke_only") {
    return "skipped";
  }
  if (input.qualityStatus === "real_data" && input.rawRecordCount > 0 && input.evidenceCount > 0) {
    return "found";
  }
  if (input.isError) return "error";
  if (input.qualityStatus === "error" || input.qualityStatus === "timeout") return "error";
  return "not_found";
}

function candidateFromEvidenceItem(
  platform: SocialPlatform,
  item: NormalizedEvidenceItem,
): CandidateDraft {
  const title = item.title || item.content || `${PLATFORM_LABELS[platform]} 发现的候选事件`;
  const content = item.content || item.title || `来源平台：${PLATFORM_LABELS[platform]}；自主发现`;
  const urls = item.url ? [item.url] : [];
  const nodes = evidenceNodeNames([item]);
  const publishedAt = normalizePublishedAtSeconds(item.publishedAt);

  return {
    platform,
    title: truncate(title, 240),
    summary: truncate(content, 1200),
    observedAt: publishedAt ?? Math.floor(Date.now() / 1000),
    raw: {
      items: [item],
      urls,
      nodes,
      publishedAt: item.publishedAt,
    },
  };
}

function normalizeEvidenceItems(
  _platform: SocialPlatform,
  candidates: readonly NormalizedEvidenceItem[],
  eventText: string,
  phase: "discover" | "search",
  retentionDays: number,
): readonly NormalizedEvidenceItem[] {
  const seen = new Set<string>();
  const items: NormalizedEvidenceItem[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const item of candidates) {
    if (publishedAtRecencyStatus(item, retentionDays, now) === "stale") continue;
    if (phase === "search" && !evidenceMatchesEvent(item, eventText)) continue;

    const key = [
      item.url,
      item.channelName,
      item.messageId,
      item.title,
      item.content.slice(0, 120),
    ]
      .filter(Boolean)
      .join("|")
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= MAX_STORED_ARRAY) break;
  }

  return items;
}

function publishedAtRecencyStatus(
  item: NormalizedEvidenceItem,
  retentionDays: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): "recent" | "undated" | "stale" {
  const publishedAt = normalizePublishedAtSeconds(item.publishedAt);
  if (publishedAt === null) return "undated";
  const earliest = nowSeconds - retentionDays * SECONDS_PER_DAY;
  const latest = nowSeconds + RECENT_FUTURE_TOLERANCE_SECONDS;
  return publishedAt >= earliest && publishedAt <= latest ? "recent" : "stale";
}

function normalizePublishedAtSeconds(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 10_000_000_000) return Math.floor(value / 1000);
    if (value > 1_000_000_000) return Math.floor(value);
    return null;
  }

  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return normalizePublishedAtSeconds(numeric);
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  return null;
}

function evidenceItemFromSample(
  platform: SocialPlatform,
  sample: unknown,
): NormalizedEvidenceItem | null {
  if (typeof sample === "string") {
    const content = cleanDisplayText(sample);
    if (!content) return null;
    return {
      type: `${platform}_text`,
      title: truncate(content, 120),
      content,
      hasContentBody: true,
    };
  }

  const record = asRecord(sample);
  if (!record) return null;
  const url = firstPublicUrlFromKnownKeys(sample, [
    "url",
    "post_url",
    "message_url",
    "tweet_url",
    "thread_url",
    "video_url",
    "permalink_url",
    "html_url",
    "source_url",
  ]) ?? firstPublicUrl(sample);
  const title = firstCleanString(sample, [
    "message_text",
    "title",
    "topic",
    "name",
    "dialog_title",
    "full_name",
    "repo",
    "repository",
    "repository_name",
    "video_title",
    "thread_title",
    "subject",
    "page_name",
    "channel_title",
    "chat_title",
  ]);
  const contentBody = firstCleanString(sample, [
    "summary",
    "description",
    "text",
    "message_text",
    "content",
    "message",
    "body",
    "caption",
    "snippet",
    "comment",
    "event",
  ]);
  const channelName = firstCleanString(sample, [
    "channel_name",
    "channel",
    "dialog_title",
    "chat_title",
    "channel_title",
    "room_name",
    "board",
    "category",
    "source_list",
  ]);
  const sourceName = firstCleanString(sample, [
    "source",
    "source_name",
    "dialog_username",
    "page",
    "page_name",
    "target",
  ]);
  const messageId = firstCleanString(sample, [
    "message_id",
    "msg_id",
    "event_id",
    "tweet_id",
    "thread_id",
    "post_id",
    "video_id",
    "id",
  ]);
  const author = firstCleanString(sample, [
    "author",
    "author_username",
    "username",
    "user_nickname",
    "sender",
    "screen_name",
  ]);
  const publishedAt = firstCleanString(sample, [
    "published_at",
    "published",
    "created_at",
    "message_time",
    "create_time",
    "time",
    "timestamp",
    "captured_at",
    "scraped_at",
    "last_reply_time",
  ]) ?? firstNumber(sample, ["published_at", "created_at", "message_time", "create_time", "timestamp", "time"]);
  const type =
    firstCleanString(sample, ["type", "source_type", "kind"]) ??
    `${platform}_evidence`;
  const metrics = numericMetrics(sample);
  const fallbackTitle = title ?? channelName ?? sourceName ?? author ?? url ?? messageId ?? "";
  const fallbackContent = contentBody ?? title ?? url ?? "";

  return {
    type: truncate(type, 80),
    title: truncate(fallbackTitle, 300),
    content: truncate(fallbackContent, MAX_EVIDENCE_CONTENT),
    ...(url ? { url } : {}),
    ...(channelName ? { channelName: truncate(channelName, 180) } : {}),
    ...(messageId ? { messageId: truncate(String(messageId), 120) } : {}),
    ...(author ? { author: truncate(author, 180) } : {}),
    ...(sourceName ? { sourceName: truncate(sourceName, 180) } : {}),
    ...(publishedAt !== undefined && publishedAt !== null ? { publishedAt } : {}),
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
    hasContentBody: Boolean(contentBody),
  };
}

function hasVerifiableEvidence(platform: SocialPlatform, item: NormalizedEvidenceItem): boolean {
  const hasUrl = Boolean(item.url);
  const hasContent = Boolean(item.content && !isPlaceholderText(item.content));
  const hasTitle = Boolean(item.title && !isPlaceholderText(item.title));
  const hasMessageRef = Boolean(item.channelName && (item.messageId || item.url));

  switch (platform) {
    case "x":
      return hasUrl && (hasContent || hasTitle);
    case "telegram":
      return hasMessageRef && Boolean(item.hasContentBody);
    case "lihkg":
    case "facebook":
    case "github":
    case "instagram":
    case "lien":
    case "ptt":
    case "youtube":
      return hasUrl && (hasTitle || hasContent);
    case "netlight":
      return Boolean((item.messageId || item.url) && (item.channelName || item.author) && item.hasContentBody);
  }
}

function evidenceMatchesEvent(item: NormalizedEvidenceItem, eventText: string): boolean {
  const terms = matchTerms(eventText);
  if (terms.length === 0) return true;
  const haystack = normalizeForMatch([
    item.title,
    item.content,
    item.url,
    item.channelName,
    item.sourceName,
    item.author,
  ].filter(Boolean).join(" "));
  const hitCount = terms.filter((term) => haystack.includes(term)).length;
  const requiredHits = terms.length >= 4 || eventText.length >= 18 ? 2 : 1;
  return hitCount >= Math.min(requiredHits, terms.length);
}

function matchTerms(eventText: string): string[] {
  const normalized = normalizeForMatch(eventText);
  const rawTerms = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9_#@.-]{3,}/giu) ?? [];
  const terms = new Set<string>();
  for (const term of rawTerms) {
    if (isGenericTerm(term)) continue;
    terms.add(term);
    if (/^[\p{Script=Han}]+$/u.test(term) && term.length > 3) {
      for (let index = 0; index < term.length - 1; index += 1) {
        const gram = term.slice(index, index + 2);
        if (!isGenericTerm(gram)) terms.add(gram);
      }
    }
  }
  return [...terms].slice(0, 12);
}

function isGenericTerm(term: string): boolean {
  return new Set([
    "http",
    "https",
    "www",
    "com",
    "事件",
    "消息",
    "内容",
    "平台",
  ]).has(term);
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function firstPublicUrl(value: unknown): string | undefined {
  return extractUrls(value).find((url) => !/<local-path>|<agenthub-|<crawler-|<model-/i.test(url));
}

function firstPublicUrlFromKnownKeys(value: unknown, keys: readonly string[]): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string") {
      const url = extractUrls(direct).find((item) => !/<local-path>|<agenthub-|<crawler-|<model-/i.test(item));
      if (url) return url;
    }
  }
  return undefined;
}

function firstCleanString(value: unknown, keys: readonly string[]): string | undefined {
  const found = bestString(value, keys);
  const clean = found ? cleanDisplayText(found) : "";
  return clean || undefined;
}

function firstNumber(value: unknown, keys: readonly string[]): number | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  }
  for (const nested of Object.values(record)) {
    const found = firstNumber(nested, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function numericMetrics(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  const keys = [
    "likes",
    "retweets",
    "replies",
    "views",
    "reply_count",
    "repost_count",
    "view_count",
    "bookmark_count",
    "no_of_reply",
    "no_of_uni_user_reply",
    "like_count",
    "dislike_count",
    "reply_like_count",
    "reply_dislike_count",
    "participant_count",
    "comment_count",
    "message_count",
    "channel_count",
  ];
  const out: Record<string, number> = {};
  for (const key of keys) {
    const valueForKey = record[key];
    if (typeof valueForKey === "number" && Number.isFinite(valueForKey)) {
      out[key] = valueForKey;
    }
  }
  return out;
}

function cleanDisplayText(text: string): string {
  const clean = redactLocalPathLiterals(text).replace(/\s+\n/g, "\n").trim();
  return isPlaceholderText(clean) ? "" : clean;
}

function isPlaceholderText(text: string): boolean {
  const clean = text.trim().toLowerCase();
  return (
    clean === "" ||
    clean === "[已截断]" ||
    clean === "[redacted]" ||
    clean.includes("[å·²") ||
    clean.includes("已省略深层对象")
  );
}

function redactLocalPathLiterals(text: string): string {
  return text
    .replace(/(?<![A-Za-z])[A-Z]:\\(?:[^\\\r\n"'<>|]+\\)*[^\\\r\n"'<>|]*/gi, "<local-path>")
    .replace(/(?<![A-Za-z])[A-Z]:\/(?:[^/\r\n"'<>|]+\/)*[^/\r\n"'<>|]*/gi, "<local-path>");
}

function evidenceUrls(items: readonly NormalizedEvidenceItem[]): string[] {
  return [...new Set(items.map((item) => item.url).filter((url): url is string => Boolean(url)))].slice(0, 12);
}

function evidenceNodeNames(items: readonly NormalizedEvidenceItem[]): string[] {
  const nodes = new Set<string>();
  for (const item of items) {
    for (const value of [item.channelName, item.sourceName, item.author, item.title]) {
      if (value && !isPlaceholderText(value)) nodes.add(truncate(value, 120));
      if (nodes.size >= 12) return [...nodes];
    }
  }
  return [...nodes];
}

function candidateEvidenceItems(raw: unknown): readonly NormalizedEvidenceItem[] {
  const record = asRecord(raw);
  const items = record?.items;
  return Array.isArray(items)
    ? items.filter((item): item is NormalizedEvidenceItem => Boolean(asRecord(item)))
    : [];
}

function fallbackReport(
  signal: LightweightSocialSignal,
  gate: ChinaRelevanceResult,
  status: SocialEvidenceStatus,
): PlatformReport {
  const found = status === "found";
  const itemCount = Number(signal.metrics?.item_count ?? 0);
  const eventKey = stableEventKey(signal.title);
  const base = {
    event_key: eventKey,
    event_title: signal.title,
    detection_status: found ? "found" as const : "not_found" as const,
    observed_at: signal.observedAt,
    china_relevance: reportGate(gate),
    summary: signal.summary,
    evidence: [...signal.evidence],
    regions: [],
    core_nodes: extractNodeNames(signal.raw),
  };

  switch (signal.platform) {
    case "x":
      return {
        ...base,
        schema: "x_alert_v1",
        platform: "x",
        hashtag: "",
        discussion_growth_percent: 0,
        participant_accounts: itemCount,
        main_source: "未知",
        status: found ? "watching" : "stable",
      };
    case "telegram":
      return {
        ...base,
        schema: "telegram_alert_v1",
        platform: "telegram",
        channel_path: found ? extractNodeNames(signal.raw) : [],
        shared_content_percent: 0,
        bridge_channels: [],
      };
    case "lihkg":
      return {
        ...base,
        schema: "lihkg_alert_v1",
        platform: "lihkg",
        topic: signal.title,
        heat: "",
        participant_count: itemCount,
        stance: {
          support_percent: 0,
          oppose_percent: 0,
          neutral_percent: found ? 100 : 0,
        },
        main_arguments: found ? signal.evidence.slice(0, 3) : [],
      };
    case "facebook":
      return {
        ...base,
        schema: "facebook_alert_v1",
        platform: "facebook",
        pages: found ? extractNodeNames(signal.raw) : [],
        interaction_growth_percent: 0,
        propagation_users: itemCount,
        influence_regions: [],
      };
    case "github":
    case "instagram":
    case "lien":
    case "netlight":
    case "ptt":
    case "youtube":
      return {
        ...base,
        schema: `${signal.platform}_alert_v1`,
        platform: signal.platform,
        item_count: itemCount,
        growth_percent: 0,
        source_nodes: found ? extractNodeNames(signal.raw) : [],
        matched_terms: [],
        content_overlap_percent: 0,
        status: found ? "watching" : "stable",
      } as PlatformReport;
  }
}

function reportGate(gate: ChinaRelevanceResult) {
  return {
    ...gate,
    matched_dimensions: [...gate.matched_dimensions],
    evidence: [...gate.evidence],
    risk_categories: [...gate.risk_categories],
    risk_evidence: [...gate.risk_evidence],
  };
}

function enforceEvidenceReport(
  report: PlatformReport,
  signal: LightweightSocialSignal,
  gate: ChinaRelevanceResult,
  status: SocialEvidenceStatus,
): PlatformReport {
  if (status !== "found") return fallbackReport(signal, gate, status);
  const itemCount = Number(signal.metrics?.item_count ?? 0);
  const evidence = signal.evidence.length > 0 ? [...signal.evidence] : [...report.evidence];
  const coreNodes = extractNodeNames(signal.raw);

  switch (report.platform) {
    case "x":
      return {
        ...report,
        detection_status: "found",
        evidence,
        core_nodes: coreNodes,
        participant_accounts: itemCount,
        discussion_growth_percent: 0,
        status: report.status === "rapid_spread" ? "rapid_spread" : "watching",
      };
    case "telegram":
      return {
        ...report,
        detection_status: "found",
        evidence,
        core_nodes: coreNodes,
        channel_path: coreNodes,
        shared_content_percent: 0,
      };
    case "lihkg":
      return {
        ...report,
        detection_status: "found",
        evidence,
        core_nodes: coreNodes,
        participant_count: itemCount,
        heat: report.heat || "",
      };
    case "facebook":
      return {
        ...report,
        detection_status: "found",
        evidence,
        core_nodes: coreNodes,
        pages: coreNodes,
        interaction_growth_percent: 0,
        propagation_users: itemCount,
      };
    case "github":
    case "instagram":
    case "lien":
    case "netlight":
    case "ptt":
    case "youtube":
      return {
        ...report,
        detection_status: "found",
        evidence,
        core_nodes: coreNodes,
        item_count: itemCount,
        growth_percent: 0,
        source_nodes: coreNodes,
        content_overlap_percent: 0,
        status: "watching",
      } as PlatformReport;
  }
}

function fallbackChinaGate(signal: LightweightSocialSignal): ChinaRelevanceResult {
  return buildKeywordChinaGate({
    title: signal.title,
    summary: signal.summary,
    evidence: signal.evidence,
  });
}

function buildKanDecision(
  fused: FusedSocialEvent,
  reports: readonly PlatformReport[],
): { readonly shouldQueue: boolean; readonly reason: string } {
  const foundCount = reports.filter((report) => report.detection_status !== "not_found").length;
  const politicalThreatCount = reports.filter(
    (report) =>
      report.detection_status !== "not_found" &&
      isPoliticalSecurityThreat(report.china_relevance),
  ).length;
  const politicallyRelevant =
    politicalThreatCount >= 1 &&
    reports.some(
      (report) =>
        report.detection_status !== "not_found" &&
        report.china_relevance.is_china_related &&
        report.china_relevance.score >= 0.6,
    );
  const highImpact = fused.impact_level === "High" || fused.impact_level === "Critical";
  const confident = fused.same_event_confidence >= 0.7;
  const rising = fused.trend === "rising";
  const shouldQueue =
    politicallyRelevant &&
    foundCount >= 2 &&
    (highImpact || confident || rising);

  return {
    shouldQueue,
    reason: shouldQueue
      ? "达到 Kan 推送阈值：至少两个平台发现，且属于中国政治安全/国家安全/不当政治言论风险，影响等级、置信度或趋势满足条件。"
      : politicallyRelevant
        ? "未达到 Kan 推送阈值，进入持续监控；本次不会执行真实推送。"
        : "未达到中国政治安全威胁推送门槛：普通中国相关、非政治安全风险、证据不足或不当言论威胁不明确的事件不推送。",
  };
}

async function dispatchSocialFusionKanMessage(
  message: string,
  fused: FusedSocialEvent,
  dedupeKey: string,
): Promise<{ readonly ok: boolean; readonly error: string | null; readonly result?: unknown }> {
  try {
    const result = await dispatchKanMessage({
      routeId: SOCIAL_FUSION_KAN_ROUTE_ID,
      message,
      dryRun: false,
      dedupeKey,
      metadata: {
        eventKey: fused.event_key,
        dedupeKey,
        impactLevel: fused.impact_level,
        sameEventConfidence: fused.same_event_confidence,
      },
    });
    const firstError = result.deliveries.find((delivery) => delivery.error)?.error ?? null;
    return { ok: result.ok, error: firstError, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function duplicateReason(match: SocialKanDuplicateMatch): string {
  const reasons = match.comparison.reasons.length > 0
    ? match.comparison.reasons.join("；")
    : "事件指纹高度相似";
  return `重复事件已过滤：与历史已推送事件 ${match.queue.id} 相同或高度相似（${reasons}）。本次只更新监控记录，不再重复推送 Kan。`;
}

function summarizeGatePattern(
  platform: SocialPlatform,
  gate: ChinaRelevanceResult,
): string {
  const relevance = gate.is_china_related
    ? `中国相关分 ${Math.round(gate.score * 100)}`
    : "未达到中国相关";
  const risk = gate.threat_to_china_security || gate.negative_to_china
    ? `风险分 ${Math.round(gate.risk_score * 100)}`
    : "未达到风险门槛";
  const categories = gate.risk_categories.filter((item) => item !== "none").join("、");
  return `${PLATFORM_LABELS[platform]} 候选完成门槛判断：${relevance}，${risk}${
    categories ? `；风险类型：${categories}` : ""
  }。`;
}

async function waitForNextCycle(
  runId: string,
  signal: AbortSignal | undefined,
  cycleIntervalSeconds: number,
  cycle: number,
): Promise<void> {
  await step(
    runId,
    SOCIAL_CONTROL_AGENT_ID,
    "cycle_wait",
    "running",
    `第 ${cycle} 轮结束，等待 ${cycleIntervalSeconds} 秒后继续巡逻`,
    { cycle, nextCycleInSeconds: cycleIntervalSeconds },
  );

  const deadline = Date.now() + cycleIntervalSeconds * 1000;
  while (Date.now() < deadline) {
    await assertNotStopped(runId, signal);
    const remaining = deadline - Date.now();
    await sleep(Math.min(5_000, Math.max(250, remaining)), signal);
  }
  await assertNotStopped(runId, signal);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new StopRequestedError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new StopRequestedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function completeRun(runId: string, currentStep: string): Promise<void> {
  await updateSocialMonitorRun({
    id: runId,
    status: "completed",
    currentStep,
    stoppedAt: Math.floor(Date.now() / 1000),
  });
}

async function assertNotStopped(runId: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || (await isSocialMonitorStopRequested(runId))) {
    throw new StopRequestedError();
  }
}

async function step(
  runId: string,
  agentId: string,
  stepName: string,
  status: string,
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await appendSocialAgentStepLog({
    runId,
    agentId,
    step: stepName,
    status,
    message,
    data,
  });
}

function parseToolJson(output: string): unknown | null {
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(output.slice(jsonStart));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function dataQualityRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  const direct = asRecord(record?.dataQuality);
  if (direct) return direct;
  const result = asRecord(record?.result);
  return asRecord(result?.dataQuality);
}

function sampleRecords(value: unknown): readonly unknown[] {
  const quality = dataQualityRecord(value);
  const samples = quality?.sampleRecords;
  if (Array.isArray(samples)) return samples;
  const record = asRecord(value);
  const result = asRecord(record?.result);
  for (const key of ["items", "results", "records", "messages", "tweets", "dialogs"]) {
    const direct = record?.[key];
    if (Array.isArray(direct)) return direct.slice(0, MAX_STORED_ARRAY);
    const nested = result?.[key];
    if (Array.isArray(nested)) return nested.slice(0, MAX_STORED_ARRAY);
  }
  return [];
}

function stringField(value: unknown, key: string): string | null {
  const field = asRecord(value)?.[key];
  return typeof field === "string" ? field : null;
}

function numberField(value: unknown, key: string): number | null {
  const field = asRecord(value)?.[key];
  return typeof field === "number" ? field : null;
}

function bestString(value: unknown, keys: readonly string[]): string | null {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (typeof direct === "number") return String(direct);
  }
  for (const nested of Object.values(record)) {
    const found = bestString(nested, keys);
    if (found) return found;
  }
  return null;
}

function compactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactLocalPathLiterals(truncate(value, MAX_STORED_TEXT));
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 5) return `共 ${value.length} 项`;
    return value.slice(0, MAX_STORED_ARRAY).map((item) => compactValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return String(value);

  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 80);
  for (const [key, raw] of entries) {
    if (SECRET_KEY_PATTERN.test(key) || key === "command") {
      out[key] = "[已脱敏]";
      continue;
    }
    if (depth >= 5 && raw && typeof raw === "object") {
      out[key] = Array.isArray(raw) ? `共 ${raw.length} 项` : "已省略深层对象";
      continue;
    }
    out[key] = compactValue(raw, depth + 1);
  }
  return out;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function extractUrls(value: unknown): string[] {
  const text = JSON.stringify(value ?? "");
  const urls = text.match(/https?:\/\/[^\s"'<>\\]+/gi) ?? [];
  return [...new Set(urls.map((url) => url.replace(/[),.;\]}]+$/g, "")))].slice(0, 12);
}

function extractNodeNames(value: unknown): string[] {
  const nodes = new Set<string>();
  collectNodeNames(value, nodes);
  return [...nodes].slice(0, 12);
}

function collectNodeNames(value: unknown, out: Set<string>, depth = 0): void {
  if (out.size >= 12 || depth > 3) return;
  const record = asRecord(value);
  if (!record) return;
  for (const key of [
    "channel",
    "channelName",
    "channel_name",
    "chat_title",
    "name",
    "title",
    "author",
    "sourceName",
    "username",
    "screen_name",
    "page",
    "page_name",
    "full_name",
    "repository",
    "board",
  ]) {
    const valueForKey = record[key];
    if (typeof valueForKey === "string" && valueForKey.trim()) {
      out.add(truncate(valueForKey.trim(), 120));
    }
  }
  for (const nested of Object.values(record)) collectNodeNames(nested, out, depth + 1);
}

function buildEvidenceLines(
  platform: SocialPlatform,
  input: {
    readonly status: SocialEvidenceStatus;
    readonly items: readonly NormalizedEvidenceItem[];
    readonly urls: readonly string[];
    readonly nodes: readonly string[];
    readonly recordCount: number;
  },
): string[] {
  const statusText =
    input.status === "found"
      ? "也发现了"
      : input.status === "not_found"
        ? "未发现"
        : input.status === "missing_config"
          ? "缺少配置"
          : input.status === "error"
            ? "工具异常"
            : "已跳过";
  const lines = [
    `${PLATFORM_LABELS[platform]}：${statusText}`,
    `可核验证据数量：${input.recordCount}`,
  ];
  if (input.urls.length > 0) lines.push(`URL：${input.urls.slice(0, 5).join(" | ")}`);
  if (input.nodes.length > 0) lines.push(`公开节点：${input.nodes.slice(0, 5).join(" | ")}`);
  for (const [index, item] of input.items.slice(0, 3).entries()) {
    const parts = [
      `证据${index + 1}`,
      item.title ? `标题：${item.title}` : "",
      item.content ? `内容：${item.content}` : "",
      item.url ? `链接：${item.url}` : "",
      item.channelName ? `频道/节点：${item.channelName}` : "",
      item.messageId ? `消息/帖子ID：${item.messageId}` : "",
      item.publishedAt !== undefined ? `时间：${String(item.publishedAt)}` : "时间：爬虫未返回发布时间",
      item.metrics ? `指标：${JSON.stringify(item.metrics)}` : "",
    ].filter(Boolean);
    if (parts.length > 1) lines.push(parts.join("；"));
  }
  return lines;
}

function discoveryStatusMessage(
  platform: SocialPlatform,
  tool: ToolExecutionSummary,
): string {
  if (tool.evidenceStatus === "found") {
    return `${PLATFORM_LABELS[platform]} 发现 ${tool.recordCount} 条真实候选数据`;
  }
  return evidenceSummary(platform, tool.evidenceStatus, tool.recordCount);
}

function evidenceSummary(
  platform: SocialPlatform,
  status: SocialEvidenceStatus,
  count: number,
): string {
  if (status === "found") return `${PLATFORM_LABELS[platform]} 也发现了，返回 ${count} 条证据`;
  if (status === "not_found") return `${PLATFORM_LABELS[platform]} 未发现同一事件`;
  if (status === "missing_config") return `${PLATFORM_LABELS[platform]} 缺少配置，暂不要求真实爬取`;
  if (status === "error") return `${PLATFORM_LABELS[platform]} 爬虫工具执行异常`;
  if (status === "skipped") return `${PLATFORM_LABELS[platform]} 缺少可调用的一次性工具入口`;
  return `${PLATFORM_LABELS[platform]} 已跳过`;
}

function toolLogData(tool: ToolExecutionSummary): Record<string, unknown> {
  return {
    toolName: tool.toolName,
    qualityStatus: tool.qualityStatus,
    recordCount: tool.recordCount,
    rawRecordCount: tool.rawRecordCount,
    staleRecordCount: tool.staleRecordCount,
    undatedRecordCount: tool.undatedRecordCount,
    evidenceItems: tool.evidenceItems.slice(0, 3),
    elapsedMs: tool.elapsedMs,
    evidenceStatus: tool.evidenceStatus,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
