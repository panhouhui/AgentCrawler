import type { FusedSocialEvent, PlatformReport } from "./schemas";
import type { SocialPlatform } from "./types";

export type GlobalRadarTier = "major" | "key" | "watch" | "general";
export type GlobalRadarStatus = "new" | "rapid" | "spreading" | "stable" | "cooling";

export interface RadarSnapshotSample {
  readonly capturedAt: number;
  readonly verifiedCount: number;
  readonly platformCounts: Record<string, number>;
  readonly foundPlatforms: readonly string[];
  readonly attentionIndex: number;
  readonly status: GlobalRadarStatus;
  readonly trend: FusedSocialEvent["trend"];
  readonly impactLevel: FusedSocialEvent["impact_level"];
}

export interface RadarPlatformStat {
  readonly platform: SocialPlatform;
  readonly verifiedCount: number;
  readonly deltaSincePrevious: number | null;
  readonly trend: "new" | "rising" | "stable" | "declining" | "unknown";
}

export interface RadarSourceLink {
  readonly platform: SocialPlatform;
  readonly url: string;
}

export interface GlobalRadarEvent {
  readonly schema: "global_radar_v1";
  readonly eventId: string;
  readonly eventKey: string;
  readonly title: string;
  readonly shortSummary: string;
  readonly tier: GlobalRadarTier;
  readonly status: GlobalRadarStatus;
  readonly firstSeenAt: number;
  readonly updatedAt: number;
  readonly foundPlatforms: readonly SocialPlatform[];
  readonly firstPlatform: SocialPlatform | null;
  readonly dominantPlatform: SocialPlatform | null;
  readonly monitoredPlatformCount: number;
  readonly platformStats: readonly RadarPlatformStat[];
  readonly sourceLinks?: readonly RadarSourceLink[];
  readonly topDisputePoints: readonly string[];
  readonly propagationNodes: {
    readonly initial: readonly string[];
    readonly core: readonly string[];
    readonly highImpact: readonly string[];
    readonly relatedEntities: readonly string[];
    readonly abnormalAccounts: readonly string[];
  };
  readonly propagation: {
    readonly phase: string;
    readonly speed: string;
    readonly crossPlatformDiffusion: string;
    readonly discussionGrowth: string;
    readonly forecast: string;
    readonly path: readonly SocialPlatform[];
  };
  readonly aiAssessment: {
    readonly eventType: string;
    readonly scope: string;
    readonly persistence: string;
    readonly anomalyLevel: string;
    readonly credibility: string;
    readonly attentionIndex: number;
    readonly conclusion: string;
  };
  readonly alerts: readonly string[];
  readonly suggestedActions: readonly string[];
  readonly evidenceNote: string;
}

export interface GlobalRadarOverview {
  readonly updatedAt: number;
  readonly monitoredPlatformCount: number;
  readonly dailyVerifiedReportCount: number;
  readonly activeEventCount: number;
  readonly majorEventCount: number;
  readonly keyEventCount: number;
  readonly rapidEventCount: number;
  readonly newEventCount: number;
  readonly topEvents: readonly GlobalRadarEvent[];
  readonly aiSituationSummary: string;
  readonly dataNote: string;
}

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

function uniqueNonEmpty(items: readonly string[], limit = 8): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const value = item.replace(/\s+/g, " ").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

const SOURCE_URL_PATTERN = /https?:\/\/[^\s<>"'，。；、）\]\}]+/giu;

function extractSourceUrls(items: readonly string[]): string[] {
  return uniqueNonEmpty(
    items.flatMap((item) =>
      Array.from(item.matchAll(SOURCE_URL_PATTERN), (match) =>
        match[0]!.replace(/[),.;:!?]+$/g, ""),
      ),
    ),
    3,
  );
}

