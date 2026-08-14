import type { FusedSocialEvent, PlatformReport } from "./schemas";

function pct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value)}%`;
}

function listOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join("\n") : "无";
}

function statusLabel(status: string): string {
  if (status === "found") return "也发现了";
  if (status === "not_found") return "未发现";
  if (status === "rapid_spread") return "快速扩散";
  if (status === "watching") return "持续监控";
  if (status === "stable") return "稳定";
  if (status === "declining") return "下降";
  return status;
}

function trendLabel(trend: string): string {
  if (trend === "rising") return "上升";
  if (trend === "stable") return "稳定";
  if (trend === "declining") return "下降";
  if (trend === "uncertain") return "不确定";
  return trend;
}

function impactLabel(impact: string): string {
  if (impact === "Critical") return "严重";
  if (impact === "High") return "高";
  if (impact === "Medium") return "中";
  if (impact === "Low") return "低";
  return impact;
}

const PLATFORM_LABELS: Record<PlatformReport["platform"], string> = {
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

function sanitizePublicLine(value: string): string {
  return value
    .replace(/(?<![A-Za-z])[A-Z]:\\(?:[^\\\r\n"'<>|]+\\)*[^\\\r\n"'<>|]*/gi, "<本机路径已隐藏>")
    .replace(/(?<![A-Za-z])[A-Z]:\/(?:[^/\r\n"'<>|]+\/)*[^/\r\n"'<>|]*/gi, "<本机路径已隐藏>")
    .replace(/\?{6,}/g, "…")
    .trim();
}

function cleanList(items: readonly string[]): readonly string[] {
  return items.map(sanitizePublicLine).filter(Boolean);
}

function reportEvidenceCount(report: PlatformReport): number {
  if (report.detection_status === "not_found") return 0;
  const evidenceCount = cleanList(report.evidence).length;
  if (evidenceCount > 0) return evidenceCount;

  switch (report.platform) {
    case "telegram":
      return report.channel_path.filter((item) => item.trim()).length;
    case "facebook":
      return report.pages.filter((item) => item.trim()).length;
    case "lihkg":
      return report.topic.trim() ? 1 : 0;
    case "x":
      return report.hashtag.trim() || report.main_source.trim() ? 1 : 0;
    case "github":
    case "instagram":
    case "lien":
    case "netlight":
    case "ptt":
    case "youtube":
      return Math.max(0, report.item_count);
  }
}

export function renderPlatformReport(report: PlatformReport): string {
  if (report.detection_status === "not_found") {
    return [
      `${PLATFORM_LABELS[report.platform]} Agent`,
      "未发现",
      "",
      "事件：",
      report.event_title,
      "",
      "状态：",
      "未发现",
    ].join("\n");
  }

  switch (report.platform) {
    case "x":
      return [
        "X Agent",
        "发现异常事件：",
        report.hashtag || report.event_title,
        "",
        "过去30分钟：",
        `讨论量 ${pct(report.discussion_growth_percent)}`,
        "",
        "参与账号：",
        String(report.participant_accounts),
        "",
        "主要来源：",
        report.main_source,
        "",
        "状态：",
        statusLabel(report.status),
      ].join("\n");

    case "telegram":
      return [
        "Telegram Agent",
        report.channel_path.join("\n   |\n   |") || "未形成明确频道路径",
        "",
        "共同传播内容：",
        `${Math.round(report.shared_content_percent)}%`,
      ].join("\n");

    case "lihkg":
      return [
        "LIHKG Agent",
        "热门讨论：",
        "",
        "主题：",
        report.topic || report.event_title,
        "",
        "热度：",
        report.heat || "未知",
        "",
        "参与人数：",
        String(report.participant_count),
        "",
        "主要观点：",
        "",
        "支持：",
        `${Math.round(report.stance.support_percent)}%`,
        "",
        "反对：",
        `${Math.round(report.stance.oppose_percent)}%`,
        "",
        "中立：",
        `${Math.round(report.stance.neutral_percent)}%`,
      ].join("\n");

    case "facebook":
      return [
        "Facebook Agent",
        "页面：",
        "",
        listOrNone(report.pages),
        "",
        "过去24小时：",
        "",
        "新增互动：",
        pct(report.interaction_growth_percent),
        "",
        "传播用户：",
        String(report.propagation_users),
        "",
        "影响区域：",
        listOrNone(report.influence_regions),
      ].join("\n");

    case "github":
    case "instagram":
    case "lien":
    case "netlight":
    case "ptt":
    case "youtube":
      return [
        `${PLATFORM_LABELS[report.platform]} Agent`,
        "也发现了",
        "",
        "事件：",
        report.event_title,
        "",
        "命中数量：",
        String(report.item_count),
        "",
        "增长：",
        pct(report.growth_percent),
        "",
        "主要节点：",
        listOrNone(report.source_nodes.length > 0 ? report.source_nodes : report.core_nodes),
        "",
        "共同传播内容：",
        `${Math.round(report.content_overlap_percent)}%`,
        "",
        "状态：",
        statusLabel(report.status),
      ].join("\n");
  }
}

export function renderFusedEvent(event: FusedSocialEvent): string {
  const path =
    event.platform_sequence.length > 0
      ? event.platform_sequence.join("\n ↓\n")
      : "未知";

  return [
    "Social Fusion Agent",
    "",
    "事件：",
    event.event_title,
    "",
    "影响等级：",
    event.impact_level,
    "",
    "传播路径：",
    "",
    path,
    "",
    "核心传播节点：",
    String(event.core_propagation_nodes.length),
    "",
    "趋势：",
    trendLabel(event.trend),
    "",
    "关系判断：",
    event.relationship_summary,
  ].join("\n");
}

export function renderSocialFusionKanMessage(input: {
  readonly event: FusedSocialEvent;
  readonly platformReports: readonly PlatformReport[];
  readonly decisionReason?: string;
}): string {
  const foundReports = input.platformReports.filter(
    (report) => report.detection_status !== "not_found" && reportEvidenceCount(report) > 0,
  );
  const notFoundReports = input.platformReports.filter(
    (report) => report.detection_status === "not_found" || reportEvidenceCount(report) <= 0,
  );
  const path =
    input.event.platform_sequence.length > 0
      ? input.event.platform_sequence.map((platform) => PLATFORM_LABELS[platform]).join(" -> ")
      : "暂未形成明确传播路径";
  const nodes = cleanList(input.event.core_propagation_nodes);
  const evidenceLines = foundReports.flatMap((report) => {
    const evidence = cleanList(report.evidence);
    const header = `${PLATFORM_LABELS[report.platform]}：也发现了（${reportEvidenceCount(report)} 条可核验证据）`;
    if (evidence.length === 0) return [header, "证据：爬虫未返回公开 URL、频道、帖子 ID 或内容摘要。"];
    return [
      header,
      ...evidence.slice(0, 6).map((item, index) => `证据 ${index + 1}：${item}`),
    ];
  });
  const notFoundLine =
    notFoundReports.length > 0
      ? notFoundReports.map((report) => PLATFORM_LABELS[report.platform]).join("、")
      : "无";
  const actions = cleanList(input.event.recommended_actions ?? []);

  return [
    "【社交融合监控】",
    `事件：${sanitizePublicLine(input.event.event_title)}`,
    `影响等级：${impactLabel(input.event.impact_level)}（${input.event.impact_level}）`,
    `趋势：${trendLabel(input.event.trend)}`,
    `同一事件置信度：${Math.round(input.event.same_event_confidence * 100)}%`,
    `传播路径：${path}`,
    `核心传播节点：${nodes.length > 0 ? nodes.join("、") : "暂无"}`,
    `未发现平台：${notFoundLine}`,
    input.decisionReason ? `推送判断：${sanitizePublicLine(input.decisionReason)}` : "",
    "",
    "平台证据：",
    evidenceLines.length > 0 ? evidenceLines.join("\n") : "暂无可核验跨平台证据。",
    "",
    "建议动作：",
    actions.length > 0 ? actions.map((item) => `- ${item}`).join("\n") : "- 持续监控，等待更多平台证据。",
    "",
    "说明：以上内容只使用已入库的公开证据；未发现平台不会计入传播路径或平台数量。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
