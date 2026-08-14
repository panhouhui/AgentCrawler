import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  GitBranch,
  Network,
  Play,
  RadioTower,
  Search,
  ShieldCheck,
  Square,
} from "lucide-react";
import { apiFetch } from "../api";
import { Button, PageHeader } from "../components";

type Platform =
  | "x"
  | "telegram"
  | "lihkg"
  | "facebook"
  | "github"
  | "instagram"
  | "lien"
  | "netlight"
  | "ptt"
  | "youtube";

type MonitorStatus = "running" | "stopping" | "stopped" | "failed" | "completed";
type EvidenceStatus = "found" | "not_found" | "missing_config" | "error" | "skipped";
type PlatformAgentStatus =
  | "idle"
  | "running"
  | "watching"
  | "found"
  | "not_found"
  | "missing_config"
  | "skipped"
  | "error";

interface PlatformConfig {
  readonly id: Platform;
  readonly label: string;
  readonly agentName: string;
}

interface GateResult {
  readonly china_relevance: string;
  readonly is_china_related?: boolean;
  readonly score: number;
  readonly matched_dimensions?: readonly string[];
  readonly evidence?: readonly string[];
  readonly threat_to_china_security?: boolean;
  readonly negative_to_china?: boolean;
  readonly china_impact?: string;
  readonly risk_score?: number;
  readonly risk_categories?: readonly string[];
  readonly risk_evidence?: readonly string[];
  readonly deep_crawl_allowed?: boolean;
  readonly recommended_action: string;
  readonly reason: string;
}

interface CandidateEvent {
  readonly id: string;
  readonly sourcePlatform: Platform;
  readonly eventKey: string;
  readonly title: string;
  readonly summary: string;
  readonly discoveredAt: number;
  readonly raw: unknown;
  readonly status: string;
  readonly chinaRelevance: GateResult | null;
}

interface PlatformReport {
  readonly schema: string;
  readonly platform: Platform;
  readonly event_title: string;
  readonly detection_status?: "found" | "not_found";
  readonly summary: string;
  readonly evidence?: readonly string[];
  readonly [key: string]: unknown;
}

interface EvidenceItem {
  readonly type?: string;
  readonly title?: string;
  readonly content?: string;
  readonly url?: string;
  readonly channelName?: string;
  readonly messageId?: string;
  readonly author?: string;
  readonly sourceName?: string;
  readonly publishedAt?: string | number;
  readonly metrics?: Record<string, number>;
}

interface PlatformEvidence {
  readonly id: string;
  readonly candidateEventId: string;
  readonly platform: Platform;
  readonly status: EvidenceStatus;
  readonly title: string;
  readonly evidence: unknown;
  readonly metrics: Record<string, unknown>;
  readonly report: PlatformReport | null;
  readonly renderedReportText: string;
  readonly createdAt: number;
}

interface FusedEvent {
  readonly schema: "social_fusion_v1";
  readonly event_key: string;
  readonly event_title: string;
  readonly same_event_confidence: number;
  readonly impact_level: string;
  readonly trend: string;
  readonly platform_sequence: readonly Platform[];
  readonly platform_counts?: Record<string, number>;
  readonly core_propagation_nodes?: readonly string[];
  readonly relationship_summary: string;
  readonly recommended_actions?: readonly string[];
  readonly evidence?: readonly string[];
}

interface KanQueueItem {
  readonly id: string;
  readonly fusedEventKey: string;
  readonly dedupeKey?: string;
  readonly duplicateOfQueueId?: string | null;
  readonly status: string;
  readonly reason: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: number;
}

interface KanPlatformEvidenceSnapshot {
  readonly platform: Platform;
  readonly status: EvidenceStatus;
  readonly title: string;
  readonly evidence: unknown;
  readonly evidenceLines?: readonly string[];
}

interface StepLog {
  readonly id: string;
  readonly agentId: string;
  readonly step: string;
  readonly status: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
  readonly createdAt: number;
}

interface PlatformAgentState {
  readonly platform: Platform;
  readonly agentId: string;
  readonly cycle: number;
  readonly status: PlatformAgentStatus;
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
  readonly reflectionSummary?: string;
  readonly observedPatterns?: readonly string[];
}

interface MonitorRun {
  readonly id: string;
  readonly status: MonitorStatus;
  readonly mode: string;
  readonly selectedPlatforms: readonly Platform[];
  readonly maxCandidates: number;
  readonly limitPerPlatform: number;
  readonly continuous: boolean;
  readonly cycleIntervalSeconds: number;
  readonly retentionDays: number;
  readonly currentCycle: number;
  readonly currentStep: string;
  readonly cancelRequested: boolean;
  readonly error: string | null;
  readonly fusion: FusedEvent | null;
  readonly renderedFusionText: string;
  readonly kanDecision: Record<string, unknown> | null;
  readonly platformStates: Partial<Record<Platform, PlatformAgentState>>;
  readonly lastCycleStartedAt: number | null;
  readonly lastCycleCompletedAt: number | null;
  readonly startedAt: number;
  readonly stoppedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly candidates: readonly CandidateEvent[];
  readonly evidence: readonly PlatformEvidence[];
  readonly kanQueue: readonly KanQueueItem[];
  readonly logs: readonly StepLog[];
}

interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

type CrawlerConfigStatus = "ready" | "partial" | "missing-env";

interface CrawlerPlatformConfig {
  readonly id: string;
  readonly label: string;
  readonly status: CrawlerConfigStatus;
  readonly statusLabel: string;
  readonly envExists: boolean;
  readonly configuredRequiredGroups: number;
  readonly totalRequiredGroups: number;
  readonly missingRequiredGroups: readonly string[];
}

interface CrawlerConfigOverview {
  readonly generatedAt: string;
  readonly platforms: readonly CrawlerPlatformConfig[];
}

type SocialFusionView =
  | "overview"
  | "structure"
  | "platforms"
  | "candidates"
  | "review"
  | "evidence"
  | "fusion"
  | "kan"
  | "logs";

const PLATFORM_CONFIGS: readonly PlatformConfig[] = [
  { id: "x", label: "X", agentName: "X Agent" },
  { id: "telegram", label: "Telegram", agentName: "Telegram Agent" },
  { id: "lihkg", label: "LIHKG", agentName: "LIHKG Agent" },
  { id: "facebook", label: "Facebook", agentName: "Facebook Agent" },
  { id: "github", label: "GitHub", agentName: "GitHub Agent" },
  { id: "instagram", label: "Instagram", agentName: "Instagram Agent" },
  { id: "lien", label: "Lien", agentName: "Lien Agent" },
  { id: "netlight", label: "NetLight", agentName: "NetLight Agent" },
  { id: "ptt", label: "PTT", agentName: "PTT Agent" },
  { id: "youtube", label: "YouTube", agentName: "YouTube Agent" },
];

