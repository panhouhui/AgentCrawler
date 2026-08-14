import { test, expect, describe } from "bun:test";
import { windowToHours } from "./interval";

describe("windowToHours", () => {
  test("parses hours", () => {
    expect(windowToHours("1h")).toBe(1);
    expect(windowToHours("12h")).toBe(12);
    expect(windowToHours("24h")).toBe(24);
  });

  test("parses days", () => {
    expect(windowToHours("1d")).toBe(24);
    expect(windowToHours("7d")).toBe(168);
    expect(windowToHours("30d")).toBe(720);
  });

  test("parses weeks", () => {
    expect(windowToHours("1w")).toBe(168);
    expect(windowToHours("2w")).toBe(336);
  });

  test("parses months", () => {
    expect(windowToHours("1m")).toBe(720);
    expect(windowToHours("3m")).toBe(2160);
  });

  test("returns 24 for unknown format", () => {
    expect(windowToHours("unknown")).toBe(24);
    expect(windowToHours("abc")).toBe(24);
    expect(windowToHours("")).toBe(24);
  });
});