function reportSourceLinks(report: PlatformReport): RadarSourceLink[] {
  const candidates = [...report.evidence, ...report.core_nodes];
  switch (report.platform) {
    case "x":
      candidates.push(report.main_source);
      break;
    case "telegram":
      candidates.push(...report.channel_path);
      break;
    case "facebook":
      candidates.push(...report.pages);
      break;
    case "lihkg":
      candidates.push(report.topic);
      break;
    case "github":
    case "instagram":
    case "lien":
    case "netlight":
    case "ptt":
    case "youtube":
      candidates.push(...report.source_nodes);
      break;
  }
  return extractSourceUrls(candidates).map((url) => ({ platform: report.platform, url }));
}

function truncate(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1))}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function reportNodeNames(report: PlatformReport): string[] {
  const base = [...report.core_nodes];
  switch (report.platform) {
    case "x":
      return uniqueNonEmpty([...base, report.main_source]);
    case "telegram":
      return uniqueNonEmpty([...base, ...report.channel_path]);
    case "facebook":
      return uniqueNonEmpty([...base, ...report.pages]);
    case "github":
    case "instagram":
    case "lien":
    case "netlight":
    case "ptt":
    case "youtube":
      return uniqueNonEmpty([...base, ...report.source_nodes]);
    case "lihkg":
      return uniqueNonEmpty(base);
  }
}

function determineTier(event: FusedSocialEvent, reports: readonly PlatformReport[]): GlobalRadarTier {
  const risk = Math.max(
    0,
    ...reports
      .filter((report) => report.detection_status !== "not_found")
      .map((report) => report.china_relevance.risk_score),
  );
  if (event.impact_level === "Critical" || risk >= 0.85) return "major";
  if (event.impact_level === "High" || risk >= 0.65 || event.same_event_confidence >= 0.8) {
    return "key";
  }
  if (event.impact_level === "Medium" || reports.length >= 2) return "watch";
  return "general";
}

function determineStatus(input: {
  readonly event: FusedSocialEvent;
  readonly firstSeenAt: number;
  readonly now: number;
  readonly previous: RadarSnapshotSample | null;
  readonly verifiedCount: number;
}): GlobalRadarStatus {
  const { event, firstSeenAt, now, previous, verifiedCount } = input;
  if (event.trend === "declining") return "cooling";
  if (previous && verifiedCount > previous.verifiedCount && event.trend === "rising") {
    return now - previous.capturedAt <= 3600 ? "rapid" : "spreading";
  }
  if (event.trend === "rising") return "spreading";
  if (!previous && now - firstSeenAt <= 3600) return "new";
  return "stable";
}

function platformTrend(
  current: number,
  previous: number | undefined,
): RadarPlatformStat["trend"] {
  if (previous === undefined) return current > 0 ? "new" : "unknown";
  if (current > previous) return "rising";
  if (current < previous) return "declining";
  return "stable";
}

function riskType(reports: readonly PlatformReport[]): string {
  const categories = uniqueNonEmpty(
    reports.flatMap((report) =>
      report.china_relevance.risk_categories.filter((category) => category !== "none"),
    ),
    3,
  );
  if (categories.length === 0) return "跨平台社交舆情事件";
  const labels: Record<string, string> = {
    national_security: "国家安全",
    public_security: "公共安全",
    social_stability: "社会稳定",
    territorial_sovereignty: "主权与领土",
    foreign_interference: "外部干预",
    economic_security: "经济安全",
    public_health: "公共卫生",
    reputation_attack: "声誉攻击",
    disinformation: "失实信息",
    cyber_security: "网络安全",
  };
  return categories.map((category) => labels[category] ?? category).join("、");
}

function statusText(status: GlobalRadarStatus): string {
  switch (status) {
    case "new":
      return "新出现";
    case "rapid":
      return "快速升温";
    case "spreading":
      return "持续扩散";
    case "cooling":
      return "降温";
    case "stable":
      return "平稳";
  }
}

