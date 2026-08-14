import { test, expect, describe } from "bun:test";
import { applyTemporalDecay } from "./temporal-decay";

const SECONDS_PER_DAY = 86_400;

describe("applyTemporalDecay", () => {
  test("fresh item (0 days old) returns original score", () => {
    const now = 1_700_000_000;
    const result = applyTemporalDecay(0.9, now, now, 30);
    expect(result).toBeCloseTo(0.9, 10);
  });

  test("item at exactly half-life returns half the score", () => {
    const now = 1_700_000_000;
    const halfLifeDays = 30;
    const createdAt = now - halfLifeDays * SECONDS_PER_DAY;
    const result = applyTemporalDecay(1.0, createdAt, now, halfLifeDays);
    expect(result).toBeCloseTo(0.5, 5);
  });

  test("item at 2x half-life returns quarter of the score", () => {
    const now = 1_700_000_000;
    const halfLifeDays = 30;
    const createdAt = now - 2 * halfLifeDays * SECONDS_PER_DAY;
    const result = applyTemporalDecay(1.0, createdAt, now, halfLifeDays);
    expect(result).toBeCloseTo(0.25, 5);
  });

  test("very old item has near-zero score", () => {
    const now = 1_700_000_000;
    const createdAt = now - 365 * SECONDS_PER_DAY;
    const result = applyTemporalDecay(1.0, createdAt, now, 7);
    expect(result).toBeLessThan(0.001);
  });

  test("halfLifeDays=0 returns original score (no decay)", () => {
    const now = 1_700_000_000;
    const createdAt = now - 100 * SECONDS_PER_DAY;
    const result = applyTemporalDecay(0.8, createdAt, now, 0);
    expect(result).toBe(0.8);
  });

  test("negative halfLifeDays returns original score", () => {
    const now = 1_700_000_000;
    const createdAt = now - 10 * SECONDS_PER_DAY;
    const result = applyTemporalDecay(0.8, createdAt, now, -5);
    expect(result).toBe(0.8);
  });

  test("future createdAt (negative age) clamps to 0 age", () => {
    const now = 1_700_000_000;
    const createdAt = now + 10 * SECONDS_PER_DAY;
    const result = applyTemporalDecay(0.9, createdAt, now, 30);
    // Math.max(0, ...) clamps negative age to 0 → no decay
    expect(result).toBeCloseTo(0.9, 10);
  });

  test("preserves proportionality with different base scores", () => {
    const now = 1_700_000_000;
    const createdAt = now - 15 * SECONDS_PER_DAY;
    const r1 = applyTemporalDecay(1.0, createdAt, now, 30);
    const r2 = applyTemporalDecay(0.5, createdAt, now, 30);
    expect(r2).toBeCloseTo(r1 * 0.5, 10);
  });
});
