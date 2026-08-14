import { test, expect, describe } from "bun:test";
import { applyMmr } from "./mmr";
import type { SearchResult } from "./types";

function makeResult(
  content: string,
  score: number,
  id = crypto.randomUUID(),
): SearchResult {
  return {
    chunk: {
      id,
      sourceId: "src-1",
      content,
      chunkIndex: 0,
      tokenCount: Math.ceil(content.length / 4),
      createdAt: Date.now(),
    },
    score,
    source: {
      id: "src-1",
      kind: "note",
      agentId: "test",
      channel: null,
      chatId: null,
      metadata: {},
      createdAt: Date.now(),
    },
  };
}

describe("applyMmr", () => {
  test("returns empty array for empty input", () => {
    expect(applyMmr([], 0.7, 5)).toEqual([]);
  });

  test("returns single item unchanged", () => {
    const results = [makeResult("hello world test", 0.9)];
    const mmr = applyMmr(results, 0.7, 5);
    expect(mmr).toHaveLength(1);
    expect(mmr[0]!.score).toBe(0.9);
  });

  test("returns empty when limit is 0", () => {
    const results = [makeResult("hello world test", 0.9)];
    expect(applyMmr(results, 0.7, 0)).toEqual([]);
  });

  test("always picks highest-scored result first", () => {
    const results = [
      makeResult("machine learning models", 0.95),
      makeResult("deep learning neural networks", 0.8),
      makeResult("natural language processing", 0.7),
    ];
    const mmr = applyMmr(results, 0.7, 3);
    expect(mmr[0]!.score).toBe(0.95);
  });

  test("respects limit parameter", () => {
    const results = [
      makeResult("alpha bravo charlie", 0.9),
      makeResult("delta echo foxtrot", 0.8),
      makeResult("golf hotel india", 0.7),
    ];
    const mmr = applyMmr(results, 0.7, 2);
    expect(mmr).toHaveLength(2);
  });

  test("limit greater than results returns all", () => {
    const results = [
      makeResult("alpha bravo charlie", 0.9),
      makeResult("delta echo foxtrot", 0.8),
    ];
    const mmr = applyMmr(results, 0.7, 10);
    expect(mmr).toHaveLength(2);
  });

  test("penalizes near-duplicate content", () => {
    const results = [
      makeResult("machine learning models training data", 0.95),
      makeResult("machine learning models training sets", 0.90),
      makeResult("quantum computing algorithms research", 0.85),
    ];
    // With lambda=0.7, the diverse result should be preferred over the near-duplicate
    const mmr = applyMmr(results, 0.7, 2);
    expect(mmr[0]!.score).toBe(0.95);
    // Second pick should favor diversity — the quantum computing result
    expect(mmr[1]!.chunk.content).toContain("quantum");
  });

  test("lambda=1.0 acts as pure relevance ranking (no diversity)", () => {
    const results = [
      makeResult("machine learning models training data", 0.95),
      makeResult("machine learning models training sets", 0.90),
      makeResult("quantum computing algorithms research", 0.85),
    ];
    const mmr = applyMmr(results, 1.0, 3);
    // Pure relevance — should keep original order
    expect(mmr[0]!.score).toBe(0.95);
    expect(mmr[1]!.score).toBe(0.90);
    expect(mmr[2]!.score).toBe(0.85);
  });

  test("lambda=0.0 maximizes diversity", () => {
    const results = [
      makeResult("machine learning models training data", 0.95),
      makeResult("machine learning models training sets", 0.90),
      makeResult("quantum computing algorithms research", 0.85),
    ];
    const mmr = applyMmr(results, 0.0, 3);
    // First is always highest score, but second should be most diverse
    expect(mmr[0]!.score).toBe(0.95);
    expect(mmr[1]!.chunk.content).toContain("quantum");
  });
});