function platformConfig(platform: Platform): PlatformConfig {
  return PLATFORM_CONFIGS.find((item) => item.id === platform) ?? {
    id: platform,
    label: platform,
    agentName: `${platform} Agent`,
  };
}

function formatTime(sec?: number | null): string {
  if (!sec) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(sec * 1000));
}

function compactNumber(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function percent(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function statusLabel(status: string): string {
  if (status === "running") return "运行中";
  if (status === "stopping") return "正在停止";
  if (status === "stopped") return "已停止";
  if (status === "failed") return "失败";
  if (status === "completed") return "已完成";
  if (status === "idle") return "等待";
  if (status === "watching") return "观察中";
  if (status === "found") return "也发现了";
  if (status === "not_found") return "未发现";
  if (status === "missing_config") return "缺少配置";
  if (status === "error") return "异常";
  if (status === "skipped") return "已跳过";
  if (status === "relevant") return "风险通过";
  if (status === "deep_crawled") return "已深挖";
  if (status === "fused") return "已融合";
  if (status === "pending") return "待推送";
  if (status === "held") return "暂不推送";
  if (status === "sent") return "已推送";
  return status || "未知";
}

function statusClass(status: string): string {
  if (["running", "watching", "found", "relevant", "deep_crawled", "fused", "completed", "pending"].includes(status)) {
    return "bg-success-subtle text-success";
  }
  if (["stopping", "missing_config", "held", "fallback"].includes(status)) {
    return "bg-warning-subtle text-warning";
  }
  if (["failed", "error"].includes(status)) return "bg-danger-subtle text-danger";
  if (status === "skipped") return "bg-bg-3 text-muted";
  return "bg-bg-3 text-muted";
}

function crawlerConfigClass(status?: CrawlerConfigStatus): string {
  if (status === "ready") return "bg-success-subtle text-success";
  if (status === "partial") return "bg-warning-subtle text-warning";
  if (status === "missing-env") return "bg-danger-subtle text-danger";
  return "bg-bg-3 text-muted";
}

function crawlerConfigLabel(status?: CrawlerConfigStatus): string {
  if (status === "ready") return "当前配置已就绪";
  if (status === "partial") return "当前配置不完整";
  if (status === "missing-env") return "当前配置文件缺失";
  return "当前配置未检查";
}

function relevanceLabel(value?: string): string {
  if (value === "direct") return "直接相关";
  if (value === "indirect") return "间接相关";
  if (value === "none") return "不相关";
  if (value === "uncertain") return "不确定";
  return "未判断";
}

function actionLabel(value?: string): string {
  if (value === "deep_crawl") return "深度爬取";
  if (value === "shallow_watch") return "浅层观察";
  if (value === "skip") return "跳过";
  return "未决定";
}

function localizedMonitorText(value?: string | null): string {
  if (!value) return "";
  const labels: Record<string, string> = {
    "Stopped old social monitor after web restart": "服务重启后已停止旧的巡逻任务",
    "Old background task disappeared after web restart; marked stopped":
      "服务重启后后台任务不存在，已自动停止",
  };
  return labels[value] ?? value;
}

function gateDecisionLabel(gate?: GateResult | null): string {
  if (!gate) return "等待判断";
  return gate.deep_crawl_allowed ? "允许深挖" : "不深挖";
}

function chinaImpactLabel(value?: string): string {
  if (value === "threatening") return "威胁";
  if (value === "negative") return "负面";
  if (value === "neutral") return "中性";
  if (value === "beneficial") return "正面";
  if (value === "uncertain") return "不确定";
  return "未判断";
}

function riskCategoryLabel(value: string): string {
  const labels: Record<string, string> = {
    national_security: "国家安全",
    public_security: "公共安全",
    social_stability: "社会稳定",
    territorial_sovereignty: "主权领土",
    foreign_interference: "外部干预",
    economic_security: "经济安全",
    public_health: "公共卫生",
    reputation_attack: "形象攻击",
    disinformation: "虚假信息",
    cyber_security: "网络安全",
    none: "无明确风险",
  };
  return labels[value] ?? value;
}

function impactLabel(value?: string): string {
  if (value === "Critical") return "严重";
  if (value === "High") return "高";
  if (value === "Medium") return "中";
  if (value === "Low") return "低";
  return "未知";
}

function trendLabel(value?: string): string {
  if (value === "rising") return "上升";
  if (value === "stable") return "稳定";
  if (value === "declining") return "下降";
  if (value === "uncertain") return "不确定";
  return "未知";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function arrayField(value: unknown, key: string): readonly unknown[] {
  const field = asRecord(value)?.[key];
  return Array.isArray(field) ? field : [];
}

function stringArray(value: unknown, key: string): readonly string[] {
  return arrayField(value, key).filter((item): item is string => typeof item === "string");
}

function numberMetric(metrics: Record<string, unknown>, key: string): number {
  const value = metrics[key];
  return typeof value === "number" ? value : 0;
}

function stringField(value: unknown, key: string): string {
  const field = asRecord(value)?.[key];
  return typeof field === "string" ? field : "";
}

function numberOrStringField(value: unknown, key: string): string {
  const field = asRecord(value)?.[key];
  if (typeof field === "string") return field;
  if (typeof field === "number") return String(field);
  return "";
}

function evidenceItemsFromValue(value: unknown): readonly EvidenceItem[] {
  const record = asRecord(value);
  const items = record?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      type: stringField(item, "type"),
      title: stringField(item, "title"),
      content: stringField(item, "content"),
      url: stringField(item, "url"),
      channelName: stringField(item, "channelName"),
      messageId: numberOrStringField(item, "messageId"),
      author: stringField(item, "author"),
      sourceName: stringField(item, "sourceName"),
      publishedAt: item.publishedAt as string | number | undefined,
      metrics: asRecord(item.metrics) as Record<string, number> | undefined,
    }));
}

function candidateEvidenceItems(candidate: CandidateEvent): readonly EvidenceItem[] {
  return evidenceItemsFromValue(candidate.raw);
}

function evidenceItemCount(item: PlatformEvidence | null | undefined): number {
  return evidenceItemsFromValue(item?.evidence).length;
}

function hasVerifiableEvidence(item: PlatformEvidence | null | undefined): boolean {
  return item?.status === "found" && evidenceItemCount(item) > 0;
}

function displayStatusWithEvidence(item: PlatformEvidence): string {
  const count = evidenceItemCount(item);
  if (item.status === "found" && count > 0) return `也发现了（${count} 条证据）`;
  if (item.status === "found") return "证据不足";
  return statusLabel(item.status);
}

function crawlerConfigForPlatform(
  config: CrawlerConfigOverview | null,
  platform: Platform,
): CrawlerPlatformConfig | undefined {
  return config?.platforms.find((item) => item.id === platform);
}

