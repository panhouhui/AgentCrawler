/**
 * Context pruning for OpenAI/OpenRouter message format.
 * Progressively trims old tool result messages to keep context within budget.
 *
 * Phase 1 (soft trim): When context > softTrimRatio, head-trim large tool messages.
 * Phase 2 (hard clear): When > hardClearRatio, replace them entirely.
 *
 * Mirrors context-pruning.ts logic adapted for OpenAI-format messages.
 */

import type { OpenAIMessage } from "./types";

export interface PruningConfig {
  /** Protect the last N tool-result turns from pruning */
  readonly keepRecentTurns: number;
  /** Start soft-trimming at this ratio of context window */
  readonly softTrimRatio: number;
  /** Start hard-clearing at this ratio */
  readonly hardClearRatio: number;
  /** Soft trim settings */
  readonly softTrim: {
    /** Don't trim results shorter than this */
    readonly maxChars: number;
    /** Keep this many chars from start */
    readonly headChars: number;
  };
}

export const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  keepRecentTurns: 3,
  softTrimRatio: 0.3,
  hardClearRatio: 0.5,
  softTrim: {
    maxChars: 4_000,
    headChars: 1_500,
  },
};

const CHARS_PER_TOKEN = 4;

function estimateMessageChars(messages: readonly OpenAIMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          total += part.text.length;
        } else if (part.type === "image_url") {
          // Data URIs can be large — count the base64 payload length
          total += part.image_url.url.length;
        }
      }
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += tc.function.arguments.length;
        total += tc.function.name.length;
      }
    }
  }
  return total;
}

function findToolMessageIndexes(messages: readonly OpenAIMessage[]): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "tool") {
      indexes.push(i);
    }
  }
  return indexes;
}

function softTrimContent(
  content: string,
  config: PruningConfig["softTrim"],
): string {
  if (content.length <= config.maxChars) return content;
  const head = content.slice(0, config.headChars);
  const trimmedLen = content.length - config.headChars;
  return `${head}\n[... ${trimmedLen} chars trimmed ...]`;
}

function pruneToolMessage(
  msg: OpenAIMessage,
  mode: "soft" | "hard",
  config: PruningConfig,
): OpenAIMessage {
  const originalContent = typeof msg.content === "string" ? msg.content : "";

  if (mode === "hard") {
    return {
      ...msg,
      content: `[Tool result cleared — ${originalContent.length} chars]`,
    };
  }

  return {
    ...msg,
    content: softTrimContent(originalContent, config.softTrim),
  };
}

/**
 * Prune tool result messages based on context usage.
 * Returns a new message array (never mutates input).
 */
export function pruneToolResultsOpenAI(
  messages: readonly OpenAIMessage[],
  contextWindowTokens: number,
  config?: PruningConfig,
): OpenAIMessage[] {
  const cfg = config ?? DEFAULT_PRUNING_CONFIG;

  const totalChars = estimateMessageChars(messages);
  const contextWindowChars = contextWindowTokens * CHARS_PER_TOKEN;
  const usageRatio = totalChars / contextWindowChars;

  if (usageRatio < cfg.softTrimRatio) return [...messages];

  const toolIndexes = findToolMessageIndexes(messages);
  if (toolIndexes.length === 0) return [...messages];

  const prunableIndexes = new Set(toolIndexes.slice(0, -cfg.keepRecentTurns));
  if (prunableIndexes.size === 0) return [...messages];

  const mode = usageRatio >= cfg.hardClearRatio ? "hard" : "soft";

  return messages.map((msg, idx) => {
    if (!prunableIndexes.has(idx)) return msg;
    return pruneToolMessage(msg, mode, cfg);
  });
}