function buildPropagationPhase(status: GlobalRadarStatus): string {
  switch (status) {
    case "new":
      return "发现期";
    case "rapid":
      return "快速扩散期";
    case "spreading":
      return "扩散观察期";
    case "cooling":
      return "回落观察期";
    case "stable":
      return "持续观察期";
  }
}

function evidenceCount(event: FusedSocialEvent, platforms: readonly SocialPlatform[]): number {
  return platforms.reduce(
    (total, platform) => total + Math.max(0, Number(event.platform_counts[platform] ?? 0)),
    0,
  );
}

function attentionIndex(input: {
  readonly event: FusedSocialEvent;
  readonly foundPlatformCount: number;
  readonly maxRisk: number;
  readonly status: GlobalRadarStatus;
}): number {
  const impactBase: Record<FusedSocialEvent["impact_level"], number> = {
    Low: 18,
    Medium: 35,
    High: 53,
    Critical: 68,
  };
  const statusBonus: Record<GlobalRadarStatus, number> = {
    new: 3,
    rapid: 12,
    spreading: 8,
    stable: 2,
    cooling: 0,
  };
  return Math.round(
    clamp(
      impactBase[input.event.impact_level] +
        input.foundPlatformCount * 4 +
        input.event.same_event_confidence * 12 +
        input.maxRisk * 14 +
        statusBonus[input.status],
      0,
      100,
    ),
  );
}

function buildForecast(status: GlobalRadarStatus, hasHistory: boolean): string {
  if (!hasHistory) return "暂无足够连续样本，不做量化预测。";
  if (status === "rapid" || status === "spreading") {
    return "若后续周期继续出现新增可核验命中或新增平台，将维持扩散观察并提高复核优先级。";
  }
  if (status === "cooling") {
    return "当前呈回落信号；仍需在后续周期确认是否出现反复传播。";
  }
  return "当前未见新的连续上升证据，继续保持常规观察。";
}

export function createGlobalRadarEventId(now = Math.floor(Date.now() / 1000)): string {
  const date = new Date(now * 1000);
  const datePart = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `EVT-${datePart}-${suffix}`;
}

