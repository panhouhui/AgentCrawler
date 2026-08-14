import { test, expect, describe } from "bun:test";
import { createLoopDetector, DEFAULT_LOOP_CONFIG } from "./loop-detection";

describe("createLoopDetector", () => {
  test("no detection on first call", () => {
    const detector = createLoopDetector();
    const result = detector.check("bash", { command: "ls" });
    expect(result.stuck).toBe(false);
    expect(result.level).toBeUndefined();
  });

  test("no detection with different args", () => {
    const detector = createLoopDetector();
    for (let i = 0; i < 10; i++) {
      detector.check("bash", { command: `ls ${i}` });
    }
    const result = detector.check("bash", { command: "ls 99" });
    expect(result.stuck).toBe(false);
  });

  test("warning at threshold with same args", () => {
    const detector = createLoopDetector({ ...DEFAULT_LOOP_CONFIG, warningThreshold: 3 });
    // 3 checks build up history, 4th check sees 3 repeats → warning
    for (let i = 0; i < 3; i++) {
      detector.check("bash", { command: "git status" });
    }
    const result = detector.check("bash", { command: "git status" });
    expect(result.stuck).toBe(false);
    expect(result.level).toBe("warning");
    expect(result.message).toContain("3 times");
  });

  test("critical at threshold — stuck = true", () => {
    const detector = createLoopDetector({
      ...DEFAULT_LOOP_CONFIG,
      warningThreshold: 3,
      criticalThreshold: 5,
    });
    // 5 checks build up history, 6th check sees 5 repeats → critical
    for (let i = 0; i < 5; i++) {
      detector.check("read_file", { path: "/foo" });
    }
    const result = detector.check("read_file", { path: "/foo" });
    expect(result.stuck).toBe(true);
    expect(result.level).toBe("critical");
    expect(result.message).toContain("STOP");
  });

  test("different tool names don't count as repeats", () => {
    const detector = createLoopDetector({ ...DEFAULT_LOOP_CONFIG, warningThreshold: 3 });
    for (let i = 0; i < 5; i++) {
      detector.check("bash", { command: "ls" });
      detector.check("read_file", { path: "/foo" });
    }
    // bash has been checked 5 times already → 6th sees 5 repeats → warning
    const result = detector.check("bash", { command: "ls" });
    expect(result.level).toBe("warning");
  });

  test("sliding window evicts old entries", () => {
    const detector = createLoopDetector({
      historySize: 5,
      warningThreshold: 4,
      criticalThreshold: 8,
    });
    // Check 5 identical calls (fills history)
    for (let i = 0; i < 5; i++) {
      detector.check("bash", { command: "ls" });
    }
    // Now check 5 different calls to push old ones out
    for (let i = 0; i < 5; i++) {
      detector.check("read_file", { path: `/file${i}` });
    }
    // The old "bash ls" entries should be evicted
    const result = detector.check("bash", { command: "ls" });
    expect(result.stuck).toBe(false);
    expect(result.level).toBeUndefined();
  });

  test("default config values", () => {
    expect(DEFAULT_LOOP_CONFIG.historySize).toBe(20);
    expect(DEFAULT_LOOP_CONFIG.warningThreshold).toBe(5);
    expect(DEFAULT_LOOP_CONFIG.criticalThreshold).toBe(10);
  });
});
