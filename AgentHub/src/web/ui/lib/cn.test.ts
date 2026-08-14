import { test, expect } from "bun:test";
import { cn } from "./cn";

test("cn joins multiple class strings", () => {
  expect(cn("foo", "bar", "baz")).toBe("foo bar baz");
});

test("cn filters out false values", () => {
  expect(cn("foo", false, "bar")).toBe("foo bar");
});

test("cn filters out null and undefined", () => {
  expect(cn("foo", null, undefined, "bar")).toBe("foo bar");
});

test("cn filters out empty strings", () => {
  expect(cn("foo", "", "bar")).toBe("foo bar");
});

test("cn returns empty string when all falsy", () => {
  expect(cn(false, null, undefined)).toBe("");
});

test("cn returns single class unchanged", () => {
  expect(cn("only")).toBe("only");
});

test("cn handles no arguments", () => {
  expect(cn()).toBe("");
});