export function buildGlobalRadarEvent(input: {
  readonly event: FusedSocialEvent;
  readonly platformReports: readonly PlatformReport[];
  readonly eventId: string;
  readonly firstSeenAt: number;
  readonly updatedAt: number;
  readonly monitoredPlatformCount: number;
  readonly history?: readonly RadarSnapshotSample[];
}): GlobalRadarEvent {
  const history = input.history ?? [];
  const previous = history[0] ?? null;
  const reportByPlatform = new Map(
    input.platformReports.map((report) => [report.platform, report] as const),
  );
  const foundPlatforms = uniqueNonEmpty(
    input.event.platform_sequence.filter(
      (platform) => Number(input.event.platform_counts[platform] ?? 0) > 0,
    ),
  ) as SocialPlatform[];
  const fallbackFound = input.platformReports
    .filter((report) => report.detection_status !== "not_found")
    .map((report) => report.platform);
  const orderedPlatforms = (foundPlatforms.length > 0 ? foundPlatforms : fallbackFound) as SocialPlatform[];
  const verifiedCount = evidenceCount(input.event, orderedPlatforms);
  const status = determineStatus({
    event: input.event,
    firstSeenAt: input.firstSeenAt,
    now: input.updatedAt,
    previous,
    verifiedCount,
  });
  const stats = orderedPlatforms.map((platform) => {
    const current = Math.max(0, Number(input.event.platform_counts[platform] ?? 0));
    const old = previous?.platformCounts[platform];
    return {
      platform,
      verifiedCount: current,
      deltaSincePrevious: old === undefined ? null : current - old,
      trend: platformTrend(current, old),
    };
  });
  const sourceLinks = input.platformReports
    .filter((report) => report.detection_status !== "not_found")
    .flatMap(reportSourceLinks)
    .filter(
      (link, index, links) =>
        links.findIndex((candidate) => candidate.url === link.url) === index,
    )
    .slice(0, 12);
  const dominantPlatform =
    stats
      .slice()
      .sort((left, right) => right.verifiedCount - left.verifiedCount)[0]?.platform ??
    null;
  const firstPlatform =
    input.platformReports
      .filter(
        (report) =>
          report.detection_status !== "not_found" &&
          Number(input.event.platform_counts[report.platform] ?? 0) > 0,
      )
      .slice()
      .sort((left, right) => left.observed_at - right.observed_at)[0]?.platform ??
    orderedPlatforms[0] ??
    null;
  const firstReport = firstPlatform ? reportByPlatform.get(firstPlatform) : undefined;
  const allNodeNames = uniqueNonEmpty([
    ...input.event.core_propagation_nodes,
    ...input.platformReports.flatMap(reportNodeNames),
  ]);
  const initialNodes = firstReport ? reportNodeNames(firstReport).slice(0, 2) : [];
  const relatedEntities = uniqueNonEmpty(
    input.platformReports.flatMap((report) => {
      if (report.platform === "telegram") return report.channel_path;
      if (report.platform === "facebook") return report.pages;
      return [];
    }),
    6,
  );
  const disputePoints = uniqueNonEmpty(
    input.platformReports.flatMap((report) =>
      report.platform === "lihkg" ? report.main_arguments : [],
    ),
    4,
  );
  const maxRisk = Math.max(
    0,
    ...input.platformReports
      .filter((report) => report.detection_status !== "not_found")
      .map((report) => report.china_relevance.risk_score),
  );
  const tier = determineTier(input.event, input.platformReports);
  const attention = attentionIndex({
    event: input.event,
    foundPlatformCount: orderedPlatforms.length,
    maxRisk,
    status,
  });
  const delta = previous ? verifiedCount - previous.verifiedCount : null;
  const elapsedSeconds = previous ? Math.max(1, input.updatedAt - previous.capturedAt) : 0;
  const deltaText =
    delta === null
      ? "暂无足够连续样本"
      : `最近 ${Math.max(1, Math.round(elapsedSeconds / 60))} 分钟可核验命中 ${delta >= 0 ? "+" : ""}${delta}`;
  const scope =
    orderedPlatforms.length >= 4
      ? "多平台扩散"
      : orderedPlatforms.length >= 2
        ? "跨平台传播"
        : "单平台观察";
  const persistence =
    history.length >= 1
      ? `已形成 ${history.length + 1} 个连续观测样本`
      : "暂无足够连续样本";
  const credibility =
    input.event.same_event_confidence >= 0.8
      ? "高：多平台证据一致性较强"
      : input.event.same_event_confidence >= 0.6
        ? "中：已有交叉复核，需持续确认"
        : "初步：证据仍在积累";
  const alerts = uniqueNonEmpty([
    tier === "major" ? "重大事件：建议优先人工复核核心证据与传播节点。" : "",
    status === "rapid" ? "快速升温：本轮可核验命中较上一样本增加。" : "",
    orderedPlatforms.length < 2 ? "跨平台证据不足：当前不应推断完整传播链路。" : "",
    maxRisk >= 0.65 ? "风险信号较高：建议复核风险分类与原始公开证据。" : "",
  ]);
  const actions = uniqueNonEmpty([
    ...input.event.recommended_actions,
    orderedPlatforms.length < 2 ? "继续请求其他平台智能体复核" : "",
    history.length === 0 ? "保留下一轮快照后再判断增长速度" : "",
  ]);
  const shortSummary = truncate(
    firstReport?.summary ||
      input.platformReports[0]?.summary ||
      input.event.relationship_summary ||
      input.event.event_title,
    30,
  ) || truncate(input.event.event_title, 30);

  return {
    schema: "global_radar_v1",
    eventId: input.eventId,
    eventKey: input.event.event_key,
    title: input.event.event_title,
    shortSummary,
    tier,
    status,
    firstSeenAt: input.firstSeenAt,
    updatedAt: input.updatedAt,
    foundPlatforms: orderedPlatforms,
    firstPlatform,
    dominantPlatform,
    monitoredPlatformCount: input.monitoredPlatformCount,
    platformStats: stats,
    sourceLinks,
    topDisputePoints: disputePoints,
    propagationNodes: {
      initial: initialNodes,
      core: allNodeNames.slice(0, 8),
      highImpact: [],
      relatedEntities,
      abnormalAccounts: [],
    },
    propagation: {
      phase: buildPropagationPhase(status),
      speed: deltaText,
      crossPlatformDiffusion:
        orderedPlatforms.length > 0
          ? `${orderedPlatforms.length} 个平台存在可核验命中`
          : "暂无可核验平台命中",
      discussionGrowth: deltaText,
      forecast: buildForecast(status, previous !== null),
      path: orderedPlatforms,
    },
    aiAssessment: {
      eventType: riskType(input.platformReports),
      scope,
      persistence,
      anomalyLevel:
        maxRisk >= 0.8 ? "高" : maxRisk >= 0.6 ? "中" : maxRisk > 0 ? "低" : "待复核",
      credibility,
      attentionIndex: attention,
      conclusion: `${scope}；当前状态为${statusText(status)}。关注指数基于已核验覆盖、融合置信度、风险和趋势计算，不代表全网讨论总量。`,
    },
    alerts,
    suggestedActions: actions,
    evidenceNote:
      "平台数量和命中数均为当前已入库的可核验公开证据，不等同于全网讨论量；未形成连续样本时不展示增长率。",
  };
}

