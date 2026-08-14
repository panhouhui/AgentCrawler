import { describe, expect, test } from "bun:test";
import { runSocialPipeline } from "./pipeline";
import {
  renderFusedEvent,
  renderPlatformReport,
  renderSocialFusionKanMessage,
} from "./renderers";
import { parsePlatformReport } from "./schemas";
import { deterministicFusion, sanitizeFusedSocialEvent } from "./fusion";
import {
  buildKeywordChinaGate,
  parseAndNormalizeChinaGate,
  shouldAnalyzePlatform,
} from "./china-relevance";
import type { SocialAgentRunner } from "./types";

const gatePass = JSON.stringify({
  china_relevance: "direct",
  is_china_related: true,
  score: 0.91,
  matched_dimensions: ["hong_kong"],
  evidence: ["mentions Hong Kong"],
  threat_to_china_security: true,
  negative_to_china: true,
  china_impact: "threatening",
  risk_score: 0.83,
  risk_categories: ["social_stability"],
  risk_evidence: ["mentions coordinated unrest risk"],
  deep_crawl_allowed: true,
  recommended_action: "deep_crawl",
  reason: "Hong Kong civic context with explicit security risk",
});

const gateSkip = JSON.stringify({
  china_relevance: "none",
  is_china_related: false,
  score: 0.1,
  matched_dimensions: [],
  evidence: [],
  threat_to_china_security: false,
  negative_to_china: false,
  china_impact: "uncertain",
  risk_score: 0,
  risk_categories: ["none"],
  risk_evidence: [],
  deep_crawl_allowed: false,
  recommended_action: "skip",
  reason: "not China related",
});

const gateNeutralChina = JSON.stringify({
  china_relevance: "direct",
  is_china_related: true,
  score: 0.9,
  matched_dimensions: ["hong_kong"],
  evidence: ["mentions Hong Kong"],
  threat_to_china_security: false,
  negative_to_china: false,
  china_impact: "neutral",
  risk_score: 0.1,
  risk_categories: ["none"],
  risk_evidence: [],
  deep_crawl_allowed: false,
  recommended_action: "deep_crawl",
  reason: "China related but neutral",
});

function makeRunner(): SocialAgentRunner {
  return {
    async run(input) {
      if (input.routeKey === "social.gate") {
        return input.task.includes("unrelated sports") ? gateSkip : gatePass;
      }
      if (input.agentId === "x-social-agent") {
        return JSON.stringify({
          schema: "x_alert_v1",
          platform: "x",
          event_key: "hong-kong-test-event",
          event_title: "Hong Kong test event",
          observed_at: 100,
          china_relevance: JSON.parse(gatePass),
          summary: "Fast X spread",
          evidence: ["hashtag volume jumped"],
          regions: ["Hong Kong"],
          core_nodes: ["#hk"],
          hashtag: "#hk",
          discussion_growth_percent: 780,
          participant_accounts: 2350,
          main_source: "Hong Kong",
          status: "rapid_spread",
        });
      }
      if (input.agentId === "telegram-social-agent") {
        return JSON.stringify({
          schema: "telegram_alert_v1",
          platform: "telegram",
          event_key: "hong-kong-test-event",
          event_title: "Hong Kong test event",
          observed_at: 100,
          china_relevance: JSON.parse(gatePass),
          summary: "Telegram channel spread",
          evidence: ["same text appeared in three channels"],
          regions: ["Hong Kong"],
          core_nodes: ["Channel A", "Channel B"],
          channel_path: ["Channel A", "Channel B", "Channel C"],
          shared_content_percent: 82,
          bridge_channels: ["Channel B"],
        });
      }
      return JSON.stringify({
        schema: "social_fusion_v1",
        event_key: "hong-kong-test-event",
        event_title: "Hong Kong test event",
        same_event_confidence: 0.88,
        impact_level: "High",
        trend: "rising",
        platform_sequence: ["telegram", "x"],
        platform_counts: { x: 3000, telegram: 12 },
        core_propagation_nodes: ["Channel B", "#hk"],
        relationship_summary: "Telegram seeded the text, then X amplified it.",
        recommended_actions: ["monitor bridge nodes"],
        evidence: ["shared text overlap"],
      });
    },
  };
}

