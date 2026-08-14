import { test, expect } from "bun:test";
import { NAV_SECTIONS, VALID_TABS, TAB_TITLES } from "./navigation";

test("NAV_SECTIONS has expected section titles", () => {
  const titles = NAV_SECTIONS.map((s) => s.title);
  expect(titles).toEqual([
    "控制台",
    "智能体",
    "爬虫配置",
    "情报分析",
    "kan推送配置",
    "系统",
  ]);
});

test("Dashboard section is not collapsible", () => {
  const dashboard = NAV_SECTIONS.find((s) => s.title === "控制台")!;
  expect(dashboard.collapsible).toBe(false);
});

test("Sources section is collapsible", () => {
  const sources = NAV_SECTIONS.find((s) => s.title === "爬虫配置")!;
  expect(sources.collapsible).toBe(true);
});

test("crawler config section contains only crawler platforms", () => {
  const crawlers = NAV_SECTIONS.find((s) => s.title === "爬虫配置")!;
  expect(crawlers.items.map((item) => item.id)).toEqual([
    "crawler-x",
    "crawler-facebook",
    "crawler-github",
    "crawler-instagram",
    "crawler-lien",
    "crawler-lihkg",
    "crawler-netlight",
    "crawler-ptt",
    "crawler-telegram",
    "crawler-youtube",
  ]);
  expect(crawlers.items.map((item) => item.label)).toEqual([
    "X",
    "Facebook",
    "GitHub",
    "instagram",
    "Lien",
    "Lihkg",
    "NetLight",
    "PTT",
    "Telegram",
    "YouTube",
  ]);
});

test("old product data source tabs are removed from navigation", () => {
  const ids = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.id));
  expect(ids).not.toContain("x-accounts");
  expect(ids).not.toContain("producthunt");
  expect(ids).not.toContain("hackernews");
  expect(ids).not.toContain("reddit");
  expect(ids).not.toContain("github");
  expect(ids).not.toContain("appstore");
  expect(ids).not.toContain("playstore");
});

test("all nav items have unique ids", () => {
  const ids = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.id));
  const uniqueIds = new Set(ids);
  expect(uniqueIds.size).toBe(ids.length);
});

test("all nav items have non-empty labels", () => {
  const items = NAV_SECTIONS.flatMap((s) => s.items);
  for (const item of items) {
    expect(item.label.length).toBeGreaterThan(0);
  }
});

test("all nav items have Icon component", () => {
  const items = NAV_SECTIONS.flatMap((s) => s.items);
  for (const item of items) {
    expect(item.Icon).toBeDefined();
  }
});

test("overview is in Dashboard section", () => {
  const dashboard = NAV_SECTIONS.find((s) => s.title === "控制台")!;
  const ids = dashboard.items.map((i) => i.id);
  expect(ids).toContain("overview");
});

test("agents section contains expected items", () => {
  const agents = NAV_SECTIONS.find((s) => s.title === "智能体")!;
  const ids = agents.items.map((i) => i.id);
  expect(ids).toContain("agents");
  expect(ids).toContain("sessions");
  expect(ids).toContain("channels");
  expect(ids).toContain("tools");
});

test("total nav items count is at least 20", () => {
  const total = NAV_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
  expect(total).toBeGreaterThanOrEqual(22);
});

test("keyword-research is a valid tab with a title and lives in Intelligence", () => {
  expect(VALID_TABS.has("keyword-research")).toBe(true);
  expect(TAB_TITLES["keyword-research"]).toBe("关键词研究");
  const intelligence = NAV_SECTIONS.find((s) => s.title === "情报分析")!;
  const ids = intelligence.items.map((i) => i.id);
  expect(ids).toContain("keyword-research");
});

test("kan-push is a valid standalone section between Intelligence and System", () => {
  expect(VALID_TABS.has("kan-push")).toBe(true);
  expect(TAB_TITLES["kan-push"]).toBe("kan推送配置");
  const titles = NAV_SECTIONS.map((s) => s.title);
  expect(titles.indexOf("kan推送配置")).toBe(titles.indexOf("情报分析") + 1);
  expect(titles.indexOf("系统")).toBe(titles.indexOf("kan推送配置") + 1);
});
