import { test, expect } from "bun:test";

// Re-implemented from Logs.tsx (module-private pure data/logic)

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

const LEVEL_NUM: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  processName?: string;
  data?: unknown;
}

function filterByLevel(logs: LogEntry[], minLevel: LogLevel): LogEntry[] {
  return logs.filter((l) => LEVEL_NUM[l.level] >= LEVEL_NUM[minLevel]);
}

function countLevels(logs: LogEntry[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const l of logs) counts[l.level]++;
  return counts;
}

const mkLog = (level: LogLevel, message: string = "test"): LogEntry => ({
  timestamp: "2024-01-15T10:00:00.000Z",
  level,
  context: "test",
  message,
});

/* ---------- LEVEL_NUM ---------- */

test("LEVEL_NUM has correct ordering", () => {
  expect(LEVEL_NUM.debug).toBeLessThan(LEVEL_NUM.info);
  expect(LEVEL_NUM.info).toBeLessThan(LEVEL_NUM.warn);
  expect(LEVEL_NUM.warn).toBeLessThan(LEVEL_NUM.error);
});

/* ---------- LEVELS ---------- */

test("LEVELS contains all 4 levels in order", () => {
  expect(LEVELS).toEqual(["debug", "info", "warn", "error"]);
});

/* ---------- filterByLevel ---------- */

test("filterByLevel with debug shows all", () => {
  const logs = [mkLog("debug"), mkLog("info"), mkLog("warn"), mkLog("error")];
  expect(filterByLevel(logs, "debug").length).toBe(4);
});

test("filterByLevel with info hides debug", () => {
  const logs = [mkLog("debug"), mkLog("info"), mkLog("warn"), mkLog("error")];
  const filtered = filterByLevel(logs, "info");
  expect(filtered.length).toBe(3);
  expect(filtered.some((l) => l.level === "debug")).toBe(false);
});

test("filterByLevel with warn shows warn and error only", () => {
  const logs = [mkLog("debug"), mkLog("info"), mkLog("warn"), mkLog("error")];
  const filtered = filterByLevel(logs, "warn");
  expect(filtered.length).toBe(2);
  expect(filtered.map((l) => l.level)).toEqual(["warn", "error"]);
});

test("filterByLevel with error shows only errors", () => {
  const logs = [mkLog("debug"), mkLog("info"), mkLog("warn"), mkLog("error")];
  const filtered = filterByLevel(logs, "error");
  expect(filtered.length).toBe(1);
  expect(filtered[0]!.level).toBe("error");
});

test("filterByLevel handles empty array", () => {
  expect(filterByLevel([], "debug")).toEqual([]);
});

/* ---------- countLevels ---------- */

test("countLevels counts each level correctly", () => {
  const logs = [
    mkLog("debug"),
    mkLog("debug"),
    mkLog("info"),
    mkLog("warn"),
    mkLog("error"),
    mkLog("error"),
    mkLog("error"),
  ];
  expect(countLevels(logs)).toEqual({
    debug: 2,
    info: 1,
    warn: 1,
    error: 3,
  });
});

test("countLevels returns zeros for empty array", () => {
  expect(countLevels([])).toEqual({
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  });
});
