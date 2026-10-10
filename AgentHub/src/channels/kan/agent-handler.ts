import type { AgentOptions, ProgressEvent } from "../../agent/types";
import type { AgentRegistry } from "../../agents/registry";
import type { ResolvedAgent } from "../../agents/types";
import type { Channel } from "../types";
import { chat } from "../../agent/chat";
import { chunkMessage } from "../../agent/chunk";
import { getSessionHistory, addUserMessage, addAssistantMessage, clearSession } from "../../agent/session";
import { createLogger } from "../../logger";
import { recordKanDelivery } from "../../store/kan-messages";
import { createGlobalRadarTool } from "../../tools/global-radar";

export function createKanAgentHandler(input: { agent: ResolvedAgent; channel: Channel; allowedUserIds: readonly string[]; allowAllUsers?: boolean; buildOptions: (agent: ResolvedAgent, onProgress?: (event: ProgressEvent) => void) => Promise<AgentOptions>; agentRegistry?: AgentRegistry }): void {
  const log = createLogger("kan:agent-handler");
  const namespace = `kan:${input.agent.id}`;
  const active = new Map<string, AbortController>();
  const radarTool = createGlobalRadarTool();
  input.channel.onMessage(async (msg) => {
    if (!input.allowAllUsers && (input.allowedUserIds.length === 0 || !input.allowedUserIds.includes(msg.senderId))) return;
    const text = msg.content.text?.trim() ?? "";
    if (!text) return;
    if (text === "/stop") { active.get(msg.chatId)?.abort(); active.delete(msg.chatId); await input.channel.sendMessage(msg.chatId, { text: "已停止当前任务。" }); return; }
    if (text === "/clear") { active.get(msg.chatId)?.abort(); active.delete(msg.chatId); await clearSession(namespace, msg.chatId); await input.channel.sendMessage(msg.chatId, { text: "已清除当前私聊会话。" }); return; }
    if (active.has(msg.chatId)) { await input.channel.sendMessage(msg.chatId, { text: "上一条消息仍在处理中，请稍候或发送 /stop。" }); return; }
    const abortController = new AbortController(); active.set(msg.chatId, abortController);
    try {
      const agent = input.agentRegistry?.getById(input.agent.id) ?? input.agent;
      await addUserMessage(namespace, msg.chatId, msg.senderId, text, msg.senderName);
      const history = await getSessionHistory(namespace, msg.chatId);
      const opts = await input.buildOptions(agent);
      const radar = await radarTool.execute({ mode: "overview", query: text, limit: 10 });
      const radarContext = radar.isError
        ? "Local radar data is temporarily unavailable. State that clearly and do not invent current events."
        : `Read-only context retrieved from the local radar database:
${radar.output}`;
      const response = await chat(history, {
        ...opts,
        provider: "minimax",
        model: process.env.KAN_DM_MODEL || "MiniMax-M2.7",
        toolsEnabled: false,
        toolRegistry: undefined,
        systemPrompt: `${opts.systemPrompt}

${radarContext}`,
        abortSignal: abortController.signal,
      });
      if (abortController.signal.aborted) return;
      const reply = response.text.trim() || "暂无可返回的结果。";
      await addAssistantMessage(namespace, msg.chatId, reply);
      for (const part of chunkMessage(reply)) {
        const messageId = await input.channel.sendMessage(msg.chatId, { text: part });
        await recordKanDelivery({ destinationType: "direct", destinationId: msg.chatId, userId: msg.senderId, messageId: typeof messageId === "string" ? messageId : undefined, message: part, status: "sent" });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const reply = "本地模型调用失败，请稍后重试。";
      await addAssistantMessage(namespace, msg.chatId, reply).catch(() => undefined);
      await input.channel.sendMessage(msg.chatId, { text: reply }).catch(() => undefined);
      await recordKanDelivery({ destinationType: "direct", destinationId: msg.chatId, userId: msg.senderId, message: reply, status: "failed", error: detail }).catch(() => undefined);
      log.error("KAN private chat failed", { error: detail });
    } finally { active.delete(msg.chatId); }
  });
}
