import { test, expect, describe } from "bun:test";
import { pruneToolResultsOpenAI } from "./context-pruning-openai";
import type { OpenAIMessage } from "./types";
import type { PruningConfig } from "./context-pruning-openai";

const config: PruningConfig = {
  keepRecentTurns: 2,
  softTrimRatio: 0.3,
  hardClearRatio: 0.5,
  softTrim: {
    maxChars: 100,
    headChars: 40,
  },
};

function makeToolMessage(content: string, id = "call_1"): OpenAIMessage {
  return { role: "tool", tool_call_id: id, content };
}

function makeAssistant(content: string): OpenAIMessage {
  return { role: "assistant", content };
}

describe("pruneToolResultsOpenAI", () => {
  test("no pruning when below soft threshold", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      makeAssistant("ok"),
      makeToolMessage("short result"),
    ];
    // Very small context relative to 200K token window
    const result = pruneToolResultsOpenAI(messages, 200_000, config);
    expect(result).toEqual([...messages]);
  });

  test("soft-trims old tool messages when above soft threshold", () => {
    // Create enough content to exceed 30% of a small context window
    const bigContent = "x".repeat(5000);
    const messages: OpenAIMessage[] = [
      { role: "system", content: "sys" },
      makeToolMessage(bigContent, "call_old1"),
      makeToolMessage(bigContent, "call_old2"),
      makeToolMessage("recent1", "call_recent1"),
      makeToolMessage("recent2", "call_recent2"),
    ];
    // ~10000 chars total content / (6250 * 4 = 25000 chars window) = 40%
    // 40% is above softTrimRatio (0.3) but below hardClearRatio (0.5)
    const result = pruneToolResultsOpenAI(messages, 6250, config);

    // Old tool messages should be soft-trimmed (head only)
    expect(result[1]!.content).toContain("[...");
    expect(result[1]!.content!.length).toBeLessThan(bigContent.length);

    // Recent 2 tool messages protected
    expect(result[3]!.content).toBe("recent1");
    expect(result[4]!.content).toBe("recent2");
  });

  test("hard-clears old tool messages when above hard threshold", () => {
    const bigContent = "x".repeat(10000);
    const messages: OpenAIMessage[] = [
      { role: "system", content: "sys" },
      makeToolMessage(bigContent, "call_old1"),
      makeToolMessage("recent1", "call_recent1"),
      makeToolMessage("recent2", "call_recent2"),
    ];
    // 10000 chars / (500*4 = 2000) = 500% > 50% hard threshold
    const result = pruneToolResultsOpenAI(messages, 500, config);

    expect(result[1]!.content).toContain("Tool result cleared");
    expect(result[1]!.content).toContain("10000 chars");

    // Recent protected
    expect(result[2]!.content).toBe("recent1");
    expect(result[3]!.content).toBe("recent2");
  });

  test("protects recent N tool messages from pruning", () => {
    const bigContent = "x".repeat(5000);
    const messages: OpenAIMessage[] = [
      makeToolMessage(bigContent, "call_1"),
      makeToolMessage(bigContent, "call_2"),
      makeToolMessage(bigContent, "call_3"),
    ];
    const result = pruneToolResultsOpenAI(messages, 500, config);

    // With keepRecentTurns=2, only first message is prunable
    expect(result[0]!.content).toContain("Tool result cleared");
    // Last 2 are protected
    expect(result[1]!.content).toBe(bigContent);
    expect(result[2]!.content).toBe(bigContent);
  });

  test("handles empty messages", () => {
    const result = pruneToolResultsOpenAI([], 200_000, config);
    expect(result).toEqual([]);
  });

  test("handles messages with no tool results", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "x".repeat(5000) },
      { role: "user", content: "hi" },
      makeAssistant("ok"),
    ];
    const result = pruneToolResultsOpenAI(messages, 500, config);
    // No tool messages to prune — returns copy
    expect(result).toEqual([...messages]);
  });

  test("does not mutate original messages", () => {
    const bigContent = "x".repeat(5000);
    const messages: OpenAIMessage[] = [
      makeToolMessage(bigContent, "call_old"),
      makeToolMessage("recent1", "call_r1"),
      makeToolMessage("recent2", "call_r2"),
    ];
    const original = JSON.stringify(messages);
    pruneToolResultsOpenAI(messages, 500, config);
    expect(JSON.stringify(messages)).toBe(original);
  });
});
