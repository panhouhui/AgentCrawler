import { describe, expect, it } from "bun:test";
import {
  buildSocialFusionDedupeFingerprint,
  buildSocialFusionDedupeKey,
  compareSocialFusionDedupeFingerprints,
} from "./dedupe";
import type { FusedSocialEvent, PlatformReport } from "./schemas";

const gate: PlatformReport["china_relevance"] = {
  china_relevance: "direct",
  is_china_related: true,
  score: 0.9,
  matched_dimensions: ["person"],
  evidence: ["中国相关"],
  threat_to_china_security: true,
  negative_to_china: true,
  china_impact: "threatening",
  risk_score: 0.82,
  risk_categories: ["disinformation"],
  risk_evidence: ["负面舆论"],
  deep_crawl_allowed: true,
  recommended_action: "deep_crawl",
  reason: "测试",
};

function fused(title: string, key: string, nodes: readonly string[] = []): FusedSocialEvent {
  return {
    schema: "social_fusion_v1",
    event_key: key,
    event_title: title,
    same_event_confidence: 0.88,
    impact_level: "High",
    trend: "rising",
    platform_sequence: ["x", "youtube"],
    platform_counts: { x: 2, youtube: 1 },
    core_propagation_nodes: [...nodes],
    relationship_summary: "测试关系链",
    recommended_actions: ["持续监控"],
    evidence: [],
  };
}

function xReport(title: string, url: string): PlatformReport {
  return {
    schema: "x_alert_v1",
    platform: "x",
    event_key: "x-event",
    event_title: title,
    detection_status: "found",
    observed_at: 1,
    china_relevance: gate,
    summary: title,
    evidence: [`推文 URL：${url}`],
    regions: ["香港"],
    core_nodes: ["@public_node"],
    hashtag: "",
    discussion_growth_percent: 300,
    participant_accounts: 1200,
    main_source: "公开账号",
    status: "rapid_spread",
  };
}

function youtubeReport(title: string, url: string): PlatformReport {
  return {
    schema: "youtube_alert_v1",
    platform: "youtube",
    event_key: "youtube-event",
    event_title: title,
    detection_status: "found",
    observed_at: 1,
    china_relevance: gate,
    summary: title,
    evidence: [`视频 URL：${url}`],
    regions: [],
    core_nodes: ["频道A"],
    item_count: 1,
    growth_percent: 120,
    source_nodes: ["频道A"],
    matched_terms: ["朱镕基"],
    content_overlap_percent: 80,
    status: "found",
  };
}

describe("social fusion dedupe fingerprint", () => {
  it("treats changed titles with shared public URL as a duplicate", () => {
    const first = buildSocialFusionDedupeFingerprint({
      fused: fused("朱镕基去世传言快速传播", "event-a"),
      reports: [
        xReport("朱镕基去世传言", "https://twitter.com/example/status/123?utm_source=x"),
        youtubeReport("朱镕基相关视频", "https://youtu.be/abc123?feature=shared"),
      ],
    });
    const second = buildSocialFusionDedupeFingerprint({
      fused: fused("朱镕基病逝消息在社交平台扩散", "event-b"),
      reports: [
        xReport("朱镕基病逝消息", "https://x.com/example/status/123"),
        youtubeReport("朱镕基相关视频再传播", "https://youtube.com/watch?v=abc123"),
      ],
    });

    const comparison = compareSocialFusionDedupeFingerprints(second, first);

    expect(comparison.isDuplicate).toBe(true);
    expect(comparison.commonUrls.length).toBeGreaterThanOrEqual(1);
  });

  it("treats changed titles with shared nodes and title entities as a duplicate", () => {
    const first = buildSocialFusionDedupeFingerprint({
      fused: fused("朱镕基去世传言快速传播", "event-a", ["公开频道A", "公开账号B"]),
      reports: [xReport("朱镕基去世传言", "")],
    });
    const second = buildSocialFusionDedupeFingerprint({
      fused: fused("朱镕基病逝消息在社交平台扩散", "event-b", ["公开频道A", "公开账号B"]),
      reports: [xReport("朱镕基病逝消息", "")],
    });

    const comparison = compareSocialFusionDedupeFingerprints(second, first);

    expect(comparison.isDuplicate).toBe(true);
    expect(comparison.commonNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("does not treat unrelated events as duplicates", () => {
    const first = buildSocialFusionDedupeFingerprint({
      fused: fused("朱镕基相关传言扩散", "event-a", ["公开频道A"]),
      reports: [xReport("朱镕基相关传言", "https://x.com/example/status/123")],
    });
    const second = buildSocialFusionDedupeFingerprint({
      fused: fused("南海军事演习视频传播", "event-b", ["公开频道Z"]),
      reports: [youtubeReport("南海军事演习视频", "https://youtube.com/watch?v=def456")],
    });

    const comparison = compareSocialFusionDedupeFingerprints(second, first);

    expect(comparison.isDuplicate).toBe(false);
  });

  it("builds a stable URL-based key after URL canonicalization", () => {
    const first = buildSocialFusionDedupeFingerprint({
      fused: fused("事件 A", "event-a"),
      reports: [xReport("事件 A", "https://twitter.com/example/status/123?utm_source=x")],
    });
    const second = buildSocialFusionDedupeFingerprint({
      fused: fused("事件 B", "event-b"),
      reports: [xReport("事件 B", "https://x.com/example/status/123")],
    });

    expect(buildSocialFusionDedupeKey(first, "event-a")).toEqual(
      buildSocialFusionDedupeKey(second, "event-b"),
    );
  });

  it("treats political-security core overlap as duplicate even without shared urls", () => {
    const first = buildSocialFusionDedupeFingerprint({
      fused: fused("中国政治安全相关事件", "event-a", ["中国政治", "国家安全"]),
      reports: [xReport("中国政治安全相关事件", "")],
    });
    const second = buildSocialFusionDedupeFingerprint({
      fused: fused("中国政治安全相关事件更新", "event-b", ["中国政治", "国家安全"]),
      reports: [youtubeReport("中国政治安全相关事件更新", "")],
    });

    const comparison = compareSocialFusionDedupeFingerprints(second, first);

    expect(comparison.isDuplicate).toBe(true);
  });
});
