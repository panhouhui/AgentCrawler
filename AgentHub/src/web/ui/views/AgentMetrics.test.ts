import { test, expect } from "bun:test";

// Re-implemented from AgentMetrics.tsx (module-private pure functions and constants)

const RANGES = [
  { id: "24h", label: "24h", seconds: 86400 },
  { id: "7d", label: "7d", seconds: 7 * 86400 },
  { id: "30d", label: "30d", seconds: 30 * 86400 },
  { id: "all", label: "All", seconds: 0 },
] as const;

const CHART_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (!ms) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function sinceEpoch(rangeId: string): number | undefined {
  const range = RANGES.find((r) => r.id === rangeId);
  if (!range || range.seconds === 0) return undefined;
  return Math.floor(Date.now() / 1000) - range.seconds;
}

/* ---------- RANGES ---------- */

test("RANGES has 4 entries", () => {
  expect(RANGES.length).toBe(4);
});

test("RANGES ids are unique", () => {
  const ids = RANGES.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("RANGES seconds increase (except all=0)", () => {
  expect(RANGES[0].seconds).toBe(86400);
  expect(RANGES[1].seconds).toBe(7 * 86400);
  expect(RANGES[2].seconds).toBe(30 * 86400);
  expect(RANGES[3].seconds).toBe(0);
});

/* ---------- CHART_COLORS ---------- */

test("CHART_COLORS has 10 entries", () => {
  expect(CHART_COLORS.length).toBe(10);
});

test("CHART_COLORS are all valid hex colors", () => {
  for (const c of CHART_COLORS) {
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
  }
});

test("CHART_COLORS are unique", () => {
  expect(new Set(CHART_COLORS).size).toBe(CHART_COLORS.length);
});

/* ---------- formatCost ---------- */

test("formatCost: zero", () => {
  expect(formatCost(0)).toBe("$0.00");
});

test("formatCost: small value uses 4 decimals", () => {
  expect(formatCost(0.0012)).toBe("$0.0012");
});

test("formatCost: normal value uses 2 decimals", () => {
  expect(formatCost(1.5)).toBe("$1.50");
});

test("formatCost: boundary at 0.01", () => {
  expect(formatCost(0.01)).toBe("$0.01");
});

test("formatCost: sub-cent value", () => {
  expect(formatCost(0.009)).toBe("$0.0090");
});

test("formatCost: large value", () => {
  expect(formatCost(123.456)).toBe("$123.46");
});

/* ---------- formatDuration ---------- */

test("formatDuration: zero returns dash", () => {
  expect(formatDuration(0)).toBe("\u2014");
});

test("formatDuration: milliseconds", () => {
  expect(formatDuration(500)).toBe("500ms");
});

test("formatDuration: seconds", () => {
  expect(formatDuration(3500)).toBe("3.5s");
});

test("formatDuration: minutes and seconds", () => {
  expect(formatDuration(90000)).toBe("1m 30s");
});

test("formatDuration: exact minute", () => {
  expect(formatDuration(60000)).toBe("1m 0s");
});

test("formatDuration: boundary at 1000ms", () => {
  expect(formatDuration(999)).toBe("999ms");
  expect(formatDuration(1000)).toBe("1.0s");
});

/* ---------- sinceEpoch ---------- */

test("sinceEpoch: returns undefined for 'all'", () => {
  expect(sinceEpoch("all")).toBeUndefined();
});

test("sinceEpoch: returns undefined for unknown range", () => {
  expect(sinceEpoch("unknown")).toBeUndefined();
});

test("sinceEpoch: 24h returns epoch about 86400 seconds ago", () => {
  const result = sinceEpoch("24h")!;
  const now = Math.floor(Date.now() / 1000);
  expect(now - result).toBeCloseTo(86400, -1);
});

test("sinceEpoch: 7d returns epoch about 7 days ago", () => {
  const result = sinceEpoch("7d")!;
  const now = Math.floor(Date.now() / 1000);
  expect(now - result).toBeCloseTo(7 * 86400, -1);
});

test("sinceEpoch: 30d returns epoch about 30 days ago", () => {
  const result = sinceEpoch("30d")!;
  const now = Math.floor(Date.now() / 1000);
  expect(now - result).toBeCloseTo(30 * 86400, -1);
});
