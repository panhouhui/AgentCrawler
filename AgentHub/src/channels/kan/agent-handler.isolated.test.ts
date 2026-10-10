import { beforeEach, expect, mock, test } from "bun:test";
import type { Channel, MessageHandler } from "../types";
import type { ResolvedAgent } from "../../agents/types";

let modelError: Error | undefined;
const saved: string[] = [];
const sent: string[] = [];
const deliveries: Record<string, unknown>[] = [];
const logs: unknown[] = [];

mock.module("../../agent/chat", () => ({
  chat: async () => {
    if (modelError) throw modelError;
    return { text: "normal response", provider: "minimax" };
  },
}));
mock.module("../../agent/session", () => ({
  getSessionHistory: async () => [],
  addUserMessage: async () => {},
  addAssistantMessage: async (_namespace: string, _chatId: string, text: string) => { saved.push(text); },
  clearSession: async () => {},
}));
mock.module("../../store/kan-messages", () => ({
  recordKanDelivery: async (data: Record<string, unknown>) => { deliveries.push(data); },
}));
mock.module("../../tools/global-radar", () => ({
  createGlobalRadarTool: () => ({ execute: async () => ({ output: "local data", isError: false }) }),
}));
mock.module("../../logger", () => ({
  createLogger: () => ({ error: (_message: string, data: unknown) => { logs.push(data); } }),
}));

const { createKanAgentHandler } = await import("./agent-handler");

beforeEach(() => {
  modelError = undefined;
  saved.length = sent.length = deliveries.length = logs.length = 0;
});

async function receiveMessage(): Promise<void> {
  let handler: MessageHandler | undefined;
  const channel: Channel = {
    name: "kan",
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    onMessage: (next) => { handler = next; },
    sendMessage: async (_chatId, content) => { sent.push(content.text ?? ""); return "test-reply"; },
  };
  createKanAgentHandler({
    agent: { id: "social-fusion-agent" } as ResolvedAgent,
    channel,
    allowedUserIds: [],
    allowAllUsers: true,
    buildOptions: async () => ({ model: "MiniMax-M2.7", systemPrompt: "system" }),
  });
  await handler!({
    id: "test-post", channel: "kan", chatId: "test-chat", senderId: "test-user",
    content: { text: "hello" }, timestamp: 0,
  });
}

test("model failure shows a fixed message and keeps technical details in diagnostics", async () => {
  const detail = "MiniMax API error: The socket connection was closed unexpectedly. verbose: true";
  modelError = new Error(detail);
  await receiveMessage();

  expect(sent).toEqual(["本地模型调用失败，请稍后重试。"]);
  expect(saved).toEqual(sent);
  expect(deliveries[0]).toMatchObject({ message: sent[0], status: "failed", error: detail });
  expect(logs).toEqual([{ error: detail }]);
});

test("successful chat still saves and delivers the model response", async () => {
  await receiveMessage();

  expect(sent).toEqual(["normal response"]);
  expect(saved).toEqual(sent);
  expect(deliveries[0]).toMatchObject({ message: "normal response", messageId: "test-reply", status: "sent" });
  expect(logs).toEqual([]);
});
