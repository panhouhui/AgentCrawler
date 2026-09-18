import { describe, expect, test } from "bun:test";
import { buildGlobalRadarEvent } from "./radar";
import { renderGlobalRadarKanMessage } from "./renderers";
import type { FusedSocialEvent, PlatformReport } from "./schemas";

const chinaGate = {
  china_relevance: "direct" as const,
  is_china_related: true,
  score: 0.9,
  matched_dimensions: ["security"],
  evidence: ["public evidence"],
  threat_to_china_security: true,
  negative_to_china: true,
  china_impact: "threatening" as const,
  risk_score: 0.8,
  risk_categories: ["national_security" as const],
  risk_evidence: ["risk evidence"],
  deep_crawl_allowed: true,
  recommended_action: "deep_crawl" as const,
  reason: "test",
};

const reports: readonly PlatformReport[] = [
  {
    schema: "x_alert_v1",
    platform: "x",
    event_key: "radar-test",
    event_title: "测试事件",
    detection_status: "found",
    observed_at: 1_700_000_000,
    china_relevance: chinaGate,
    summary: "测试事件的公开证据摘要",
    evidence: ["https://x.example.test/post/1"],
    regions: [],
    core_nodes: ["@source"],
    hashtag: "#test",
    discussion_growth_percent: 120,
    participant_accounts: 12,
    main_source: "@source",
    status: "rapid_spread",
  },
  {
    schema: "telegram_alert_v1",
    platform: "telegram",
    event_key: "radar-test",
    event_title: "测试事件",
    detection_status: "found",
    observed_at: 1_700_000_000,
    china_relevance: chinaGate,
    summary: "Telegram 复核到同一事件",
    evidence: ["https://t.me/example/1"],
    regions: [],
    core_nodes: ["example-channel"],
    channel_path: ["example-channel"],
    shared_content_percent: 70,
    bridge_channels: [],
  },
];

const fused: FusedSocialEvent = {
  schema: "social_fusion_v1",
  event_key: "radar-test",
  event_title: "测试事件",
  same_event_confidence: 0.82,
  impact_level: "High",
  trend: "rising",
  platform_sequence: ["x", "telegram"],
  platform_counts: { x: 1, telegram: 1 },
  core_propagation_nodes: ["@source", "example-channel"],
  relationship_summary: "两个平台存在同一事件的公开证据。",
  recommended_actions: ["继续跨平台监控"],
  evidence: [],
};

describe("global radar", () => {
  test("uses evidence-backed coverage and avoids a fabricated first-cycle delta", () => {
    const radar = buildGlobalRadarEvent({
      event: fused,
      platformReports: reports,
      eventId: "EVT-20260912-TEST0001",
      firstSeenAt: 1_700_000_000,
      updatedAt: 1_700_000_300,
      monitoredPlatformCount: 10,
    });

    expect(radar.tier).toBe("key");
    expect(radar.foundPlatforms).toEqual(["x", "telegram"]);
    expect(radar.firstPlatform).toBe("x");
    expect(radar.dominantPlatform).toBe("x");
    expect(radar.platformStats[0]?.deltaSincePrevious).toBeNull();
    expect(radar.sourceLinks).toEqual([
      { platform: "x", url: "https://x.example.test/post/1" },
      { platform: "telegram", url: "https://t.me/example/1" },
    ]);
    expect(radar.propagation.discussionGrowth).toContain("暂无足够连续样本");
    expect(radar.aiAssessment.attentionIndex).toBeGreaterThan(0);
    expect(radar.aiAssessment.attentionIndex).toBeLessThanOrEqual(100);
  });

  test("labels a rising event as rapid only after a real prior sample", () => {
    const reportsWithEarlierTelegram = reports.map((report) =>
      report.platform === "telegram"
        ? { ...report, observed_at: 1_700_000_100 }
        : { ...report, observed_at: 1_700_000_200 },
    ) as readonly PlatformReport[];
    const radar = buildGlobalRadarEvent({
      event: {
        ...fused,
        platform_counts: { x: 3, telegram: 2 },
      },
      platformReports: reportsWithEarlierTelegram,
      eventId: "EVT-20260912-TEST0001",
      firstSeenAt: 1_700_000_000,
      updatedAt: 1_700_000_600,
      monitoredPlatformCount: 10,
      history: [{
        capturedAt: 1_700_000_300,
        verifiedCount: 2,
        platformCounts: { x: 1, telegram: 1 },
        foundPlatforms: ["x", "telegram"],
        attentionIndex: 60,
        status: "spreading",
        trend: "rising",
        impactLevel: "High",
      }],
    });

    expect(radar.status).toBe("rapid");
    expect(radar.firstPlatform).toBe("telegram");
    expect(radar.platformStats[0]?.deltaSincePrevious).toBe(2);
    expect(radar.propagation.discussionGrowth).toContain("+3");
    expect(radar.aiAssessment.persistence).toContain("2 个连续观测样本");
  });

  test("renders every required radar section for Kan", () => {
    const radar = buildGlobalRadarEvent({
      event: fused,
      platformReports: reports,
      eventId: "EVT-20260912-TEST0001",
      firstSeenAt: 1_700_000_000,
      updatedAt: 1_700_000_300,
      monitoredPlatformCount: 10,
    });
    const message = renderGlobalRadarKanMessage({
      radar,
      decisionReason: "推送判断：测试判断",
    });

    for (const heading of [
      "【全域雷达｜",
      "事件 ID：",
      "跨平台态势：",
      "事件摘要与争议点：",
      "关键传播节点：",
      "相关链接：",
      "传播研判：",
      "AI 评估：",
      "雷达预警与建议：",
      "数据说明：",
    ]) {
      expect(message).toContain(heading);
    }
    expect(message).toContain("X：https://x.example.test/post/1");
    expect(message).toContain("Telegram：https://t.me/example/1");
    expect(message).toContain("推送判断：测试判断");
    expect(message).not.toContain("推送判断：推送判断：");
  });
});
