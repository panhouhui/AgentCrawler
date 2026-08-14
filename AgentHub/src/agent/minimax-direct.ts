import type { AgentOptions, AgentResponse, ConversationMessage } from "./types";
import { retryAsync } from "../infra/retry";
import { createLogger } from "../logger";

const log = createLogger("minimax-direct");

const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io/anthropic";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export function resolveMiniMaxMessagesEndpoint(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_MINIMAX_BASE_URL).replace(/\/+$/, "");
  if (raw.endsWith("/v1/messages")) return raw;
  if (raw.endsWith("/v1")) return `${raw}/messages`;
  return `${raw}/v1/messages`;
}

async function getCredentials(): Promise<{ apiKey: string; messagesUrl: string }> {
  const { getSecret } = await import("../config/secrets");
  const apiKey =
    (await getSecret("MINIMAX_API_KEY")) ??
    (await getSecret("MINIMAX_INTL_API_KEY"));
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY or MINIMAX_INTL_API_KEY is not set");
  }

  const messagesUrl = resolveMiniMaxMessagesEndpoint(
    await getSecret("MINIMAX_BASE_URL"),
  );
  return { apiKey, messagesUrl };
}

interface MiniMaxMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

interface MiniMaxTextBlock {
  readonly type: "text";
  readonly text: string;
}

interface MiniMaxResponse {
  readonly content?: readonly MiniMaxTextBlock[];
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
  readonly error?: {
    readonly message?: string;
    readonly type?: string;
  };
}

function toMiniMaxMessages(
  messages: readonly ConversationMessage[],
): MiniMaxMessage[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout")
  );
}

async function callMiniMax(
  messagesUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<MiniMaxResponse> {
  const res = await fetch(messagesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  const text = await res.text();
  let parsed: MiniMaxResponse | undefined;
  try {
    parsed = text ? (JSON.parse(text) as MiniMaxResponse) : undefined;
  } catch {
    // Keep raw text below.
  }

  if (!res.ok) {
    const detail = parsed?.error?.message ?? text;
    throw new Error(`MiniMax API error (${res.status}): ${detail}`);
  }

  if (!parsed) {
    throw new Error("MiniMax API returned an empty or non-JSON response");
  }

  return parsed;
}

export async function chat(
  messages: readonly ConversationMessage[],
  options: AgentOptions,
): Promise<AgentResponse> {
  log.debug("Sending message to MiniMax", {
    model: options.model,
    messageCount: messages.length,
  });

  const { apiKey, messagesUrl } = await getCredentials();
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: options.maxOutputTokens ?? 8192,
    system: options.systemPrompt,
    messages: toMiniMaxMessages(messages),
  };

  try {
    const response = await retryAsync(
      () => callMiniMax(messagesUrl, apiKey, body, options.abortSignal),
      {
        label: "minimax.chat",
        shouldRetry: isRetryable,
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      },
    );

    const text = (response.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (!text) {
      throw new Error("MiniMax response contained no text blocks");
    }

    log.info("MiniMax response received", {
      model: options.model,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });

    return {
      text,
      provider: "minimax",
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens ?? 0,
            outputTokens: response.usage.output_tokens ?? 0,
          }
        : undefined,
    };
  } catch (error) {
    log.error("MiniMax API error", { error });
    throw new Error(
      `MiniMax API error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
