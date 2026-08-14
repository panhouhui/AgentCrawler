import type { FusedSocialEvent, PlatformReport } from "./schemas";
import { stableEventKey } from "./json";

type Platform = PlatformReport["platform"];

function platformWeight(report: PlatformReport): number {
  if (report.detection_status === "not_found") return 0;
  switch (report.platform) {
    case "x":
      return report.discussion_growth_percent / 100 + report.participant_accounts / 1000;
    case "telegram":
      return report.channel_path.length + report.shared_content_percent / 50;
    case "lihkg":
      return report.participant_count / 5000;
    case "facebook":
      return report.interaction_growth_percent / 100 + report.propagation_users / 5000;
    case "github":
    case "instagram":
    case "lien":
    case "netlight":
    case "ptt":
    case "youtube":
      return (
        report.item_count / 10 +
        report.growth_percent / 100 +
        report.content_overlap_percent / 50 +
        report.core_nodes.length / 2
      );
  }
}

function impactFromReports(reports: readonly PlatformReport[]): FusedSocialEvent["impact_level"] {
  const score = reports.reduce((sum, report) => sum + platformWeight(report), 0);
  if (score >= 16 || reports.length >= 4) return "Critical";
  if (score >= 8 || reports.length >= 3) return "High";
  if (score >= 3 || reports.length >= 2) return "Medium";
  return "Low";
}

function trendFromReports(reports: readonly PlatformReport[]): FusedSocialEvent["trend"] {
  const rising = reports.some((report) => {
    if (report.detection_status === "not_found") return false;
    if (report.platform === "x") return report.status === "rapid_spread";
    if (report.platform === "facebook") return report.interaction_growth_percent >= 100;
    if (report.platform === "telegram") return report.shared_content_percent >= 60;
    if (report.platform === "lihkg") return report.participant_count >= 1000;
    return report.growth_percent >= 100 || report.status === "found";
  });
  return rising ? "rising" : "uncertain";
}

function verifiedReportCount(report: PlatformReport): number {
  if (report.detection_status === "not_found") return 0;
  const evidenceCount = report.evidence.filter((item) => item.trim()).length;
  if (evidenceCount > 0) return evidenceCount;

  switch (report.platform) {
    case "telegram":
      return Math.max(1, report.channel_path.length);
    case "facebook":
      return Math.max(1, report.pages.length);
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
      return Math.max(1, report.item_count);
  }
}

function confidenceCeiling(foundPlatformCount: number): number {
  if (foundPlatformCount <= 0) return 0.1;
  if (foundPlatformCount === 1) return 0.45;
  return 1;
}

export function sanitizeFusedSocialEvent(
  fused: FusedSocialEvent,
  reports: readonly PlatformReport[],
): FusedSocialEvent {
  const foundPlatforms = new Set<Platform>();
  const platformCounts: Record<string, number> = {};
  const coreNodes = new Set<string>();

  for (const report of reports) {
    const count = verifiedReportCount(report);
    platformCounts[report.platform] = count;
    if (count <= 0) continue;
    foundPlatforms.add(report.platform);
    for (const node of report.core_nodes) {
      if (node.trim()) coreNodes.add(node);
    }
  }

  const platformSequence = [
    ...fused.platform_sequence.filter((platform) => foundPlatforms.has(platform)),
    ...[...foundPlatforms].filter((platform) => !fused.platform_sequence.includes(platform)),
  ];
  const ceiling = confidenceCeiling(foundPlatforms.size);

  return {
    ...fused,
    same_event_confidence: Math.min(fused.same_event_confidence, ceiling),
    platform_sequence: platformSequence,
    platform_counts: platformCounts,
    core_propagation_nodes:
      coreNodes.size > 0
        ? [...coreNodes]
        : fused.core_propagation_nodes.filter((node) => node.trim()),
  };
}

export function deterministicFusion(
  reports: readonly PlatformReport[],
): FusedSocialEvent {
  const foundReports = reports.filter((report) => report.detection_status !== "not_found");
  const first = foundReports[0] ?? reports[0];
  const eventTitle = first?.event_title ?? "Unknown social event";
  const eventKey = first?.event_key ?? stableEventKey(eventTitle);
  const platformSequence = foundReports.map((report) => report.platform);
  const platformCounts: Record<string, number> = {};
  const coreNodes = new Set<string>();
  const evidence: string[] = [];

  for (const report of reports) {
    if (report.detection_status === "not_found") {
      platformCounts[report.platform] = 0;
      evidence.push(`[${report.platform}] 未发现该事件`);
      continue;
    }
    platformCounts[report.platform] = (platformCounts[report.platform] ?? 0) + 1;
    for (const node of report.core_nodes) coreNodes.add(node);
    for (const item of report.evidence.slice(0, 3)) evidence.push(`[${report.platform}] ${item}`);
  }

  return sanitizeFusedSocialEvent({
    schema: "social_fusion_v1",
    event_key: eventKey,
    event_title: eventTitle,
    same_event_confidence: foundReports.length > 1 ? 0.7 : foundReports.length === 1 ? 0.45 : 0.1,
    impact_level: impactFromReports(foundReports),
    trend: trendFromReports(foundReports),
    platform_sequence: [...new Set(platformSequence)],
    platform_counts: platformCounts,
    core_propagation_nodes: [...coreNodes],
    relationship_summary:
      foundReports.length > 1
        ? "多个平台报告共享同一事件键，需要继续复核公开传播节点中的重复文本、URL、媒体哈希、频道/页面转载和公开账号互动。"
        : foundReports.length === 1
          ? "目前只有一个平台发现该事件，先继续监控，不推断跨平台传播路径。"
          : "尚无平台确认该事件，只保留浅层观察状态。",
    recommended_actions:
      foundReports.length > 1
        ? ["继续跨平台监控", "跟踪公开桥接节点"]
        : foundReports.length === 1
          ? ["请求其他平台智能体复核"]
          : ["平台确认前不要进入深度爬取"],
    evidence,
  }, reports);
}
