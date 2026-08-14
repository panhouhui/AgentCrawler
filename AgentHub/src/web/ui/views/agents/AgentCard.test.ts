import { test, expect } from "bun:test";

// Re-implemented from AgentCard.tsx (module-private logic)

interface ToolFilter {
  mode: "all" | "allowlist" | "blocklist";
  tools: string[];
}

function toolsLabel(toolFilter: ToolFilter): string {
  if (toolFilter.mode === "all") return "All tools";
  return `${toolFilter.tools.length} ${toolFilter.mode === "allowlist" ? "allowed" : "blocked"}`;
}

/* ---------- toolsLabel ---------- */

test("toolsLabel returns 'All tools' for all mode", () => {
  expect(toolsLabel({ mode: "all", tools: [] })).toBe("All tools");
});

test("toolsLabel shows count for allowlist", () => {
  expect(toolsLabel({ mode: "allowlist", tools: ["a", "b", "c"] })).toBe(
    "3 allowed",
  );
});

test("toolsLabel shows count for blocklist", () => {
  expect(toolsLabel({ mode: "blocklist", tools: ["x"] })).toBe("1 blocked");
});

test("toolsLabel shows 0 for empty allowlist", () => {
  expect(toolsLabel({ mode: "allowlist", tools: [] })).toBe("0 allowed");
});

test("toolsLabel shows 0 for empty blocklist", () => {
  expect(toolsLabel({ mode: "blocklist", tools: [] })).toBe("0 blocked");
});
