import { describe, expect, test } from "bun:test";
import {
  compareSocialFusionDedupeFingerprints,
  deriveSocialFusionDedupeFingerprintFromPayload,
  type SocialFusionDedupeFingerprint,
} from "./dedupe";

function fingerprint(
  overrides: Partial<SocialFusionDedupeFingerprint>,
): SocialFusionDedupeFingerprint {
  return {
    fingerprintVersion: 2,
    eventKey: overrides.eventKey ?? "event-a",
    eventTitle: overrides.eventTitle ?? "事件 A",
    urls: overrides.urls ?? [],
    nodes: overrides.nodes ?? [],
    titleTokens: overrides.titleTokens ?? [],
    platforms: overrides.platforms ?? [],
  };
}

describe("social fusion dedupe", () => {
  test("ignores LIHKG static faces and YouTube search/channel URLs", () => {
    const derived = deriveSocialFusionDedupeFingerprintFromPayload({
      event: { event_title: "习近平健康传言" },
      platformEvidence: [{
        platform: "youtube",
        status: "found",
        evidence: { items: [
          { url: "https://lihkg.com/assets/faces/pig/wail.gif" },
          { url: "https://youtube.com/results?search_query=xi+rumor" },
          { url: "https://youtube.com/@ntdchinese" },
        ] },
      }],
    });

    expect(derived.urls).toEqual([]);
  });

  test("unwraps LIHKG redirect URLs to the underlying X status", () => {
    const derived = deriveSocialFusionDedupeFingerprintFromPayload({
      event: { event_title: "习近平健康传言" },
      platformEvidence: [{
        platform: "lihkg",
        status: "found",
        evidence: { items: [{
          title: "习近平健康传言持续传播",
          url: "https://r.lihkg.com/link?u=https%3A%2F%2Fx.com%2Fabc%2Fstatus%2F123456789%3Fs%3D46&h=abc",
        }] },
      }],
    });

    expect(derived.urls).toEqual(["https://x.com/abc/status/123456789"]);
  });

  test("normalizes LIHKG page URLs to one thread anchor", () => {
    const derived = deriveSocialFusionDedupeFingerprintFromPayload({
      event: { event_title: "香港支联会案件判决事件" },
      platformEvidence: [{
        platform: "lihkg",
        status: "found",
        evidence: { items: [{
          title: "香港支联会案件判决事件持续讨论",
          url: "https://lihkg.com/thread/4157622/page/2?ref=search",
        }] },
      }],
    });

    expect(derived.urls).toEqual(["https://lihkg.com/thread/4157622"]);
  });

  test("treats the same X status as a duplicate", () => {
    const comparison = compareSocialFusionDedupeFingerprints(
      fingerprint({ urls: ["https://x.com/abc/status/123456789"] }),
      fingerprint({ urls: ["https://x.com/abc/status/123456789"] }),
    );

    expect(comparison.isDuplicate).toBe(true);
    expect(comparison.score).toBeGreaterThanOrEqual(0.95);
  });

  test("does not mark generic title boilerplate as a duplicate", () => {
    const current = deriveSocialFusionDedupeFingerprintFromPayload({
      event: { event_title: "上海访民维权事件" },
      platformReports: [
        {
          platform: "x",
          detection_status: "found",
          summary: "facebook github instagram telegram youtube https www com 不要求真 也发现了",
        },
      ],
    });
    const previous = deriveSocialFusionDedupeFingerprintFromPayload({
      event: { event_title: "习近平健康传言" },
      platformReports: [
        {
          platform: "youtube",
          detection_status: "found",
          summary: "facebook github instagram telegram youtube https www com 不要求真 也发现了",
        },
      ],
    });
    const comparison = compareSocialFusionDedupeFingerprints(
      current,
      previous,
    );

    expect(comparison.isDuplicate).toBe(false);
  });

  test("does not read unrelated raw samples from a crawler batch", () => {
    const derived = deriveSocialFusionDedupeFingerprintFromPayload({
      event: { event_key: "huawei-video", event_title: "华为录像事件" },
      platformEvidence: [{
        platform: "telegram",
        status: "found",
        evidence: {
          items: [{
            title: "华为录像事件",
            url: "https://t.me/channel_a/101",
            channelName: "channel_a",
          }],
          samples: [{
            title: "习近平健康传言",
            url: "https://t.me/channel_a/102",
          }],
        },
      }],
    });

    expect(derived.urls).toEqual(["https://t.me/channel_a/101"]);
  });

  test("rejects a different message from the same historical channel batch", () => {
    const derived = deriveSocialFusionDedupeFingerprintFromPayload({
      event: {
        event_key: "huawei-video",
        event_title: "华为大审判54秒偷窃录像曝光事件",
      },
      platformEvidence: [{
        platform: "telegram",
        status: "found",
        evidence: {
          items: [
            {
              title: "华为大审判54秒偷窃录像曝光",
              url: "https://t.me/channel_a/101",
              channelName: "channel_a",
            },
            {
              title: "习近平在印度倒下访美取消",
              url: "https://t.me/channel_a/102",
              channelName: "channel_a",
            },
          ],
        },
      }],
    });

    expect(derived.urls).toEqual(["https://t.me/channel_a/101"]);
  });

  test("does not dedupe different events that only share political risk words", () => {
    const comparison = compareSocialFusionDedupeFingerprints(
      fingerprint({
        eventKey: "telegram-hate-speech",
        eventTitle: "Telegram平台极端反华仇恨言论事件",
        titleTokens: ["telegram", "极端反华", "仇恨言论", "反华"],
      }),
      fingerprint({
        eventKey: "x-posts-spread",
        eventTitle: "X平台账号发布反华内容传播事件",
        titleTokens: ["反华", "发布反华", "内容传播", "政治安全"],
      }),
    );

    expect(comparison.isDuplicate).toBe(false);
  });

  test("treats a new reliable source URL as an event update", () => {
    const comparison = compareSocialFusionDedupeFingerprints(
      fingerprint({
        urls: [
          "https://x.com/abc/status/123456789",
          "https://t.me/channel_a/102",
        ],
        platforms: ["x", "telegram"],
      }),
      fingerprint({
        urls: ["https://x.com/abc/status/123456789"],
        platforms: ["x"],
      }),
    );

    expect(comparison.isDuplicate).toBe(false);
    expect(comparison.reasons.join(" ")).toContain("新增");
  });
});
