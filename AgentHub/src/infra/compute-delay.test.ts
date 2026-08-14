import { test, expect, describe } from "bun:test";

// computeDelay is not exported, so we replicate the logic for testing.
// This validates the exponential backoff + jitter algorithm.

function computeDelay(
  attempt: number,
  config: {
    readonly minDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitter: number;
  },
  retryAfterOverride?: number,
): number {
  if (retryAfterOverride !== undefined) {
    return Math.min(retryAfterOverride, config.maxDelayMs);
  }
  const base = config.minDelayMs * Math.pow(2, attempt - 1);
  const clamped = Math.min(base, config.maxDelayMs);
  const jitterRange = clamped * config.jitter;
  return clamped + (Math.random() * 2 - 1) * jitterRange;
}

describe("computeDelay", () => {
  const config = {
    minDelayMs: 500,
    maxDelayMs: 30000,
    jitter: 0.15,
  };

  test("first attempt uses minDelayMs as base", () => {
    const delay = computeDelay(1, { ...config, jitter: 0 });
    expect(delay).toBe(500);
  });

  test("exponential backoff doubles each attempt", () => {
    const noJitter = { ...config, jitter: 0 };
    expect(computeDelay(1, noJitter)).toBe(500);
    expect(computeDelay(2, noJitter)).toBe(1000);
    expect(computeDelay(3, noJitter)).toBe(2000);
    expect(computeDelay(4, noJitter)).toBe(4000);
  });

  test("clamps to maxDelayMs", () => {
    const noJitter = { ...config, jitter: 0 };
    // 500 * 2^9 = 256000 > 30000
    expect(computeDelay(10, noJitter)).toBe(30000);
  });

  test("adds jitter within expected range", () => {
    const results = Array.from({ length: 100 }, () => computeDelay(1, config));
    const base = 500;
    const jitterRange = base * 0.15;
    const min = base - jitterRange;
    const max = base + jitterRange;
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(min);
      expect(r).toBeLessThanOrEqual(max);
    }
  });

  test("retryAfterOverride takes precedence", () => {
    const delay = computeDelay(1, config, 5000);
    expect(delay).toBe(5000);
  });

  test("retryAfterOverride clamped to maxDelayMs", () => {
    const delay = computeDelay(1, config, 100000);
    expect(delay).toBe(30000);
  });

  test("zero jitter produces deterministic results", () => {
    const noJitter = { ...config, jitter: 0 };
    const a = computeDelay(3, noJitter);
    const b = computeDelay(3, noJitter);
    expect(a).toBe(b);
  });
});
