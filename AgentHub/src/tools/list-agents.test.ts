import { describe, it, expect } from "bun:test";
import { createListAgentsTool } from "./list-agents";
import type { AgentRegistry } from "../agents/registry";
import type { ResolvedAgent } from "../agents/types";

function makeMockAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    id: "test-agent",
    name: "Test Agent",
    description: "A test agent",
    default: false,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a test agent.",
    ...overrides,
  } as ResolvedAgent;
}

function makeMockRegistry(
  agents: ResolvedAgent[] = [],
): AgentRegistry {
  return {
    agents,
    getDefault: () => agents[0]!,
    getById: (id: string) => agents.find((a) => a.id === id),
    listIds: () => agents.map((a) => a.id),
    listForAgent: (_requestingId: string) => agents,
    reload: () => {},
  };
}

describe("createListAgentsTool", () => {
  describe("tool definition", () => {
    it("should have the correct name", () => {
      const registry = makeMockRegistry();
      const tool = createListAgentsTool(registry, "main");
      expect(tool.name).toBe("list_agents");
    });

    it("should have a description", () => {
      const registry = makeMockRegistry();
      const tool = createListAgentsTool(registry, "main");
      expect(tool.description).toBeTruthy();
      expect(tool.description).toContain("agent");
    });

    it("should have system category", () => {
      const registry = makeMockRegistry();
      const tool = createListAgentsTool(registry, "main");
      expect(tool.categories).toEqual(["system"]);
    });

    it("should have an empty inputSchema (no required inputs)", () => {
      const registry = makeMockRegistry();
      const tool = createListAgentsTool(registry, "main");
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.required).toEqual([]);
    });

    it("should have an execute function", () => {
      const registry = makeMockRegistry();
      const tool = createListAgentsTool(registry, "main");
      expect(typeof tool.execute).toBe("function");
    });
  });

  describe("execute", () => {
    it("should return 'no agents' message when registry is empty", async () => {
      const registry = makeMockRegistry([]);
      const tool = createListAgentsTool(registry, "main");
      const result = await tool.execute({});
      expect(result.isError).toBe(false);
      expect(result.output).toBe("No agents available for spawning.");
    });

    it("should return JSON list of agents when agents exist", async () => {
      const agents = [
        makeMockAgent({ id: "agent-1", name: "Agent One", description: "First agent", model: "claude-sonnet-4-6" }),
        makeMockAgent({ id: "agent-2", name: "Agent Two", description: "Second agent", model: "claude-opus-4-6" }),
      ];
      const registry = makeMockRegistry(agents);
      const tool = createListAgentsTool(registry, "main");
      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("agent-1");
      expect(parsed[0].name).toBe("Agent One");
      expect(parsed[0].description).toBe("First agent");
      expect(parsed[0].model).toBe("claude-sonnet-4-6");
    });

    it("should only include id, name, description, and model fields", async () => {
      const agents = [
        makeMockAgent({
          id: "agent-x",
          name: "Agent X",
          description: "Desc",
          model: "claude-sonnet-4-6",
          systemPrompt: "secret system prompt",
        }),
      ];
      const registry = makeMockRegistry(agents);
      const tool = createListAgentsTool(registry, "main");
      const result = await tool.execute({});

      const parsed = JSON.parse(result.output);
      expect(parsed[0]).toEqual({
        id: "agent-x",
        name: "Agent X",
        description: "Desc",
        model: "claude-sonnet-4-6",
      });
      // Should NOT leak systemPrompt or other internal fields
      expect(parsed[0].systemPrompt).toBeUndefined();
      expect(parsed[0].provider).toBeUndefined();
    });

    it("should return pretty-printed JSON", async () => {
      const agents = [makeMockAgent({ id: "a1" })];
      const registry = makeMockRegistry(agents);
      const tool = createListAgentsTool(registry, "main");
      const result = await tool.execute({});

      // Pretty-printed JSON has newlines and indentation
      expect(result.output).toContain("\n");
      expect(result.output).toContain("  ");
    });
  });
});
