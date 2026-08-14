import { test, expect, describe } from "bun:test";
import { computeStatus } from "./health";

describe("computeStatus", () => {
  const now = 1700000000;

  test("returns 'alive' when heartbeat is within 30s", () => {
    expect(computeStatus({ lastHeartbeat: now } as any, now)).toBe("alive");
    expect(computeStatus({ lastHeartbeat: now - 10 } as any, now)).toBe("alive");
    expect(computeStatus({ lastHeartbeat: now - 30 } as any, now)).toBe("alive");
  });

  test("returns 'stale' when heartbeat is 31-60s old", () => {
    expect(computeStatus({ lastHeartbeat: now - 31 } as any, now)).toBe("stale");
    expect(computeStatus({ lastHeartbeat: now - 45 } as any, now)).toBe("stale");
    expect(computeStatus({ lastHeartbeat: now - 60 } as any, now)).toBe("stale");
  });

  test("returns 'dead' when heartbeat is >60s old", () => {
    expect(computeStatus({ lastHeartbeat: now - 61 } as any, now)).toBe("dead");
    expect(computeStatus({ lastHeartbeat: now - 300 } as any, now)).toBe("dead");
    expect(computeStatus({ lastHeartbeat: now - 86400 } as any, now)).toBe("dead");
  });

  test("handles exact boundary at 30s", () => {
    expect(computeStatus({ lastHeartbeat: now - 30 } as any, now)).toBe("alive");
  });

  test("handles exact boundary at 60s", () => {
    expect(computeStatus({ lastHeartbeat: now - 60 } as any, now)).toBe("stale");
  });
});
