import { test, expect } from "bun:test";

// Re-implemented from Cron.tsx (module-private pure functions)

function formatSchedule(s: {
  kind: string;
  at?: string;
  everyMs?: number;
  expr?: string;
  tz?: string;
}): string {
  if (s.kind === "at") return `Once at ${s.at ?? "unknown"}`;
  if (s.kind === "every") {
    const sec = Math.floor((s.everyMs ?? 0) / 1000);
    if (sec < 60) return `Every ${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `Every ${min}m`;
    return `Every ${Math.floor(min / 60)}h`;
  }
  if (s.kind === "cron") return `${s.expr ?? ""}${s.tz ? ` (${s.tz})` : ""}`;
  return "Unknown";
}

const PROGRESS_ICON: Record<string, string> = {
  thinking: "thought",
  tool_start: "tool",
  tool_done: "result",
  iteration: "step",
  subagent_start: "agent",
  subagent_done: "done",
};

/* ---------- formatSchedule ---------- */

test("formatSchedule formats 'at' schedule", () => {
  expect(formatSchedule({ kind: "at", at: "2024-03-15T10:00" })).toBe(
    "Once at 2024-03-15T10:00",
  );
});

test("formatSchedule formats 'at' with no date", () => {
  expect(formatSchedule({ kind: "at" })).toBe("Once at unknown");
});

test("formatSchedule formats 'every' in seconds", () => {
  expect(formatSchedule({ kind: "every", everyMs: 30_000 })).toBe("Every 30s");
});

test("formatSchedule formats 'every' in minutes", () => {
  expect(formatSchedule({ kind: "every", everyMs: 300_000 })).toBe("Every 5m");
});

test("formatSchedule formats 'every' in hours", () => {
  expect(formatSchedule({ kind: "every", everyMs: 3_600_000 })).toBe("Every 1h");
  expect(formatSchedule({ kind: "every", everyMs: 7_200_000 })).toBe("Every 2h");
});

test("formatSchedule formats 'every' with 0ms", () => {
  expect(formatSchedule({ kind: "every", everyMs: 0 })).toBe("Every 0s");
});

test("formatSchedule formats cron expression", () => {
  expect(formatSchedule({ kind: "cron", expr: "0 * * * *" })).toBe(
    "0 * * * *",
  );
});

test("formatSchedule formats cron with timezone", () => {
  expect(
    formatSchedule({
      kind: "cron",
      expr: "0 9 * * *",
      tz: "America/New_York",
    }),
  ).toBe("0 9 * * * (America/New_York)");
});

test("formatSchedule returns Unknown for unknown kind", () => {
  expect(formatSchedule({ kind: "custom" })).toBe("Unknown");
});

/* ---------- PROGRESS_ICON ---------- */

test("PROGRESS_ICON maps known types", () => {
  expect(PROGRESS_ICON["thinking"]).toBe("thought");
  expect(PROGRESS_ICON["tool_start"]).toBe("tool");
  expect(PROGRESS_ICON["tool_done"]).toBe("result");
  expect(PROGRESS_ICON["iteration"]).toBe("step");
  expect(PROGRESS_ICON["subagent_start"]).toBe("agent");
  expect(PROGRESS_ICON["subagent_done"]).toBe("done");
});

test("PROGRESS_ICON returns undefined for unknown type", () => {
  expect(PROGRESS_ICON["unknown"]).toBeUndefined();
});
