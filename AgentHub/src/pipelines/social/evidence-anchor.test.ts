import { describe, expect, test } from "bun:test";
import { mergeEvidenceAnchorItems } from "./evidence-anchor";

describe("social source evidence anchor", () => {
  test("retains the discovered source post when a follow-up search is empty", () => {
    const source = [{
      title: "华为录像曝光",
      content: "华为录像曝光的原始帖子",
      url: "https://t.me/channel_a/101",
      messageId: "101",
    }];

    expect(mergeEvidenceAnchorItems([], source)).toEqual(source);
  });

  test("deduplicates the same source post returned by the follow-up search", () => {
    const item = {
      title: "同一事件",
      content: "同一正文",
      url: "https://x.com/account/status/123456789",
    };

    expect(mergeEvidenceAnchorItems([item], [item])).toEqual([item]);
  });
});
