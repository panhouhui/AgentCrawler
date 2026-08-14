import { test, expect } from "bun:test";
import React from "react";
import { renderHTML, mount, click, queryAll } from "../test-helpers";
import { FilterTabs } from "./FilterTabs";

const TABS = [
  { id: "all", label: "All", count: 10 },
  { id: "active", label: "Active", count: 3 },
  { id: "stopped", label: "Stopped" },
];

test("FilterTabs renders all tab labels", () => {
  const html = renderHTML(React.createElement(FilterTabs, { tabs: TABS, active: "all", onChange: () => {} }));
  expect(html).toContain("All");
  expect(html).toContain("Active");
  expect(html).toContain("Stopped");
});

test("FilterTabs renders correct number of buttons", () => {
  const { container, unmount } = mount(
    React.createElement(FilterTabs, { tabs: TABS, active: "all", onChange: () => {} }),
  );
  const buttons = queryAll(container, "button");
  expect(buttons.length).toBe(3);
  unmount();
});

test("FilterTabs shows count badge when count is provided", () => {
  const html = renderHTML(React.createElement(FilterTabs, { tabs: TABS, active: "all", onChange: () => {} }));
  expect(html).toContain("10");
  expect(html).toContain("3");
});

test("FilterTabs active tab gets accent styling", () => {
  const { container, unmount } = mount(
    React.createElement(FilterTabs, { tabs: TABS, active: "all", onChange: () => {} }),
  );
  const buttons = queryAll(container, "button");
  const activeBtn = buttons[0] as HTMLElement;
  expect(activeBtn.className).toContain("bg-accent");
  unmount();
});

test("FilterTabs inactive tab gets transparent styling", () => {
  const { container, unmount } = mount(
    React.createElement(FilterTabs, { tabs: TABS, active: "all", onChange: () => {} }),
  );
  const buttons = queryAll(container, "button");
  const inactiveBtn = buttons[1] as HTMLElement;
  expect(inactiveBtn.className).toContain("bg-transparent");
  unmount();
});

test("FilterTabs calls onChange with tab id on click", () => {
  let selected = "";
  const { container, unmount } = mount(
    React.createElement(FilterTabs, { tabs: TABS, active: "all", onChange: (id: string) => { selected = id; } }),
  );
  const buttons = queryAll(container, "button");
  click(buttons[1]!);
  expect(selected).toBe("active");
  unmount();
});

test("FilterTabs clicking last tab calls onChange correctly", () => {
  let selected = "";
  const { container, unmount } = mount(
    React.createElement(FilterTabs, { tabs: TABS, active: "all", onChange: (id: string) => { selected = id; } }),
  );
  const buttons = queryAll(container, "button");
  click(buttons[2]!);
  expect(selected).toBe("stopped");
  unmount();
});

test("FilterTabs handles empty tabs array", () => {
  const html = renderHTML(React.createElement(FilterTabs, { tabs: [], active: "all", onChange: () => {} }));
  expect(html).not.toContain("<button");
});
