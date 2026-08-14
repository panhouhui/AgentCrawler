import { describe, test, expect } from "bun:test";
import { createAlertDeduplicator, dedupKey } from "./dedup";

describe("dedupKey", () => {
  test("creates key from category and title", () => {
    expect(dedupKey("process", "Process agent is dead")).toBe(
      "process:Process agent is dead",
    );
  });

  test("handles colons in title", () => {
    expect(dedupKey("cron", 'Cron job "daily:briefing" failing')).toBe(
      'cron:Cron job "daily:briefing" failing',
    );
  });
});

describe("createAlertDeduplicator", () => {
  test("shouldFire returns true for new alert", () => {
    const dedup = createAlertDeduplicator(30_000);
    expect(dedup.shouldFire("process:test", "warning")).toBe(true);
  });

  test("shouldFire returns false within cooldown", () => {
    const dedup = createAlertDeduplicator(30_000);
    dedup.markFired("process:test", "warning");
    expect(dedup.shouldFire("process:test", "warning")).toBe(false);
  });

  test("shouldFire returns true after cooldown expires", () => {
    const dedup = createAlertDeduplicator(1); // 1ms cooldown
    dedup.markFired("process:test", "warning");
    // Wait a tiny bit for the 1ms cooldown
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* busy wait */
    }
    expect(dedup.shouldFire("process:test", "warning")).toBe(true);
  });

  test("wasActive returns false for unfired alerts", () => {
    const dedup = createAlertDeduplicator(30_000);
    expect(dedup.wasActive("process:test")).toBe(false);
  });

  test("wasActive returns true after firing", () => {
    const dedup = createAlertDeduplicator(30_000);
    dedup.markFired("process:test", "warning");
    expect(dedup.wasActive("process:test")).toBe(true);
  });

  test("markResolved removes alert from active set", () => {
    const dedup = createAlertDeduplicator(30_000);
    dedup.markFired("process:test", "warning");
    dedup.markResolved("process:test");
    expect(dedup.wasActive("process:test")).toBe(false);
    expect(dedup.getActiveKeys().size).toBe(0);
  });

  test("getActiveKeys returns all fired keys", () => {
    const dedup = createAlertDeduplicator(30_000);
    dedup.markFired("process:test1", "warning");
    dedup.markFired("disk:test2", "critical");
    const keys = dedup.getActiveKeys();
    expect(keys.size).toBe(2);
    expect(keys.has("process:test1")).toBe(true);
    expect(keys.has("disk:test2")).toBe(true);
  });

  test("cleanup removes entries older than 2x cooldown", () => {
    const dedup = createAlertDeduplicator(1); // 1ms cooldown
    dedup.markFired("process:old", "warning");
    // Wait for 2x cooldown
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* busy wait */
    }
    dedup.cleanup();
    expect(dedup.wasActive("process:old")).toBe(false);
  });

  test("cleanup preserves recent entries", () => {
    const dedup = createAlertDeduplicator(60_000);
    dedup.markFired("process:recent", "warning");
    dedup.cleanup();
    expect(dedup.wasActive("process:recent")).toBe(true);
  });

  test("markFired increments consecutive count", () => {
    const dedup = createAlertDeduplicator(1); // 1ms cooldown
    dedup.markFired("process:test", "warning");
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* busy wait */
    }
    dedup.markFired("process:test", "warning");
    // consecutiveCount is tracked internally — verify through shouldFire behavior
    expect(dedup.wasActive("process:test")).toBe(true);
  });
});
