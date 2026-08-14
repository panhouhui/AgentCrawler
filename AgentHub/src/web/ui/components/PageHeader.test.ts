import { test, expect } from "bun:test";
import React from "react";
import { renderHTML } from "../test-helpers";
import { PageHeader } from "./PageHeader";

test("PageHeader renders title", () => {
  const html = renderHTML(React.createElement(PageHeader, { title: "Dashboard" }));
  expect(html).toContain("Dashboard");
  expect(html).toContain("<h2");
});

test("PageHeader renders count badge when provided", () => {
  const html = renderHTML(React.createElement(PageHeader, { title: "Items", count: 42 }));
  expect(html).toContain("42");
  expect(html).toContain("font-mono");
});

test("PageHeader omits count badge when not provided", () => {
  const html = renderHTML(React.createElement(PageHeader, { title: "Items" }));
  const countBadgePattern = /font-mono.*text-sm/;
  expect(html).not.toMatch(countBadgePattern);
});

test("PageHeader renders subtitle when provided", () => {
  const html = renderHTML(React.createElement(PageHeader, { title: "T", subtitle: "Sub text" }));
  expect(html).toContain("Sub text");
  expect(html).toContain("<p");
});

test("PageHeader omits subtitle when not provided", () => {
  const html = renderHTML(React.createElement(PageHeader, { title: "T" }));
  expect(html).not.toContain("<p");
});

test("PageHeader renders actions slot", () => {
  const actions = React.createElement("button", null, "Add New");
  const html = renderHTML(React.createElement(PageHeader, { title: "T", actions }));
  expect(html).toContain("Add New");
});

test("PageHeader omits actions container when not provided", () => {
  const html = renderHTML(React.createElement(PageHeader, { title: "T" }));
  expect(html).not.toContain("shrink-0");
});

test("PageHeader renders count of 0", () => {
  const html = renderHTML(React.createElement(PageHeader, { title: "Empty", count: 0 }));
  expect(html).toContain(">0<");
});
