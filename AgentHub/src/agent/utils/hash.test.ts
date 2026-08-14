import { test, expect, describe } from "bun:test";
import { hashTask } from "./hash";

describe("hashTask", () => {
  test("returns 16 char hex string", () => {
    const result = hashTask("test task");
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is deterministic", () => {
    const a = hashTask("same input");
    const b = hashTask("same input");
    expect(a).toBe(b);
  });

  test("produces different hashes for different inputs", () => {
    const a = hashTask("input one");
    const b = hashTask("input two");
    expect(a).not.toBe(b);
  });

  test("handles empty string", () => {
    const result = hashTask("");
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  test("handles unicode", () => {
    const result = hashTask("日本語テスト 🚀");
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });
});