describe("social pipeline", () => {
  test("requires China relevance and negative/security risk before deep crawl", () => {
    const neutralGate = parseAndNormalizeChinaGate(gateNeutralChina);
    expect(neutralGate.is_china_related).toBe(true);
    expect(neutralGate.deep_crawl_allowed).toBe(false);
    expect(neutralGate.recommended_action).toBe("skip");
    expect(shouldAnalyzePlatform(neutralGate)).toBe(false);

    const riskyGate = buildKeywordChinaGate({
      title: "香港数据泄露事件",
      summary: "公开帖子声称香港相关系统出现数据泄露。",
      evidence: ["香港 数据泄露 网络攻击"],
    });
    expect(riskyGate.is_china_related).toBe(true);
    expect(riskyGate.negative_to_china).toBe(true);
    expect(riskyGate.deep_crawl_allowed).toBe(true);
    expect(shouldAnalyzePlatform(riskyGate)).toBe(true);
  });

  test("blocks non-political China-related topics from deep crawl", () => {
    const economicGate = buildKeywordChinaGate({
      title: "中国汽车销量上涨",
      summary: "市场讨论中国汽车销量变化。",
      evidence: ["中国 汽车 销量 市场"],
    });
    expect(economicGate.is_china_related).toBe(true);
    expect(economicGate.deep_crawl_allowed).toBe(false);
    expect(shouldAnalyzePlatform(economicGate)).toBe(false);
  });

  test("gates non-China signals and fuses accepted platform reports", async () => {
    const result = await runSocialPipeline({
      runner: makeRunner(),
      signals: [
        {
          id: "x-1",
          platform: "x",
          title: "Hong Kong test event",
          summary: "X spread",
          observedAt: 100,
          evidence: ["mentions Hong Kong"],
        },
        {
          id: "tg-1",
          platform: "telegram",
          title: "Hong Kong test event",
          summary: "Telegram spread",
          observedAt: 100,
          evidence: ["mentions Hong Kong"],
        },
        {
          id: "x-2",
          platform: "x",
          title: "unrelated sports",
          summary: "sports update",
          observedAt: 100,
          evidence: ["no China context"],
        },
      ],
    });

    expect(result.platformReports).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.fusedEvent?.impact_level).toBe("High");
    expect(result.fusedEvent?.platform_sequence).toEqual(["telegram", "x"]);
    expect(result.renderedPlatformReports[0]).toContain("X Agent");
    expect(result.renderedFusedEvent).toContain("Social Fusion Agent");
  });

  test("renders requested platform-specific formats", () => {
    const xRendered = renderPlatformReport({
      schema: "x_alert_v1",
      platform: "x",
      event_key: "e",
      event_title: "Event",
      observed_at: 1,
      china_relevance: JSON.parse(gatePass),
      summary: "",
      evidence: [],
      regions: [],
      core_nodes: [],
      hashtag: "#xxxx",
      discussion_growth_percent: 780,
      participant_accounts: 2350,
      main_source: "香港地区",
      status: "rapid_spread",
    });
    expect(xRendered).toContain("讨论量 +780%");
    expect(xRendered).toContain("快速扩散");

    const fusedRendered = renderFusedEvent({
      schema: "social_fusion_v1",
      event_key: "e",
      event_title: "xxxx事件",
      same_event_confidence: 0.9,
      impact_level: "High",
      trend: "rising",
      platform_sequence: ["telegram", "x", "lihkg", "facebook"],
      platform_counts: {},
      core_propagation_nodes: ["n1", "n2"],
      relationship_summary: "same public nodes",
      recommended_actions: [],
      evidence: [],
    });
    expect(fusedRendered).toContain("影响等级：\nHigh");
    expect(fusedRendered).toContain("telegram");
  });

  test("uses gate result when platform report reinterprets china relevance", () => {
    const report = parsePlatformReport(
      JSON.stringify({
        schema: "x_alert_v1",
        platform: "x",
        event_key: "e",
        event_title: "Event",
        observed_at: 1,
        china_relevance: {
          china_relevance: "Hong Kong related",
          score: 0.91,
          matched_dimensions: ["hong_kong"],
          evidence: ["mentions Hong Kong"],
          recommended_action: "crawl it",
          reason: "bad enum labels from model",
        },
        summary: "",
        evidence: [],
        regions: [],
        core_nodes: [],
        hashtag: "#e",
        discussion_growth_percent: 100,
        participant_accounts: 10,
        main_source: "Hong Kong",
        status: "rapid_spread",
      }),
      JSON.parse(gatePass),
    );

    expect(report.china_relevance.recommended_action).toBe("deep_crawl");
  });

  test("keeps not_found platform reports out of propagation counts", () => {
    const gate = JSON.parse(gatePass);
    const xReport = parsePlatformReport(
      JSON.stringify({
        schema: "x_alert_v1",
        platform: "x",
        event_key: "e",
        event_title: "Event",
        observed_at: 1,
        china_relevance: gate,
        summary: "",
        evidence: ["X found it"],
        regions: [],
        core_nodes: ["#e"],
        hashtag: "#e",
        discussion_growth_percent: 100,
        participant_accounts: 10,
        main_source: "Hong Kong",
        status: "rapid_spread",
      }),
      gate,
    );
    const telegramReport = parsePlatformReport(
      JSON.stringify({
        schema: "telegram_alert_v1",
        platform: "telegram",
        event_key: "e",
        event_title: "Event",
        detection_status: "not_found",
        observed_at: 1,
        china_relevance: gate,
        summary: "No matching message found",
        evidence: [],
        regions: [],
        core_nodes: [],
        channel_path: [],
        shared_content_percent: 0,
        bridge_channels: [],
      }),
      gate,
    );

    const fusion = deterministicFusion([xReport, telegramReport]);

    expect(renderPlatformReport(telegramReport)).toContain("未发现");
    expect(fusion.platform_sequence).toEqual(["x"]);
    expect(fusion.platform_counts.telegram).toBe(0);
  });

  test("sanitizes model fusion counts with verified platform reports", () => {
    const gate = JSON.parse(gatePass);
    const telegramReport = parsePlatformReport(
      JSON.stringify({
        schema: "telegram_alert_v1",
        platform: "telegram",
        event_key: "e",
        event_title: "Event",
        detection_status: "found",
        observed_at: 1,
        china_relevance: gate,
        summary: "Telegram found it",
        evidence: ["https://t.me/example/1", "https://t.me/example/2"],
        regions: [],
        core_nodes: ["example"],
        channel_path: ["example"],
        shared_content_percent: 80,
        bridge_channels: [],
      }),
      gate,
    );
    const facebookReport = parsePlatformReport(
      JSON.stringify({
        schema: "facebook_alert_v1",
        platform: "facebook",
        event_key: "e",
        event_title: "Event",
        detection_status: "not_found",
        observed_at: 1,
        china_relevance: gate,
        summary: "No matching posts",
        evidence: [],
        regions: [],
        core_nodes: [],
        pages: [],
        interaction_growth_percent: 0,
        propagation_users: 0,
        influence_regions: [],
      }),
      gate,
    );

    const sanitized = sanitizeFusedSocialEvent(
      {
        schema: "social_fusion_v1",
        event_key: "e",
        event_title: "Event",
        same_event_confidence: 0.95,
        impact_level: "High",
        trend: "rising",
        platform_sequence: ["facebook", "telegram"],
        platform_counts: { facebook: 8, telegram: 12 },
        core_propagation_nodes: ["facebook-page", "example"],
        relationship_summary: "Model invented Facebook spread.",
        recommended_actions: [],
        evidence: [],
      },
      [telegramReport, facebookReport],
    );

    expect(sanitized.same_event_confidence).toBe(0.45);
    expect(sanitized.platform_sequence).toEqual(["telegram"]);
    expect(sanitized.platform_counts.facebook).toBe(0);
    expect(sanitized.platform_counts.telegram).toBe(2);
    expect(sanitized.core_propagation_nodes).toEqual(["example"]);
  });

  test("renders Kan preview from verified evidence without inventing not-found platforms", () => {
    const gate = JSON.parse(gatePass);
    const telegramReport = parsePlatformReport(
      JSON.stringify({
        schema: "telegram_alert_v1",
        platform: "telegram",
        event_key: "e",
        event_title: "Event",
        detection_status: "found",
        observed_at: 1,
        china_relevance: gate,
        summary: "Telegram found it",
        evidence: [
          "证据1；内容：同一内容在频道出现；链接：https://t.me/example/1；频道/节点：example；消息/帖子ID：1",
        ],
        regions: [],
        core_nodes: ["example"],
        channel_path: ["example"],
        shared_content_percent: 80,
        bridge_channels: [],
      }),
      gate,
    );
    const facebookReport = parsePlatformReport(
      JSON.stringify({
        schema: "facebook_alert_v1",
        platform: "facebook",
        event_key: "e",
        event_title: "Event",
        detection_status: "not_found",
        observed_at: 1,
        china_relevance: gate,
        summary: "No matching posts",
        evidence: [],
        regions: [],
        core_nodes: [],
        pages: [],
        interaction_growth_percent: 0,
        propagation_users: 0,
        influence_regions: [],
      }),
      gate,
    );
    const fused = sanitizeFusedSocialEvent(
      {
        schema: "social_fusion_v1",
        event_key: "e",
        event_title: "Event",
        same_event_confidence: 0.95,
        impact_level: "High",
        trend: "rising",
        platform_sequence: ["telegram", "facebook"],
        platform_counts: { telegram: 1, facebook: 8 },
        core_propagation_nodes: ["example", "fake-facebook-page"],
        relationship_summary: "Model invented Facebook spread.",
        recommended_actions: ["继续监控 Telegram 公开频道"],
        evidence: [],
      },
      [telegramReport, facebookReport],
    );

    const message = renderSocialFusionKanMessage({
      event: fused,
      platformReports: [telegramReport, facebookReport],
      decisionReason: "未达到 Kan 推送阈值，进入持续监控；本次不会执行真实推送。",
    });

    expect(message).toContain("https://t.me/example/1");
    expect(message).toContain("Telegram：也发现了（1 条可核验证据）");
    expect(message).toContain("未发现平台：Facebook");
    expect(message).not.toContain("fake-facebook-page");
  });
});