function platformReportsFromPayload(payload: Record<string, unknown>): readonly PlatformReport[] {
  const reports = payload.platformReports;
  if (!Array.isArray(reports)) return [];
  return reports
    .map((item) => asRecord(item))
    .filter((item): item is PlatformReport => Boolean(item?.platform && item?.event_title));
}

function platformEvidenceFromPayload(payload: Record<string, unknown>): readonly KanPlatformEvidenceSnapshot[] {
  const snapshots = payload.platformEvidence;
  if (!Array.isArray(snapshots)) return [];
  return snapshots
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item?.platform))
    .map((item) => ({
      platform: item.platform as Platform,
      status: (typeof item.status === "string" ? item.status : "not_found") as EvidenceStatus,
      title: typeof item.title === "string" ? item.title : "",
      evidence: item.evidence,
      evidenceLines: stringArray(item, "evidenceLines"),
    }));
}

function kanMessageFromQueue(item: KanQueueItem | undefined, run: MonitorRun | null): string {
  const message = item ? stringField(item.payload, "message") : "";
  return message || run?.renderedFusionText || "";
}

function kanDedupeFromQueue(item: KanQueueItem | undefined): {
  readonly duplicate: boolean;
  readonly duplicateOfQueueId: string;
  readonly matchedBy: string;
  readonly score: number | null;
  readonly reasons: readonly string[];
} {
  const dedupe = asRecord(item?.payload?.dedupe);
  return {
    duplicate: Boolean(dedupe?.duplicate || item?.duplicateOfQueueId),
    duplicateOfQueueId:
      stringField(dedupe, "duplicateOfQueueId") || item?.duplicateOfQueueId || "",
    matchedBy: stringField(dedupe, "matchedBy") || "",
    score: typeof dedupe?.score === "number" ? dedupe.score : null,
    reasons: stringArray(dedupe ?? {}, "reasons"),
  };
}

function reportEvidenceLines(report: PlatformReport): readonly string[] {
  return Array.isArray(report.evidence)
    ? report.evidence.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function snapshotEvidenceLines(snapshot: KanPlatformEvidenceSnapshot | undefined): readonly string[] {
  if (!snapshot) return [];
  const direct = snapshot.evidenceLines?.filter((item) => item.trim().length > 0) ?? [];
  if (direct.length > 0) return direct;
  return evidenceItemsFromValue(snapshot.evidence).map((item, index) => {
    const parts = [
      `证据 ${index + 1}`,
      item.title ? `标题：${item.title}` : "",
      item.content ? `内容：${item.content}` : "",
      item.url ? `链接：${item.url}` : "",
      item.channelName ? `频道/节点：${item.channelName}` : "",
      item.messageId ? `消息/帖子 ID：${item.messageId}` : "",
      item.publishedAt !== undefined ? `时间：${String(item.publishedAt)}` : "",
    ].filter(Boolean);
    return parts.join("；");
  });
}

function evidenceLinesForReport(
  report: PlatformReport,
  snapshots: readonly KanPlatformEvidenceSnapshot[],
): readonly string[] {
  const snapshot = snapshots.find((item) => item.platform === report.platform);
  const fromSnapshot = snapshotEvidenceLines(snapshot);
  return fromSnapshot.length > 0 ? fromSnapshot : reportEvidenceLines(report);
}

function platformAgentStates(run: MonitorRun | null): readonly PlatformAgentState[] {
  return PLATFORM_CONFIGS.map((platform) => {
    const state = run?.platformStates?.[platform.id];
    const fallback: PlatformAgentState = {
      platform: platform.id,
      agentId: platform.agentName,
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
      improvementPlan: "等待启动后执行本平台自主发现工具。",
      nextAction: "等待启动",
      reflectionSummary: "尚未形成自我复盘。",
      observedPatterns: [],
    };
    return state
      ? {
          ...fallback,
          ...state,
          reflectionSummary: state.reflectionSummary ?? fallback.reflectionSummary,
          observedPatterns: state.observedPatterns ?? fallback.observedPatterns,
        }
      : fallback;
  });
}

function metricsSummary(metrics?: Record<string, number>): string {
  if (!metrics) return "";
  return Object.entries(metrics)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${compactNumber(value)}`)
    .join(" · ");
}

function Panel({
  title,
  subtitle,
  icon,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-bg-1 p-5">
      <div className="mb-4 flex items-start gap-2 border-b border-border pb-4">
        {icon}
        <div className="min-w-0">
          <h3 className="m-0 text-base font-semibold text-strong">{title}</h3>
          {subtitle && <p className="m-0 mt-1 text-sm leading-6 text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

const SOCIAL_FUSION_VIEWS: readonly {
  readonly id: SocialFusionView;
  readonly label: string;
  readonly description: string;
}[] = [
  { id: "overview", label: "总览", description: "运行状态与核心指标" },
  { id: "structure", label: "流程结构", description: "智能体协作链路" },
  { id: "platforms", label: "平台智能体", description: "每个平台的巡逻与复盘" },
  { id: "candidates", label: "候选与门控", description: "事件池和中国风险判断" },
  { id: "review", label: "跨平台复核", description: "各平台是否发现同一事件" },
  { id: "evidence", label: "证据", description: "URL、频道、内容和指标" },
  { id: "fusion", label: "融合结果", description: "传播路径与关系链" },
  { id: "kan", label: "Kan 队列", description: "推送状态与重复过滤" },
  { id: "logs", label: "日志", description: "协作流程步骤记录" },
];

function SocialFusionTabs({
  activeView,
  onChange,
  run,
}: {
  readonly activeView: SocialFusionView;
  readonly onChange: (view: SocialFusionView) => void;
  readonly run: MonitorRun | null;
}) {
  const counts: Partial<Record<SocialFusionView, number>> = {
    platforms: run?.selectedPlatforms.length ?? PLATFORM_CONFIGS.length,
    candidates: run?.candidates.length ?? 0,
    review: run?.evidence.length ?? 0,
    evidence: run?.evidence.reduce((total, item) => total + evidenceItemCount(item), 0) ?? 0,
    kan: run?.kanQueue.length ?? 0,
    logs: run?.logs.length ?? 0,
  };

  return (
    <nav className="rounded-lg border border-border bg-bg-1 p-2" aria-label="社交融合子菜单">
      <div className="grid grid-cols-9 gap-2 max-2xl:grid-cols-5 max-lg:grid-cols-3 max-sm:grid-cols-2">
        {SOCIAL_FUSION_VIEWS.map((view) => {
          const active = activeView === view.id;
          const count = counts[view.id];
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onChange(view.id)}
              className={`min-w-0 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-accent/50 bg-accent-subtle text-foreground"
                  : "border-transparent bg-bg-2 text-muted hover:border-border-2 hover:bg-bg-3"
              }`}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{view.label}</span>
                {typeof count === "number" && count > 0 ? (
                  <span className="shrink-0 rounded-md bg-bg px-2 py-0.5 font-mono text-xs text-faint">
                    {compactNumber(count)}
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block truncate text-xs text-faint">{view.description}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Pill({
  children,
  className = "bg-bg-3 text-muted",
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  tone = "normal",
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "normal" | "success" | "warning" | "danger";
}) {
  const valueClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-foreground";
  return (
    <div className="min-w-0 rounded-lg border border-border bg-bg-2 p-3">
      <div className="text-xs text-faint">{label}</div>
      <div className={`mt-1 truncate font-mono text-sm font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}

