import { test, expect } from "bun:test";
import {
  formatTime,
  formatNumber,
  relativeTime,
  formatUptime,
  formatTimestamp,
  formatLogTimestamp,
  formatAge,
  formatDate,
  formatShortDate,
  parseJsonArray,
  timeAgo,
  formatCountdown,
  intervalLabel,
} from "./format";

/* ---------- formatTime ---------- */

test("formatTime returns Chinese empty-state label for null/0", () => {
  expect(formatTime(null)).toBe("从未");
  expect(formatTime(0)).toBe("从未");
});

test("formatTime formats an epoch to locale string", () => {
  const epoch = 1700000000;
  const result = formatTime(epoch);
  expect(result).toContain("2023");
});

/* ---------- formatNumber ---------- */

test("formatNumber returns raw string for small numbers", () => {
  expect(formatNumber(42)).toBe("42");
  expect(formatNumber(999)).toBe("999");
});

test("formatNumber uses K suffix for thousands", () => {
  expect(formatNumber(1_500)).toBe("1.5K");
  expect(formatNumber(10_000)).toBe("10.0K");
});

test("formatNumber uses M suffix for millions", () => {
  expect(formatNumber(2_500_000)).toBe("2.5M");
});

/* ---------- relativeTime ---------- */

test("relativeTime returns Chinese recent label for recent epochs", () => {
  const now = Math.floor(Date.now() / 1000);
  expect(relativeTime(now - 30)).toBe("刚刚");
});

test("relativeTime returns minutes ago", () => {
  const now = Math.floor(Date.now() / 1000);
  expect(relativeTime(now - 300)).toBe("5 分钟前");
});

test("relativeTime returns hours ago", () => {
  const now = Math.floor(Date.now() / 1000);
  expect(relativeTime(now - 7200)).toBe("2 小时前");
});

test("relativeTime returns days ago", () => {
  const now = Math.floor(Date.now() / 1000);
  expect(relativeTime(now - 172800)).toBe("2 天前");
});

/* ---------- timeAgo ---------- */

test("timeAgo returns Chinese yesterday label for 1 day ago", () => {
  const now = Math.floor(Date.now() / 1000);
  expect(timeAgo(now - 86400)).toBe("昨天");
});

test("timeAgo returns 'Xd ago' for multiple days", () => {
  const now = Math.floor(Date.now() / 1000);
  expect(timeAgo(now - 86400 * 3)).toBe("3 天前");
});

/* ---------- formatUptime ---------- */

test("formatUptime formats seconds only", () => {
  expect(formatUptime(45)).toBe("45秒");
});

test("formatUptime formats minutes and seconds", () => {
  expect(formatUptime(125)).toBe("2分钟 5秒");
});

test("formatUptime formats hours, minutes, seconds", () => {
  expect(formatUptime(3661)).toBe("1小时 1分钟 1秒");
});

test("formatUptime formats days, hours, minutes", () => {
  expect(formatUptime(90061)).toBe("1天 1小时 1分钟");
});

/* ---------- formatTimestamp ---------- */

test("formatTimestamp returns dash for falsy epoch", () => {
  expect(formatTimestamp(0)).toBe("—");
});

test("formatTimestamp returns HH:MM:SS format", () => {
  const result = formatTimestamp(1700000000);
  expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
});

/* ---------- formatLogTimestamp ---------- */

test("formatLogTimestamp formats ISO string to HH:MM:SS.mmm", () => {
  const result = formatLogTimestamp("2024-01-15T10:30:45.123Z");
  expect(result).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
});

/* ---------- formatAge ---------- */

test("formatAge returns empty for falsy", () => {
  expect(formatAge(0)).toBe("");
});

test("formatAge returns short relative format", () => {
  const now = Math.floor(Date.now() / 1000);
  expect(formatAge(now - 300)).toBe("5分钟");
  expect(formatAge(now - 7200)).toBe("2小时");
  expect(formatAge(now - 172800)).toBe("2天");
});

/* ---------- formatDate ---------- */

test("formatDate extracts YYYY-MM-DD from ISO string", () => {
  expect(formatDate("2024-03-15T10:00:00Z")).toBe("2024-03-15");
});

test("formatDate returns empty for empty string", () => {
  expect(formatDate("")).toBe("");
});

/* ---------- formatShortDate ---------- */

test("formatShortDate formats to Chinese month/day", () => {
  const result = formatShortDate("2024-01-15T00:00:00Z");
  expect(result).toBe("1月15日");
});

/* ---------- parseJsonArray ---------- */

test("parseJsonArray parses valid JSON array", () => {
  expect(parseJsonArray('["a","b","c"]')).toEqual(["a", "b", "c"]);
});

test("parseJsonArray returns [] for invalid JSON", () => {
  expect(parseJsonArray("not json")).toEqual([]);
});

test("parseJsonArray returns [] for non-array JSON", () => {
  expect(parseJsonArray('{"key":"val"}')).toEqual([]);
});

/* ---------- formatCountdown ---------- */

test("formatCountdown returns Chinese now label for past epoch", () => {
  const past = Math.floor(Date.now() / 1000) - 10;
  expect(formatCountdown(past)).toBe("现在");
});

test("formatCountdown formats seconds", () => {
  const future = Math.floor(Date.now() / 1000) + 30;
  expect(formatCountdown(future)).toMatch(/\d+秒/);
});

test("formatCountdown formats minutes and seconds", () => {
  const future = Math.floor(Date.now() / 1000) + 125;
  expect(formatCountdown(future)).toMatch(/\d+分钟 \d+秒/);
});

test("formatCountdown formats hours and minutes", () => {
  const future = Math.floor(Date.now() / 1000) + 3700;
  expect(formatCountdown(future)).toMatch(/\d+小时 \d+分钟/);
});

/* ---------- intervalLabel ---------- */

test("intervalLabel formats minutes", () => {
  expect(intervalLabel(30)).toBe("每 30 分钟");
});

test("intervalLabel formats whole hours", () => {
  expect(intervalLabel(60)).toBe("每 1 小时");
  expect(intervalLabel(120)).toBe("每 2 小时");
});

test("intervalLabel formats hours and remainder", () => {
  expect(intervalLabel(90)).toBe("每 1 小时 30 分钟");
});
