import { describe, expect, test } from "bun:test";
import {
  missingKanChannelIds,
  successfulKanChannelIdsFromPayload,
} from "./kan-delivery";

describe("social Kan per-channel delivery", () => {
  test("keeps successful channels from a partially failed dispatch", () => {
    const successful = successfulKanChannelIdsFromPayload({
      delivery: {
        result: {
          deliveries: [
            { channelId: "a1", error: "network error" },
            { channelId: "a2", error: null, postId: "post-2" },
          ],
        },
      },
    });

    expect(successful).toEqual(["a2"]);
    expect(missingKanChannelIds(["a1", "a2", "svip"], successful)).toEqual([
      "a1",
      "svip",
    ]);
  });

  test("does not retry channels already recorded as successful", () => {
    const successful = successfulKanChannelIdsFromPayload({
      delivery: { successfulChannelIds: ["a1", "a2"] },
    });

    expect(missingKanChannelIds(["a1", "a2"], successful)).toEqual([]);
  });
});
