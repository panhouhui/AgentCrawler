import { test, expect } from "bun:test";
import React from "react";
import { renderHTML, mount } from "../test-helpers";
import { StatusBadge } from "./StatusBadge";

test("StatusBadge renders status text", () => {
  const html = renderHTML(React.createElement(StatusBadge, { status: "running" }));
  expect(html).toContain("running");
});

test("StatusBadge uses gray variant by default", () => {
  const html = renderHTML(React.createElement(StatusBadge, { status: "unknown" }));
  expect(html).toContain("bg-bg-3");
});

test("StatusBadge applies green variant", () => {
  const html = renderHTML(React.createElement(StatusBadge, { status: "ok", variant: "green" }));
  expect(html).toContain("bg-success-subtle");
  expect(html).toContain("text-success");
});

test("StatusBadge applies red variant", () => {
  const html = renderHTML(React.createElement(StatusBadge, { status: "err", variant: "red" }));
  expect(html).toContain("bg-danger-subtle");
});

test("StatusBadge applies yellow variant", () => {
  const html = renderHTML(React.createElement(StatusBadge, { status: "warn", variant: "yellow" }));
  expect(html).toContain("bg-warning-subtle");
});

test("StatusBadge applies blue variant", () => {
  const html = renderHTML(React.createElement(StatusBadge, { status: "info", variant: "blue" }));
  expect(html).toContain("bg-accent-subtle");
});

test("StatusBadge resolves variant from colorMap", () => {
  const colorMap = { running: "green", stopped: "red" };
  const html = renderHTML(React.createElement(StatusBadge, { status: "running", colorMap }));
  expect(html).toContain("bg-success-subtle");
});

test("StatusBadge colorMap overrides variant prop", () => {
  const colorMap = { active: "red" };
  const html = renderHTML(React.createElement(StatusBadge, { status: "active", variant: "blue", colorMap }));
  expect(html).toContain("bg-danger-subtle");
});

test("StatusBadge falls back to variant when status not in colorMap", () => {
  const colorMap = { other: "green" };
  const html = renderHTML(React.createElement(StatusBadge, { status: "mine", variant: "yellow", colorMap }));
  expect(html).toContain("bg-warning-subtle");
});

test("StatusBadge falls back to gray when colorMap miss and no variant", () => {
  const colorMap = { other: "green" };
  const html = renderHTML(React.createElement(StatusBadge, { status: "mine", colorMap }));
  expect(html).toContain("bg-bg-3");
});

test("StatusBadge renders a dot indicator", () => {
  const { container, unmount } = mount(React.createElement(StatusBadge, { status: "ok", variant: "green" }));
  const dots = container.querySelectorAll(".rounded-full");
  expect(dots.length).toBeGreaterThanOrEqual(1);
  unmount();
});

test("StatusBadge has uppercase text", () => {
  const html = renderHTML(React.createElement(StatusBadge, { status: "ok" }));
  expect(html).toContain("uppercase");
});