function EmptyHint({ text }: { readonly text: string }) {
  return <div className="rounded-lg border border-border bg-bg-2 px-4 py-3 text-sm text-muted">{text}</div>;
}

function EvidenceMiniList({
  items,
  emptyText,
  limit = 4,
  maxHeightClass = "max-h-24",
}: {
  readonly items: readonly string[];
  readonly emptyText: string;
  readonly limit?: number;
  readonly maxHeightClass?: string;
}) {
  if (items.length === 0) {
    return <div className="mt-2 text-xs text-faint">{emptyText}</div>;
  }
  return (
    <div className={`mt-2 ${maxHeightClass} space-y-1 overflow-auto pr-1 text-xs leading-5 text-muted`}>
      {items.slice(0, limit).map((item, index) => (
        <div key={`${item}-${index}`} className="whitespace-pre-wrap break-words">
          {item}
        </div>
      ))}
    </div>
  );
}

function EvidenceItemList({
  items,
  emptyText = "没有可核验证据。",
}: {
  readonly items: readonly EvidenceItem[];
  readonly emptyText?: string;
}) {
  if (items.length === 0) return <EmptyHint text={emptyText} />;
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const metricText = metricsSummary(item.metrics);
        return (
          <div key={`${item.url ?? item.messageId ?? item.title ?? "evidence"}-${index}`} className="rounded-lg border border-border bg-bg p-3">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 font-medium text-foreground">
                {item.title || item.content || `证据 ${index + 1}`}
              </div>
              {item.type && <Pill>{item.type}</Pill>}
            </div>
            {item.content && (
              <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-muted">
                {item.content}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-faint">
              {item.channelName && <span>频道/节点：{item.channelName}</span>}
              {item.sourceName && <span>来源：{item.sourceName}</span>}
              {item.author && <span>作者：{item.author}</span>}
              {item.messageId && <span>消息/帖子 ID：{item.messageId}</span>}
              {item.publishedAt !== undefined && <span>时间：{String(item.publishedAt)}</span>}
              {metricText && <span>指标：{metricText}</span>}
            </div>
            {item.url && (
              <a className="mt-3 block break-all text-sm text-accent hover:underline" href={item.url} target="_blank" rel="noreferrer">
                {item.url}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusOverview({ run }: { readonly run: MonitorRun | null }) {
  const foundCount = run?.evidence.filter((item) => hasVerifiableEvidence(item)).length ?? 0;
  const missingConfigCount = run?.evidence.filter((item) => item.status === "missing_config").length ?? 0;
  const active = run?.status === "running" || run?.status === "stopping";

  return (
    <Panel
      title="自主监控状态"
      subtitle="后端负责巡逻、判断、复核和融合；前端只读取数据库里的运行状态。"
      icon={active ? <Clock size={18} className="text-warning" /> : <RadioTower size={18} className="text-accent" />}
    >
      {run ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill className={statusClass(run.status)}>{statusLabel(run.status)}</Pill>
            <Pill>第 {run.currentCycle} 轮</Pill>
            <Pill>Kan 阈值</Pill>
          </div>
          <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
            <Stat label="当前步骤" value={localizedMonitorText(run.currentStep) || "等待调度"} />
            <Stat label="候选事件" value={compactNumber(run.candidates.length)} />
            <Stat label="平台证据" value={compactNumber(run.evidence.length)} />
            <Stat label="已发现平台" value={compactNumber(foundCount)} tone="success" />
            <Stat label="上次缺配置" value={compactNumber(missingConfigCount)} tone={missingConfigCount > 0 ? "warning" : "normal"} />
            <Stat label="巡逻平台" value={compactNumber(run.selectedPlatforms.length)} />
            <Stat label="启动时间" value={formatTime(run.startedAt)} />
            <Stat label="更新时间" value={formatTime(run.updatedAt)} />
          </div>
          {run.error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{localizedMonitorText(run.error)}</span>
            </div>
          )}
        </>
      ) : (
        <EmptyHint text="还没有自主监控运行。点击“启动智能体”后，系统会自动巡逻各平台并保存状态。" />
      )}
    </Panel>
  );
}

function PlatformAgentStatePanel({
  run,
  crawlerConfig,
}: {
  readonly run: MonitorRun | null;
  readonly crawlerConfig: CrawlerConfigOverview | null;
}) {
  const states = platformAgentStates(run);
  const activeCount = states.filter((state) => state.status === "running" || state.status === "watching").length;

  return (
    <Panel
      title="平台智能体状态"
      subtitle="这里同时展示当前爬虫配置自检和上次智能体运行结果；如果刚改过配置，需要重新启动智能体刷新运行记录。"
      icon={<RadioTower size={18} className="text-accent" />}
    >
      <div className="mb-4 grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <Stat label="持续巡逻" value={run?.continuous ? "开启" : "关闭"} tone={run?.continuous ? "success" : "normal"} />
        <Stat label="巡逻间隔" value={run ? `${run.cycleIntervalSeconds} 秒` : "300 秒"} />
        <Stat label="时间窗口" value={run ? `最近 ${run.retentionDays} 天` : "最近 30 天"} />
        <Stat label="活跃平台" value={compactNumber(activeCount)} tone={activeCount > 0 ? "success" : "normal"} />
        <Stat label="本轮开始" value={formatTime(run?.lastCycleStartedAt)} />
        <Stat label="上轮完成" value={formatTime(run?.lastCycleCompletedAt)} />
        <Stat label="深挖上限" value={compactNumber(run?.maxCandidates ?? 10)} />
        <Stat label="每平台数量" value={compactNumber(run?.limitPerPlatform ?? 3)} />
      </div>
      <div className="grid grid-cols-2 gap-3 max-xl:grid-cols-1">
        {states.map((state) => {
          const currentConfig = crawlerConfigForPlatform(crawlerConfig, state.platform);
          const staleMissingConfig = currentConfig?.status === "ready" && state.status === "missing_config" && run?.status !== "running";
          return (
            <article key={state.platform} className="rounded-lg border border-border bg-bg-2 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-foreground">{platformConfig(state.platform).agentName}</div>
                  <div className="mt-1 text-xs text-faint">
                    第 {state.cycle} 轮 · {state.lastStep || "未运行"} · 上次检查 {formatTime(state.lastCheckedAt)}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Pill className={crawlerConfigClass(currentConfig?.status)}>
                    {crawlerConfigLabel(currentConfig?.status)}
                  </Pill>
                  <Pill className={statusClass(state.status)}>上次运行：{statusLabel(state.status)}</Pill>
                </div>
              </div>
              {staleMissingConfig && (
                <div className="mb-3 rounded-lg border border-warning/20 bg-warning-subtle px-3 py-2 text-xs leading-5 text-warning">
                  当前配置自检已经就绪，但最近一次运行记录仍是“缺少配置”。这通常是旧运行状态，需要重新启动智能体后刷新。
                </div>
              )}
              {currentConfig?.missingRequiredGroups.length ? (
                <div className="mb-3 rounded-lg border border-border bg-bg px-3 py-2 text-xs leading-5 text-muted">
                  待补配置：{currentConfig.missingRequiredGroups.join("、")}
                </div>
              ) : null}
              <div className="grid grid-cols-5 gap-2 text-xs max-lg:grid-cols-2">
                <Stat label="候选" value={compactNumber(state.discoveredCount)} />
                <Stat label="原始" value={compactNumber(state.rawRecordCount)} />
                <Stat label="证据" value={compactNumber(state.evidenceCount)} tone={state.evidenceCount > 0 ? "success" : "normal"} />
                <Stat label="跳过" value={compactNumber(state.skippedCount)} />
                <Stat label="错误" value={compactNumber(state.errorCount)} tone={state.errorCount > 0 ? "danger" : "normal"} />
              </div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-muted">
                <div>
                  <span className="font-medium text-foreground">规律总结：</span>
                  <span className="whitespace-pre-wrap break-words">{state.patternSummary || "暂无"}</span>
                </div>
                <div>
                  <span className="font-medium text-foreground">自我复盘：</span>
                  <span className="whitespace-pre-wrap break-words">{state.reflectionSummary || "暂无"}</span>
                </div>
                {state.observedPatterns?.length ? (
                  <div>
                    <span className="font-medium text-foreground">规律观察：</span>
                    <EvidenceMiniList items={state.observedPatterns} emptyText="暂无规律观察" />
                  </div>
                ) : null}
                {state.failureSummary && (
                  <div>
                    <span className="font-medium text-foreground">失败原因：</span>
                    <span className="whitespace-pre-wrap break-words">{state.failureSummary}</span>
                  </div>
                )}
                <div>
                  <span className="font-medium text-foreground">改进计划：</span>
                  <span className="whitespace-pre-wrap break-words">{state.improvementPlan || "暂无"}</span>
                </div>
                <div>
                  <span className="font-medium text-foreground">下一步：</span>
                  <span className="whitespace-pre-wrap break-words">{state.nextAction || "等待调度"}</span>
                </div>
              </div>
              <EvidenceMiniList items={state.lastFindings} emptyText="暂无本平台发现记录" />
              {state.lastError && (
                <div className="mt-3 rounded-lg border border-danger/20 bg-danger-subtle px-3 py-2 text-xs text-danger">
                  {state.lastError}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function ProcessStructurePanel() {
  const steps = [
    {
      title: "平台发现智能体",
      body: "X、Telegram、LIHKG、Facebook、GitHub、Instagram、Lien、NetLight、PTT、YouTube 各自调用本平台工具，自主发现最近一个月内的最新、热门或异常事件。",
    },
    {
      title: "候选事件池",
      body: "平台发现结果先进入候选事件池，保留公开内容、来源平台、发布时间和可核验证据。",
    },
    {
      title: "中国相关性与风险门槛",
      body: "只判断候选事件是否中国相关，以及是否威胁中国安全或对中国不利；不通过则归档或低优先级观察。",
    },
    {
      title: "社交总控 Agent",
      body: "对通过门槛的候选事件下发复核任务，要求其他平台返回结构化的“也发现了”或“未发现”。",
    },
    {
      title: "平台深挖工具",
      body: "发现同一事件的平台继续抓取 URL、频道、帖子、评论、传播指标和时间线；未发现的平台也要记录复核结论。",
    },
    {
      title: "Social Fusion Agent",
      body: "融合各平台证据，判断是否为同一事件，生成传播路径、关系链、核心节点、影响等级和趋势。",
    },
    {
      title: "Kan 推送队列",
      body: "达到阈值后进入 Kan 推送队列；同一事件会先做重复过滤，避免反复推送。",
    },
  ];

  return (
    <Panel
      title="智能体协作结构"
      subtitle="主流程是自主发现、门槛判断、跨平台复核、深挖证据、融合分析、进入 Kan 推送队列。"
      icon={<GitBranch size={18} className="text-accent" />}
    >
      <div className="grid grid-cols-7 gap-3 max-2xl:grid-cols-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {steps.map((step, index) => (
          <article key={step.title} className="min-w-0 rounded-lg border border-border bg-bg-2 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-subtle font-mono text-xs font-semibold text-accent">
                {index + 1}
              </span>
              <div className="truncate font-semibold text-foreground">{step.title}</div>
            </div>
            <p className="m-0 text-sm leading-6 text-muted">{step.body}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function CandidatePool({ run }: { readonly run: MonitorRun | null }) {
  return (
    <Panel
      title="最新候选事件"
      subtitle="平台发现智能体先从各自平台形成候选事件池。"
      icon={<Search size={18} className="text-accent" />}
    >
      {run?.candidates.length ? (
        <div className="space-y-3">
          {run.candidates.map((candidate) => (
            <article key={candidate.id} className="rounded-lg border border-border bg-bg-2 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-foreground">{candidate.title}</div>
                <div className="flex flex-wrap gap-2">
                  <Pill>{platformConfig(candidate.sourcePlatform).label}</Pill>
                  <Pill className={statusClass(candidate.status)}>{statusLabel(candidate.status)}</Pill>
                </div>
              </div>
              <p className="m-0 text-sm leading-6 text-muted">{candidate.summary || "暂无摘要"}</p>
              <div className="mt-3 text-xs text-faint">发现时间：{formatTime(candidate.discoveredAt)}</div>
              <div className="mt-3">
                <EvidenceItemList
                  items={candidateEvidenceItems(candidate)}
                  emptyText="这个候选事件没有保存到可核验证据，建议重新运行智能体。"
                />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyHint text="暂时没有候选事件。若平台没有真实返回或配置缺失，这里会保持为空。" />
      )}
    </Panel>
  );
}

function GateQueue({ run }: { readonly run: MonitorRun | null }) {
  const candidates = run?.candidates ?? [];
  return (
    <Panel
      title="中国相关性与风险判断队列"
      subtitle="只有同时属于中国相关，并且存在威胁中国安全或对中国不利的风险，才会进入跨平台深挖。"
      icon={<ShieldCheck size={18} className="text-success" />}
    >
      {candidates.length ? (
        <div className="space-y-2">
          {candidates.map((candidate) => {
            const gate = candidate.chinaRelevance;
            const riskCategories = gate?.risk_categories?.length
              ? gate.risk_categories
              : ["none"];
            return (
              <div key={candidate.id} className="grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3 rounded-lg border border-border bg-bg-2 p-3 text-sm max-2xl:grid-cols-2 max-lg:grid-cols-1">
                <div>
                  <div className="font-semibold text-foreground">{platformConfig(candidate.sourcePlatform).label}</div>
                  <Pill className={gate?.deep_crawl_allowed ? "bg-success-subtle text-success" : "bg-bg-3 text-muted"}>
                    {gateDecisionLabel(gate)}
                  </Pill>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-xs text-faint">中国相关性</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{relevanceLabel(gate?.china_relevance)}</span>
                    <span className="font-mono text-muted">{percent(gate?.score)}</span>
                  </div>
                  <EvidenceMiniList items={gate?.evidence ?? []} emptyText="暂无相关性证据" />
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-xs text-faint">风险判断</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{chinaImpactLabel(gate?.china_impact)}</span>
                    <span className="font-mono text-muted">{percent(gate?.risk_score)}</span>
                    {gate?.threat_to_china_security && <Pill className="bg-danger-subtle text-danger">安全风险</Pill>}
                    {gate?.negative_to_china && <Pill className="bg-warning-subtle text-warning">负面风险</Pill>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {riskCategories.slice(0, 3).map((category) => (
                      <span key={category} className="rounded bg-bg-3 px-2 py-0.5 text-xs text-muted">
                        {riskCategoryLabel(category)}
                      </span>
                    ))}
                  </div>
                  <EvidenceMiniList items={gate?.risk_evidence ?? []} emptyText="暂无风险证据" />
                </div>
                <div className="min-w-0 text-muted">
                  <div className="mb-1 text-xs text-faint">动作与原因</div>
                  <span className="mr-2 font-semibold text-foreground">{actionLabel(gate?.recommended_action)}</span>
                  <span className="whitespace-pre-wrap break-words">{gate?.reason ?? "等待判断"}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyHint text="候选事件出现后，这里会显示中国相关性与风险门槛判断结果。" />
      )}
    </Panel>
  );
}

function ReviewProgress({ run }: { readonly run: MonitorRun | null }) {
  const evidenceByPlatform = new Map<Platform, PlatformEvidence>();
  run?.evidence.forEach((item) => evidenceByPlatform.set(item.platform, item));

  return (
    <Panel
      title="跨平台复核进度"
      subtitle="社交总控 Agent 会通知每个平台智能体返回“也发现了”或“未发现”。"
      icon={<GitBranch size={18} className="text-accent" />}
    >
      <div className="grid grid-cols-5 gap-3 max-xl:grid-cols-3 max-md:grid-cols-2 max-sm:grid-cols-1">
        {PLATFORM_CONFIGS.map((platform) => {
          const evidence = evidenceByPlatform.get(platform.id);
          return (
            <div key={platform.id} className="rounded-lg border border-border bg-bg-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{platform.label}</span>
                <Pill className={statusClass(hasVerifiableEvidence(evidence) ? "found" : evidence?.status ?? "idle")}>
                  {evidence ? displayStatusWithEvidence(evidence) : "等待"}
                </Pill>
              </div>
              <div className="space-y-1 text-xs text-muted">
                <div>Agent：{platform.agentName}</div>
                <div>证据：{compactNumber(evidenceItemCount(evidence))}</div>
                <div>原始返回：{compactNumber(numberMetric(evidence?.metrics ?? {}, "rawRecordCount"))}</div>
                <div>质量：{String(evidence?.metrics.qualityStatus ?? "未运行")}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function EvidenceList({ run }: { readonly run: MonitorRun | null }) {
  const evidence = run?.evidence ?? [];

  return (
    <Panel
      title="平台证据列表"
      subtitle="证据只显示公开 URL、频道、节点、内容摘要和传播指标，不展示本机路径、Cookie 或状态文件。"
      icon={<RadioTower size={18} className="text-accent" />}
    >
      {evidence.length ? (
        <div className="space-y-3">
          {evidence.map((item) => {
            const evidenceRecord = asRecord(item.evidence);
            const urls = stringArray(evidenceRecord, "urls");
            const nodes = stringArray(evidenceRecord, "nodes");
            const items = evidenceItemsFromValue(item.evidence);
            const evidenceEnough = item.status === "found" && items.length > 0;
            return (
              <article key={item.id} className="rounded-lg border border-border bg-bg-2 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-foreground">{platformConfig(item.platform).agentName}</div>
                  <Pill className={statusClass(evidenceEnough ? "found" : item.status)}>
                    {displayStatusWithEvidence(item)}
                  </Pill>
                </div>
                <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
                  <Stat label="可核验证据" value={compactNumber(items.length)} tone={evidenceEnough ? "success" : "warning"} />
                  <Stat label="原始返回" value={compactNumber(numberMetric(item.metrics, "rawRecordCount"))} />
                  <Stat label="工具质量" value={String(item.metrics.qualityStatus ?? "未知")} />
                </div>
                {item.status === "found" && items.length === 0 && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>该平台返回了 found 状态，但没有公开内容、URL、频道或消息 ID，因此不计入有效发现。</span>
                  </div>
                )}
                <div className="mt-3">
                  <EvidenceItemList items={items} emptyText="未保存到公开内容或 URL 证据。" />
                </div>
                {nodes.length > 0 && (
                  <div className="mt-3 text-sm text-muted">
                    <span className="font-medium text-foreground">公开节点：</span>
                    {nodes.slice(0, 8).join("、")}
                  </div>
                )}
                {urls.length > 0 && (
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="font-medium text-foreground">URL 证据：</div>
                    {urls.slice(0, 5).map((url) => (
                      <a key={url} className="block break-all text-accent hover:underline" href={url} target="_blank" rel="noreferrer">
                        {url}
                      </a>
                    ))}
                  </div>
                )}
                {item.renderedReportText && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-accent">查看智能体分析报告（非证据主体）</summary>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 font-mono text-xs leading-relaxed text-foreground">
                      {item.renderedReportText}
                    </pre>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyHint text="跨平台复核开始后，这里会逐个平台展示结构化证据。" />
      )}
    </Panel>
  );
}

function FusionGraph({ event }: { readonly event: FusedEvent | null }) {
  return (
    <Panel
      title="融合事件关系图"
      subtitle="Social Fusion Agent 判断是否为同一事件，并生成传播路径、关系链条和影响等级。"
      icon={<Network size={18} className="text-accent" />}
    >
      {event ? (
        <>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-semibold text-strong">{event.event_title}</div>
              <div className="mt-1 text-sm text-muted">{event.relationship_summary || "暂无关系摘要"}</div>
            </div>
            <Pill className={statusClass(event.impact_level === "High" || event.impact_level === "Critical" ? "held" : "completed")}>
              影响等级：{impactLabel(event.impact_level)}
            </Pill>
          </div>
          <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
            <Stat label="同一事件置信度" value={percent(event.same_event_confidence)} />
            <Stat label="趋势" value={trendLabel(event.trend)} tone={event.trend === "rising" ? "success" : "normal"} />
            <Stat label="核心传播节点" value={compactNumber(event.core_propagation_nodes?.length ?? 0)} />
            <Stat label="覆盖平台" value={compactNumber(event.platform_sequence.length)} />
          </div>
          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold text-faint">传播路径</div>
            {event.platform_sequence.length ? (
              <div className="flex flex-wrap items-center gap-2">
                {event.platform_sequence.map((platform, index) => (
                  <span key={`${platform}-${index}`} className="inline-flex items-center gap-2">
                    <Pill className="bg-bg-3 text-foreground">{platformConfig(platform).label}</Pill>
                    {index < event.platform_sequence.length - 1 && <span className="text-faint">↓</span>}
                  </span>
                ))}
              </div>
            ) : (
              <EmptyHint text="暂未形成明确传播路径。" />
            )}
          </div>
        </>
      ) : (
        <EmptyHint text="平台证据报告生成后，融合智能体会在这里输出关系链条和传播路径。" />
      )}
    </Panel>
  );
}

function KanQueuePanel({ run }: { readonly run: MonitorRun | null }) {
  const latest = run?.kanQueue[0];
  const message = kanMessageFromQueue(latest, run);
  const dedupe = kanDedupeFromQueue(latest);
  const platformReports = latest ? platformReportsFromPayload(latest.payload) : [];
  const evidenceSnapshots = latest ? platformEvidenceFromPayload(latest.payload) : [];
  const foundReports = platformReports.filter(
    (report) => report.detection_status !== "not_found" && evidenceLinesForReport(report, evidenceSnapshots).length > 0,
  );
  const notFoundReports = platformReports.filter(
    (report) => report.detection_status === "not_found" || evidenceLinesForReport(report, evidenceSnapshots).length === 0,
  );
  return (
    <Panel
      title="待推送 Kan 事件"
      subtitle="达到阈值后由统一 Kan 推送配置处理；同一事件会先做重复过滤，避免反复推送。"
      icon={<CheckCircle2 size={18} className="text-success" />}
    >
      {latest ? (
        <div className="rounded-lg border border-border bg-bg-2 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Pill className={statusClass(latest.status)}>{statusLabel(latest.status)}</Pill>
            <span className="text-xs text-faint">{formatTime(latest.createdAt)}</span>
          </div>
          <p className="m-0 text-sm leading-6 text-muted">{latest.reason}</p>
          {dedupe.duplicate && (
            <div className="mt-4 rounded-lg border border-border bg-bg p-3 text-sm leading-6 text-muted">
              <div className="font-semibold text-foreground">重复事件过滤</div>
              {dedupe.duplicateOfQueueId && (
                <div>已由历史推送记录覆盖：{dedupe.duplicateOfQueueId}</div>
              )}
              {dedupe.score !== null && (
                <div>相似度：{Math.round(dedupe.score * 100)}%</div>
              )}
              {dedupe.matchedBy && <div>匹配方式：{dedupe.matchedBy}</div>}
              {dedupe.reasons.length > 0 && (
                <div>原因：{dedupe.reasons.join("；")}</div>
              )}
            </div>
          )}
          {message && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold text-faint">最终 Kan 推送内容</div>
              <pre className="max-h-[620px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-bg p-4 font-mono text-xs leading-6 text-foreground">
                {message}
              </pre>
            </div>
          )}
          {foundReports.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-xs font-semibold text-faint">入队证据</div>
              {foundReports.map((report) => (
                <div key={`${latest.id}-${report.platform}`} className="rounded-lg border border-border bg-bg p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{platformConfig(report.platform).agentName}</span>
                    <Pill className={statusClass("found")}>也发现了</Pill>
                  </div>
                  <EvidenceMiniList
                    items={evidenceLinesForReport(report, evidenceSnapshots)}
                    emptyText="没有公开证据。"
                    limit={8}
                    maxHeightClass="max-h-72"
                  />
                </div>
              ))}
            </div>
          )}
          {notFoundReports.length > 0 && (
            <div className="mt-4 text-sm leading-6 text-muted">
              <span className="font-medium text-foreground">未发现或证据不足平台：</span>
              {notFoundReports.map((report) => platformConfig(report.platform).label).join("、")}
            </div>
          )}
        </div>
      ) : (
        <EmptyHint text="还没有事件进入 Kan 推送队列。" />
      )}
    </Panel>
  );
}

function LogsPanel({ run }: { readonly run: MonitorRun | null }) {
  const logs = run?.logs.slice(-12) ?? [];
  return (
    <Panel title="智能体步骤日志" subtitle="用于验收完整协作流程：发现、判断、复核、融合、Kan 阈值。" icon={<Clock size={18} className="text-accent" />}>
      {logs.length ? (
        <div className="space-y-2">
          {logs.map((item) => (
            <div key={item.id} className="grid grid-cols-[110px_180px_90px_minmax(0,1fr)] gap-3 rounded-lg border border-border bg-bg-2 p-3 text-sm max-xl:grid-cols-1">
              <div className="text-faint">{formatTime(item.createdAt)}</div>
              <div className="font-mono text-xs text-muted">{item.agentId}</div>
              <div><Pill className={statusClass(item.status)}>{statusLabel(item.status)}</Pill></div>
              <div className="min-w-0 text-muted">{item.message}</div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyHint text="运行后会显示智能体步骤日志。" />
      )}
    </Panel>
  );
}

export default function SocialFusion() {
  const [run, setRun] = useState<MonitorRun | null>(null);
  const [crawlerConfig, setCrawlerConfig] = useState<CrawlerConfigOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState<SocialFusionView>("overview");
  const [selectedPlatforms, setSelectedPlatforms] = useState<readonly Platform[]>(
    () => PLATFORM_CONFIGS.map((item) => item.id),
  );
  const [limit, setLimit] = useState(3);
  const [maxCandidates, setMaxCandidates] = useState(10);
  const [cycleIntervalSeconds, setCycleIntervalSeconds] = useState(300);
  const [retentionDays, setRetentionDays] = useState(30);

  const active = run?.status === "running" || run?.status === "stopping";
  const selectedPlatformSet = useMemo(() => new Set(selectedPlatforms), [selectedPlatforms]);

  async function loadLatest(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch<ApiResponse<MonitorRun | null>>("/api/social/monitor/latest");
      if (res.success) setRun(res.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取自主监控状态失败。");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadCrawlerConfig(silent = false) {
    try {
      const res = await apiFetch<ApiResponse<CrawlerConfigOverview>>("/api/crawler-config");
      if (res.success && res.data) setCrawlerConfig(res.data);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "读取爬虫配置自检失败。");
    }
  }

  useEffect(() => {
    loadLatest();
    loadCrawlerConfig(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => loadLatest(true), 3000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    const onFocus = () => loadLatest(true);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        loadLatest(true);
        loadCrawlerConfig(true);
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  async function startMonitor() {
    setStarting(true);
    setError("");
    try {
      const res = await apiFetch<ApiResponse<MonitorRun>>("/api/social/monitor/start", {
        method: "POST",
        body: JSON.stringify({
          platforms: selectedPlatforms,
          mode: "probe",
          limit,
          maxCandidates,
          continuous: true,
          cycleIntervalSeconds,
          retentionDays,
          analysisTimeoutMs: 240_000,
        }),
      });
      if (!res.success || !res.data) {
        setError(res.error ?? "启动智能体失败。");
        return;
      }
      setRun(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动智能体失败。");
      await loadLatest(true);
    } finally {
      setStarting(false);
    }
  }

  async function stopMonitor() {
    if (!run) return;
    setStopping(true);
    setError("");
    try {
      const res = await apiFetch<ApiResponse<MonitorRun>>(`/api/social/monitor/${run.id}/stop`, {
        method: "POST",
      });
      if (res.success) setRun(res.data ?? run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "停止智能体失败。");
    } finally {
      setStopping(false);
      await loadLatest(true);
    }
  }

  function togglePlatform(platform: Platform) {
    setSelectedPlatforms((current) => {
      if (current.includes(platform)) {
        return current.filter((item) => item !== platform);
      }
      return PLATFORM_CONFIGS.filter((item) => item.id === platform || current.includes(item.id)).map((item) => item.id);
    });
  }

  function renderActiveView() {
    if (activeView === "overview") {
      return (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)] gap-5 max-xl:grid-cols-1">
          <StatusOverview run={run} />
          <KanQueuePanel run={run} />
        </div>
      );
    }
    if (activeView === "structure") return <ProcessStructurePanel />;
    if (activeView === "platforms") return <PlatformAgentStatePanel run={run} crawlerConfig={crawlerConfig} />;
    if (activeView === "candidates") {
      return (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)] gap-5 max-xl:grid-cols-1">
          <CandidatePool run={run} />
          <GateQueue run={run} />
        </div>
      );
    }
    if (activeView === "review") return <ReviewProgress run={run} />;
    if (activeView === "evidence") return <EvidenceList run={run} />;
    if (activeView === "fusion") return <FusionGraph event={run?.fusion ?? null} />;
    if (activeView === "kan") return <KanQueuePanel run={run} />;
    return <LogsPanel run={run} />;
  }

  return (
    <div className="max-w-[1500px] space-y-5">
      <PageHeader
        title="社交融合"
        subtitle="平台智能体自主巡逻，先过中国相关性与风险门槛，再跨平台复核，最后由 Social Fusion Agent 生成传播路径和 Kan 推送队列。"
        actions={
          <div className="flex items-center gap-2">
            {active ? (
              <Button variant="danger" onClick={stopMonitor} loading={stopping} disabled={stopping}>
                <Square size={16} />
                停止智能体
              </Button>
            ) : (
              <Button onClick={startMonitor} loading={starting} disabled={starting || selectedPlatforms.length === 0}>
                <Play size={16} />
                启动智能体
              </Button>
            )}
          </div>
        }
      />

      <Panel
        title="自主巡逻配置"
        subtitle="平台 Agent 会自行发现最新、热门或异常事件；通过中国相关性与风险门槛后，再按候选事件复核其他平台证据。"
        icon={<RadioTower size={18} className="text-accent" />}
      >
        <div className="grid grid-cols-[120px_130px_140px_120px_minmax(0,1fr)] gap-3 max-2xl:grid-cols-3 max-lg:grid-cols-1">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-muted">每平台数量</span>
            <input
              type="number"
              min={1}
              max={10}
              value={limit}
              disabled={active}
              onChange={(event) => setLimit(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
              className="w-full rounded-lg border border-border-2 bg-bg px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-accent disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-muted">深挖上限</span>
            <input
              type="number"
              min={1}
              max={50}
              value={maxCandidates}
              disabled={active}
              onChange={(event) => setMaxCandidates(Math.min(50, Math.max(1, Number(event.target.value) || 1)))}
              className="w-full rounded-lg border border-border-2 bg-bg px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-accent disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-muted">巡逻间隔</span>
            <input
              type="number"
              min={10}
              max={86400}
              value={cycleIntervalSeconds}
              disabled={active}
              onChange={(event) => setCycleIntervalSeconds(Math.min(86400, Math.max(10, Number(event.target.value) || 300)))}
              className="w-full rounded-lg border border-border-2 bg-bg px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-accent disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-muted">时间窗口</span>
            <input
              type="number"
              min={1}
              max={31}
              value={retentionDays}
              disabled={active}
              onChange={(event) => setRetentionDays(Math.min(31, Math.max(1, Number(event.target.value) || 30)))}
              className="w-full rounded-lg border border-border-2 bg-bg px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-accent disabled:opacity-60"
            />
          </label>
          <div className="rounded-lg border border-border bg-bg-2 px-4 py-3 text-sm leading-6 text-muted">
            启动后持续巡逻；发现阶段不读取旧词表文件，只保留最近一个月内的公开证据。停止智能体后才会退出循环。
          </div>
        </div>
        <div className="mt-4 grid grid-cols-5 gap-2 max-xl:grid-cols-4 max-md:grid-cols-2">
          {PLATFORM_CONFIGS.map((item) => {
            const selected = selectedPlatformSet.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                disabled={active}
                onClick={() => togglePlatform(item.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected
                    ? "border-accent/50 bg-accent-subtle text-foreground"
                    : "border-border bg-bg-2 text-muted hover:border-border-2 hover:bg-bg-3"
                }`}
              >
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block truncate text-xs text-faint">{item.agentName}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <EmptyHint text="正在读取自主监控状态..." />
      ) : (
        <>
          <SocialFusionTabs activeView={activeView} onChange={setActiveView} run={run} />
          {renderActiveView()}
        </>
      )}

    </div>
  );
}
