import type { ToolDefinition, ToolCategory } from "./types";
import type { AgentRegistry } from "../agents/registry";

export function createListAgentsTool(
  agentRegistry: AgentRegistry,
  currentAgentId: string,
): ToolDefinition {
  return {
    name: "list_agents",
    description:
      "List available agents that can be spawned as sub-agents. Returns their IDs, names, and specializations.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    categories: ["system"] as readonly ToolCategory[],
    async execute(): Promise<{ output: string; isError: boolean }> {
      const agents = agentRegistry.listForAgent(currentAgentId);

      if (agents.length === 0) {
        return {
          output: "No agents available for spawning.",
          isError: false,
        };
      }

      const list = agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        model: a.model,
      }));

      return {
        output: JSON.stringify(list, null, 2),
        isError: false,
      };
    },
  };
}
