import { describe, it, expect } from "bun:test";
import { createDigestTool } from "./digest-factory";
import type { DigestToolConfig } from "./digest-factory";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeItem {
  title: string;
  score: number;
}

function makeConfig(
  overrides: Partial<DigestToolConfig<FakeItem>> = {},
): DigestToolConfig<FakeItem> {
  return {
    name: "test_digest",
    description: "A test digest tool.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results." },
      },
      required: [],
    },
    fetchFn: async (_input, _limit) => [],
    formatFn: (item, i) => `${i + 1}. ${item.title} (${item.score})`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createDigestTool", () => {
  // -- Tool definition tests ------------------------------------------------

  it("should have correct name from config", () => {
    const tool = createDigestTool(makeConfig({ name: "get_news_digest" }));
    expect(tool.name).toBe("get_news_digest");
  });

  it("should have correct description from config", () => {
    const tool = createDigestTool(
      makeConfig({ description: "Get recent news digest." }),
    );
    expect(tool.description).toBe("Get recent news digest.");
  });

  it('should have "research" category', () => {
    const tool = createDigestTool(makeConfig());
    expect(tool.categories).toContain("research");
  });

  it("should use the provided inputSchema directly", () => {
    const customSchema = {
      type: "object",
      properties: {
        limit: { type: "number" },
        source: { type: "string", enum: ["a", "b"] },
      },
      required: ["source"],
    };
    const tool = createDigestTool(makeConfig({ inputSchema: customSchema }));
    expect(tool.inputSchema).toBe(customSchema);
  });

  it("should have an execute function", () => {
    const tool = createDigestTool(makeConfig());
    expect(typeof tool.execute).toBe("function");
  });

  // -- Execute: empty results -----------------------------------------------

  it("should return default empty message when no results", async () => {
    const tool = createDigestTool(
      makeConfig({ fetchFn: async () => [] }),
    );
    const result = await tool.execute({});
    expect(result.isError).toBe(false);
    expect(result.output).toBe("No results found.");
  });

  it("should return custom empty message when configured", async () => {
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async () => [],
        emptyMessage: "Nothing to show.",
      }),
    );
    const result = await tool.execute({});
    expect(result.isError).toBe(false);
    expect(result.output).toBe("Nothing to show.");
  });

  // -- Execute: successful results ------------------------------------------

  it("should format results with default header", async () => {
    const items: FakeItem[] = [
      { title: "Alpha", score: 10 },
      { title: "Beta", score: 20 },
    ];
    const tool = createDigestTool(
      makeConfig({
        name: "my_digest",
        fetchFn: async () => items,
      }),
    );
    const result = await tool.execute({});
    expect(result.isError).toBe(false);
    expect(result.output).toContain("my_digest (2 results):");
    expect(result.output).toContain("1. Alpha (10)");
    expect(result.output).toContain("2. Beta (20)");
  });

  it("should use custom headerFn when provided", async () => {
    const items: FakeItem[] = [{ title: "One", score: 1 }];
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async () => items,
        headerFn: (results) => `Custom header with ${results.length} items:\n`,
      }),
    );
    const result = await tool.execute({});
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Custom header with 1 items:");
    expect(result.output).toContain("1. One (1)");
  });

  it("should respect the limit parameter passed to fetchFn", async () => {
    let capturedLimit = 0;
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async (_input, limit) => {
          capturedLimit = limit;
          return [];
        },
        defaultLimit: 30,
      }),
    );
    await tool.execute({ limit: 5 });
    expect(capturedLimit).toBe(5);
  });

  it("should clamp limit to maxLimit", async () => {
    let capturedLimit = 0;
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async (_input, limit) => {
          capturedLimit = limit;
          return [];
        },
        maxLimit: 10,
      }),
    );
    await tool.execute({ limit: 999 });
    expect(capturedLimit).toBe(10);
  });

  it("should use defaultLimit when no limit provided", async () => {
    let capturedLimit = 0;
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async (_input, limit) => {
          capturedLimit = limit;
          return [];
        },
        defaultLimit: 25,
      }),
    );
    await tool.execute({});
    expect(capturedLimit).toBe(25);
  });

  // -- Execute: error handling ----------------------------------------------

  it("should handle fetchFn errors gracefully", async () => {
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async () => {
          throw new Error("DB connection failed");
        },
      }),
    );
    const result = await tool.execute({});
    expect(result.isError).toBe(true);
    expect(result.output).toContain("DB connection failed");
  });

  it("should use custom errorPrefix when configured", async () => {
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async () => {
          throw new Error("timeout");
        },
        errorPrefix: "Failed to get HN digest",
      }),
    );
    const result = await tool.execute({});
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Failed to get HN digest");
    expect(result.output).toContain("timeout");
  });

  it("should handle non-Error exceptions", async () => {
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async () => {
          throw "string error";
        },
      }),
    );
    const result = await tool.execute({});
    expect(result.isError).toBe(true);
    expect(result.output).toContain("string error");
  });

  // -- Defaults -------------------------------------------------------------

  it("should default to limit 30 and max 50 when not configured", async () => {
    let capturedLimit = 0;
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async (_input, limit) => {
          capturedLimit = limit;
          return [];
        },
        // omit defaultLimit and maxLimit
      }),
    );
    // No limit in input => use defaultLimit (30)
    await tool.execute({});
    expect(capturedLimit).toBe(30);

    // limit above max 50 => clamped
    await tool.execute({ limit: 100 });
    expect(capturedLimit).toBe(50);
  });

  it("should pass raw input to fetchFn for extra filters", async () => {
    let capturedInput: Record<string, unknown> = {};
    const tool = createDigestTool(
      makeConfig({
        fetchFn: async (input, _limit) => {
          capturedInput = input;
          return [];
        },
      }),
    );
    await tool.execute({ limit: 5, source: "reuters" });
    expect(capturedInput.source).toBe("reuters");
  });
});
