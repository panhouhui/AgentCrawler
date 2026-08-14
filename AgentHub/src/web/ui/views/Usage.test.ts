import { test, expect } from "bun:test";

// Re-implemented from Usage.tsx (module-private pure functions)

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (!ms) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

const RANGES = [
  { id: "24h", label: "24h", seconds: 86400 },
  { id: "7d", label: "7d", seconds: 7 * 86400 },
  { id: "30d", label: "30d", seconds: 30 * 86400 },
  { id: "all", label: "All", seconds: 0 },
] as const;

function sinceEpoch(rangeId: string): number | undefined {
  const range = RANGES.find((r) => r.id === rangeId);
  if (!range || range.seconds === 0) return undefined;
  return Math.floor(Date.now() / 1000) - range.seconds;
}

/* ---------- formatCost ---------- */

test("formatCost returns $0.00 for zero", () => {
  expect(formatCost(0)).toBe("$0.00");
});

test("formatCost shows 4 decimals for sub-cent values", () => {
  expect(formatCost(0.0012)).toBe("$0.0012");
  expect(formatCost(0.0099)).toBe("$0.0099");
});

test("formatCost shows 2 decimals for normal values", () => {
  expect(formatCost(1.5)).toBe("$1.50");
  expect(formatCost(12.345)).toBe("$12.35");
  expect(formatCost(0.01)).toBe("$0.01");
});

test("formatCost handles large values", () => {
  expect(formatCost(999.99)).toBe("$999.99");
  expect(formatCost(1234.567)).toBe("$1234.57");
});

/* ---------- formatDuration ---------- */

test("formatDuration returns dash for 0", () => {
  expect(formatDuration(0)).toBe("\u2014");
});

test("formatDuration shows milliseconds for < 1000", () => {
  expect(formatDuration(50)).toBe("50ms");
  expect(formatDuration(999)).toBe("999ms");
});

test("formatDuration shows seconds for < 60s", () => {
  expect(formatDuration(1000)).toBe("1.0s");
  expect(formatDuration(5500)).toBe("5.5s");
  expect(formatDuration(59999)).toBe("60.0s");
});

test("formatDuration shows minutes and seconds for >= 60s", () => {
  expect(formatDuration(60000)).toBe("1m 0s");
  expect(formatDuration(90000)).toBe("1m 30s");
  expect(formatDuration(125000)).toBe("2m 5s");
});

/* ---------- sinceEpoch ---------- */

test("sinceEpoch returns undefined for 'all'", () => {
  expect(sinceEpoch("all")).toBeUndefined();
});

test("sinceEpoch returns undefined for unknown range", () => {
  expect(sinceEpoch("unknown")).toBeUndefined();
});

test("sinceEpoch returns epoch for 24h range", () => {
  const result = sinceEpoch("24h");
  expect(result).toBeDefined();
  const now = Math.floor(Date.now() / 1000);
  expect(now - result!).toBeGreaterThanOrEqual(86399);
  expect(now - result!).toBeLessThanOrEqual(86401);
});

test("sinceEpoch returns epoch for 7d range", () => {
  const result = sinceEpoch("7d");
  expect(result).toBeDefined();
  const now = Math.floor(Date.now() / 1000);
  const diff = now - result!;
  expect(diff).toBeGreaterThanOrEqual(7 * 86400 - 1);
  expect(diff).toBeLessThanOrEqual(7 * 86400 + 1);
});

/* ---------- RANGES ---------- */

test("RANGES has 4 entries with correct ids", () => {
  expect(RANGES.map((r) => r.id)).toEqual(["24h", "7d", "30d", "all"]);
});

test("RANGES seconds increase (except all = 0)", () => {
  expect(RANGES[0].seconds).toBe(86400);
  expect(RANGES[1].seconds).toBe(7 * 86400);
  expect(RANGES[2].seconds).toBe(30 * 86400);
  expect(RANGES[3].seconds).toBe(0);
});
