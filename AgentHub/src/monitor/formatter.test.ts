import { describe, test, expect } from "bun:test";
import {
  formatAlertMessage,
  formatResolvedMessage,
  formatBatchAlert,
} from "./formatter";
import type { CheckResult } from "./types";

describe("formatAlertMessage", () => {
  test("formats critical alert with metric", () => {
    const result: CheckResult = {
      category: "process",
      level: "critical",
      title: "Process agent is dead",
      detail: "No heartbeat for 185s (threshold: 60s)",
      metric: 185,
      threshold: 60,
    };
    const msg = formatAlertMessage(result);
    expect(msg).toContain("[CRITICAL]");
    expect(msg).toContain("Process agent is dead");
    expect(msg).toContain("No heartbeat for 185s");
    expect(msg).toContain("Metric: 185 (threshold: 60)");
  });

  test("formats warning alert without metric", () => {
    const result: CheckResult = {
      category: "error_rate",
      level: "warning",
      title: "Elevated error rate: 15.2%",
      detail: "12 errors / 79 total in 5m",
    };
    const msg = formatAlertMessage(result);
    expect(msg).toContain("[WARNING]");
    expect(msg).toContain("Elevated error rate");
    expect(msg).not.toContain("Metric:");
  });

  test("formats info alert", () => {
    const result: CheckResult = {
      category: "disk",
      level: "info",
      title: "Disk usage normal",
      detail: "Root partition at 45%",
    };
    const msg = formatAlertMessage(result);
    expect(msg).toContain("[INFO]");
  });
});

describe("formatResolvedMessage", () => {
  test("formats resolved message", () => {
    const msg = formatResolvedMessage("process", "Process agent is dead");
    expect(msg).toContain("[RESOLVED]");
    expect(msg).toContain("Process agent is dead");
    expect(msg).toContain("returned to normal");
  });
});

describe("formatBatchAlert", () => {
  test("returns empty string for empty array", () => {
    expect(formatBatchAlert([])).toBe("");
  });

  test("uses single format for one result", () => {
    const results: CheckResult[] = [
      {
        category: "disk",
        level: "warning",
        title: "Disk usage at 92%",
        detail: "Root partition is 92% full",
        metric: 92,
        threshold: 90,
      },
    ];
    const msg = formatBatchAlert(results);
    expect(msg).toContain("[WARNING]");
    expect(msg).not.toContain("[MONITOR]");
  });

  test("uses batch format for multiple results", () => {
    const results: CheckResult[] = [
      {
        category: "process",
        level: "critical",
        title: "Process agent is dead",
        detail: "No heartbeat for 185s",
      },
      {
        category: "disk",
        level: "warning",
        title: "Disk usage at 92%",
        detail: "Root partition is 92% full",
      },
      {
        category: "memory",
        level: "warning",
        title: "Memory usage at 91%",
        detail: "7300MB / 8000MB used",
      },
    ];
    const msg = formatBatchAlert(results);
    expect(msg).toContain("[MONITOR] 3 issues detected");
    expect(msg).toContain("[CRITICAL] Process agent is dead");
    expect(msg).toContain("[WARNING] Disk usage at 92%");
    expect(msg).toContain("[WARNING] Memory usage at 91%");
    expect(msg).toContain("--- Process agent is dead ---");
  });
});