export function buildGlobalRadarOverview(input: {
  readonly events: readonly GlobalRadarEvent[];
  readonly monitoredPlatformCount: number;
  readonly dailyVerifiedReportCount: number;
  readonly updatedAt: number;
}): GlobalRadarOverview {
  const events = input.events.slice();
  const topEvents = events
    .sort((left, right) => right.aiAssessment.attentionIndex - left.aiAssessment.attentionIndex)
    .slice(0, 3);
  const majorEventCount = events.filter((event) => event.tier === "major").length;
  const keyEventCount = events.filter((event) => event.tier === "key").length;
  const rapidEventCount = events.filter((event) => event.status === "rapid").length;
  const newEventCount = events.filter((event) => event.status === "new").length;
  const headline =
    topEvents.length === 0
      ? "当前暂无已形成全域雷达事件的可核验跨平台证据。"
      : `当前重点观察 ${topEvents.length} 起事件；最高关注为「${truncate(topEvents[0]!.title, 30)}」。`;

  return {
    updatedAt: input.updatedAt,
    monitoredPlatformCount: input.monitoredPlatformCount,
    dailyVerifiedReportCount: input.dailyVerifiedReportCount,
    activeEventCount: events.length,
    majorEventCount,
    keyEventCount,
    rapidEventCount,
    newEventCount,
    topEvents,
    aiSituationSummary: headline,
    dataNote:
      "当日数量口径为已入库的平台分析报告；全域雷达只基于公开、可核验的证据进行归并与判断。",
  };
}

export function globalRadarTierLabel(tier: GlobalRadarTier): string {
  const labels: Record<GlobalRadarTier, string> = {
    major: "🔴重大",
    key: "🟠重点",
    watch: "🟡关注",
    general: "🔵一般",
  };
  return labels[tier];
}

export function globalRadarStatusLabel(status: GlobalRadarStatus): string {
  const labels: Record<GlobalRadarStatus, string> = {
    rapid: "🔥快速升温",
    spreading: "↑持续扩散",
    stable: "→平稳",
    cooling: "↓降温",
    new: "🆕新出现",
  };
  return labels[status];
}

export function globalRadarPlatformLabel(platform: SocialPlatform | null): string {
  return platform ? PLATFORM_LABELS[platform] : "暂无";
}
