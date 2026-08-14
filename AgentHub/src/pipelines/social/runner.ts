import type { AgentRegistry } from "../../agents/registry";
import { chat } from "../../agent/chat";
import { getModelRoute, type ModelRoutingKey } from "../../store/model-routing";
import type { SocialAgentRunner } from "./types";

export function createRouteBackedSocialAgentRunner(
  agentRegistry: AgentRegistry,
  options: {
    readonly abortSignal?: AbortSignal;
    readonly callTimeoutMs?: number;
  } = {},
): SocialAgentRunner {
  return {
    async run(input: {
      readonly agentId: string;
      readonly task: string;
      readonly routeKey: ModelRoutingKey;
    }): Promise<string> {
      const agent = agentRegistry.getById(input.agentId);
      if (!agent) {
        throw new Error(`Social agent not found: ${input.agentId}`);
      }

      const route = await getModelRoute(input.routeKey);
      const response = await chat(
        [{ role: "user", content: input.task, timestamp: Math.floor(Date.now() / 1000) }],
        {
          systemPrompt: agent.systemPrompt,
          agentId: agent.id,
          model: route.model,
          provider: route.provider,
          maxOutputTokens: agent.maxOutputTokens,
          reasoning: agent.reasoning,
          toolsEnabled: false,
          rawSystemPrompt: true,
          abortSignal: options.abortSignal,
          callTimeoutMs: options.callTimeoutMs,
          usageContext: {
            channel: "pipeline",
            chatId: "social",
            source: "workflow",
          },
        },
      );

      return response.text;
    },
  };
}
