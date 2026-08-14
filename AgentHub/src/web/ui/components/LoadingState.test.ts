import { test, expect } from "bun:test";
import React from "react";
import { renderHTML } from "../test-helpers";
import { LoadingState } from "./LoadingState";

test("LoadingState renders spinner", () => {
  const html = renderHTML(React.createElement(LoadingState));
  expect(html).toContain("animate-spin");
});

test("LoadingState renders message when provided", () => {
  const html = renderHTML(
    React.createElement(LoadingState, { message: "Loading data..." }),
  );
  expect(html).toContain("Loading data...");
});

test("LoadingState omits message text when not provided", () => {
  const html = renderHTML(React.createElement(LoadingState));
  expect(html).not.toContain("text-muted");
});

test("LoadingState has centered layout", () => {
  const html = renderHTML(React.createElement(LoadingState));
  expect(html).toContain("items-center");
  expect(html).toContain("justify-center");
});
