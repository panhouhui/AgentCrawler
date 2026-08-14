import { test, expect } from "bun:test";
import React from "react";
import { renderHTML, mount } from "../test-helpers";
import { CardGrid } from "./CardGrid";

test("CardGrid renders children", () => {
  const html = renderHTML(
    React.createElement(CardGrid, null,
      React.createElement("div", null, "Card 1"),
      React.createElement("div", null, "Card 2"),
    ),
  );
  expect(html).toContain("Card 1");
  expect(html).toContain("Card 2");
});

test("CardGrid has grid display class", () => {
  const html = renderHTML(React.createElement(CardGrid, null, React.createElement("div", null, "A")));
  expect(html).toContain("grid");
});

test("CardGrid uses default minWidth of 360px", () => {
  const html = renderHTML(React.createElement(CardGrid, null, React.createElement("div", null, "A")));
  expect(html).toContain("360px");
});

test("CardGrid uses custom minWidth", () => {
  const html = renderHTML(React.createElement(CardGrid, { minWidth: "200px", children: null }, React.createElement("div", null, "A")));
  expect(html).toContain("200px");
});

test("CardGrid applies custom gap via style", () => {
  const { container, unmount } = mount(
    React.createElement(CardGrid, { gap: "1rem", children: null }, React.createElement("div", null, "A")),
  );
  const gridEl = container.querySelector(".grid") as HTMLElement;
  expect(gridEl.style.gap).toBe("1rem");
  unmount();
});
