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

  test("retries when the upstream socket closes unexpectedly", async () => {
    let attempts = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error(
          "The socket connection was closed unexpectedly. For more information, pass verbose: true in the second argument to fetch()",
        );
      }
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "recovered" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const result = await chat(
      [{ role: "user", content: "hi", timestamp: 0 }],
      baseOptions(),
    );

    expect(result.text).toBe("recovered");
    expect(attempts).toBe(2);
  });

  test("stops after three attempts for repeated socket failures", async () => {
    let attempts = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      attempts += 1;
      throw new Error("The socket connection was closed unexpectedly.");
    }) as typeof globalThis.fetch;

    await expect(chat([], baseOptions())).rejects.toThrow("socket connection was closed");
    expect(attempts).toBe(3);
  });

  test("does not retry authentication failures", async () => {
    let attempts = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      attempts += 1;
      return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 });
    }) as typeof globalThis.fetch;

    await expect(chat([], baseOptions())).rejects.toThrow("401");
    expect(attempts).toBe(1);
  });

  test("cancellation interrupts retry backoff", async () => {
    let attempts = 0;
    const controller = new AbortController();
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      attempts += 1;
      setTimeout(() => controller.abort(), 10);
      throw new Error("The socket connection was closed unexpectedly.");
    }) as typeof globalThis.fetch;

    await expect(chat([], baseOptions({ abortSignal: controller.signal }))).rejects.toThrow("aborted");
    expect(attempts).toBe(1);
  });
});
