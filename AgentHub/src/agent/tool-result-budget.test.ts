import { test, expect, describe } from "bun:test";
import {
  computeToolResultBudget,
  truncateToolResult,
} from "./tool-result-budget";

describe("computeToolResultBudget", () => {
  test("caps at 20K for 200K context window", () => {
    const budget = computeToolResultBudget(200_000);
    // 200K * 0.5 * 0.15 * 4 = 60K, capped at 20K
    expect(budget.maxSingleResultChars).toBe(20_000);
  });

  test("caps at 20K for 100K context window", () => {
    const budget = computeToolResultBudget(100_000);
    // 100K * 0.5 * 0.15 * 4 = 30K, capped at 20K
    expect(budget.maxSingleResultChars).toBe(20_000);
  });

  test("uses formula when below hard cap", () => {
    // 50K * 0.5 * 0.15 * 4 = 15K (below 20K cap)
    const budget = computeToolResultBudget(50_000);
    expect(budget.maxSingleResultChars).toBe(15_000);
  });

  test("enforces minimum of 4096 chars", () => {
    const budget = computeToolResultBudget(100);
    expect(budget.maxSingleResultChars).toBe(4_096);
  });

  test("handles zero context window", () => {
    const budget = computeToolResultBudget(0);
    expect(budget.maxSingleResultChars).toBe(4_096);
  });
});

describe("truncateToolResult", () => {
  test("returns output unchanged when under budget", () => {
    const output = "short output";
    expect(truncateToolResult(output, 1000)).toBe(output);
  });

  test("truncates with head-only when over budget", () => {
    const output = "A".repeat(100) + "B".repeat(100) + "C".repeat(100);
    const result = truncateToolResult(output, 200);

    expect(result).toContain("truncated");
    expect(result).toContain("A".repeat(50));
    // Should NOT contain tail content (head-only for security)
    expect(result).not.toContain("C".repeat(50));
  });

  test("preserves head content", () => {
    const output = "HEADER_CONTENT" + "x".repeat(10_000) + "TAIL_CONTENT";
    const result = truncateToolResult(output, 500);
    expect(result).toContain("HEADER_CONTENT");
  });

  test("does not expose tail content (security)", () => {
    const output = "x".repeat(10_000) + "SECRET_AT_END";
    const result = truncateToolResult(output, 500);
    expect(result).not.toContain("SECRET_AT_END");
  });

  test("exact boundary — returns unchanged", () => {
    const output = "x".repeat(1000);
    expect(truncateToolResult(output, 1000)).toBe(output);
  });
});
