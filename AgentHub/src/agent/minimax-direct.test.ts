import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chat, resolveMiniMaxMessagesEndpoint } from "./minimax-direct";
import type { AgentOptions } from "./types";

const realFetch = globalThis.fetch;
const realApiKey = process.env.MINIMAX_API_KEY;
const realIntlApiKey = process.env.MINIMAX_INTL_API_KEY;
const realBaseUrl = process.env.MINIMAX_BASE_URL;

let capturedUrl = "";
let capturedBody: Record<string, unknown> | undefined;
let capturedHeaders: Record<string, string> | undefined;

function stubFetch(): void {
  capturedUrl = "";
  capturedBody = undefined;
  capturedHeaders = undefined;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedHeaders = init?.headers as Record<string, string> | undefined;
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
}

function baseOptions(overrides: Partial<AgentOptions> = {}): AgentOptions {
  return {
    systemPrompt: "system",
    model: "MiniMax-M2.7",
    ...overrides,
  };
}

describe("minimax-direct", () => {
  beforeEach(() => {
    process.env.MINIMAX_INTL_API_KEY = "test-minimax-key";
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_BASE_URL;
    stubFetch();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realApiKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = realApiKey;
    if (realIntlApiKey === undefined) delete process.env.MINIMAX_INTL_API_KEY;
    else process.env.MINIMAX_INTL_API_KEY = realIntlApiKey;
    if (realBaseUrl === undefined) delete process.env.MINIMAX_BASE_URL;
    else process.env.MINIMAX_BASE_URL = realBaseUrl;
  });

  test("normalizes Anthropic-compatible messages endpoint", () => {
    expect(resolveMiniMaxMessagesEndpoint()).toBe(
      "https://api.minimax.io/anthropic/v1/messages",
    );
    expect(resolveMiniMaxMessagesEndpoint("https://api.minimax.io/anthropic/v1")).toBe(
      "https://api.minimax.io/anthropic/v1/messages",
    );
  });

  test("sends Anthropic messages payload with bearer auth", async () => {
    const result = await chat(
      [{ role: "user", content: "hi", timestamp: 0 }],
      baseOptions(),
    );

    expect(result.text).toBe("ok");
    expect(result.provider).toBe("minimax");
    expect(capturedUrl).toBe("https://api.minimax.io/anthropic/v1/messages");
    expect(capturedHeaders?.Authorization).toBe("Bearer test-minimax-key");
    expect(capturedHeaders?.["anthropic-version"]).toBe("2023-06-01");
    expect(capturedBody?.model).toBe("MiniMax-M2.7");
    expect(capturedBody?.system).toBe("system");
  });
});
