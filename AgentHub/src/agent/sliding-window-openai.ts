/**
 * Sliding window for agentic loop messages (OpenAI/OpenRouter format).
 * Compresses old iterations to reduce token usage while preserving
 * recent context and tool_calls/tool pairing.
 *
 * OpenAI iteration structure (variable length):
 *   1. assistant message with tool_calls array
 *   2. N separate { role: "tool" } messages (one per tool call)
 *
 * Old iterations have reasoning stripped and tool results summarized.
 * Recent iterations are kept in full for the model's working memory.
 */

import type { OpenAIMessage } from "./types";

export interface SlidingWindowConfig {
  /** Keep the last N iterations fully intact (default 4) */
  readonly keepRecentIterations: number;
}

export const DEFAULT_SLIDING_WINDOW_CONFIG: SlidingWindowConfig = {
  keepRecentIterations: 3,
};

interface Iteration {
  readonly startIndex: number;
  readonly length: number; // 1 assistant + N tool messages
}

/**
 * Detect iteration boundaries in loop messages.
 * An iteration = 1 assistant message with tool_calls + consecutive tool messages.
 */
function detectIterations(messages: readonly OpenAIMessage[]): Iteration[] {
  const iterations: Iteration[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i]!;
    if (
      msg.role === "assistant" &&
      msg.tool_calls &&
      msg.tool_calls.length > 0
    ) {
      let toolCount = 0;
      let j = i + 1;
      while (j < messages.length && messages[j]!.role === "tool") {
        toolCount++;
        j++;
      }
      iterations.push({ startIndex: i, length: 1 + toolCount });
      i = j;
    } else {
      i++;
    }
  }

  return iterations;
}

function summarizeAssistantMessage(msg: OpenAIMessage): OpenAIMessage {
  const toolNames =
    msg.tool_calls?.map((tc) => tc.function.name).join(", ") ?? "";
  return {
    ...msg,
    content: `[Called: ${toolNames}]`,
    // tool_calls must remain intact for API pairing
  };
}

function summarizeToolMessage(msg: OpenAIMessage): OpenAIMessage {
  const originalLength =
    typeof msg.content === "string" ? msg.content.length : 0;
  return {
    ...msg,
    content: `[${originalLength} chars]`,
  };
}



/**
 * Compress old iterations in the agentic loop to reduce token usage.
 * Pre-loop messages are never touched. Recent iterations are kept in full.
 * Old iterations have assistant reasoning stripped and tool results summarized.
 *
 * @param messages - Full message array (pre-loop + loop iterations)
 * @param preLoopCount - Number of messages before the loop started
 * @param config - Sliding window configuration
 */
export function compressOldIterationsOpenAI(
  messages: readonly OpenAIMessage[],
  preLoopCount: number,
  config?: SlidingWindowConfig,
): OpenAIMessage[] {
  const keepRecentIterations = config?.keepRecentIterations ?? 4;
  const preLoop = messages.slice(0, preLoopCount);
  const loopMessages = messages.slice(preLoopCount);

  const iterations = detectIterations(loopMessages);

  if (iterations.length <= keepRecentIterations) {
    return [...messages];
  }

  const firstRecentIteration =
    iterations[iterations.length - keepRecentIterations]!;
  const recentStartIndex = firstRecentIteration.startIndex;

  // Compress old iteration messages
  const oldMessages = loopMessages.slice(0, recentStartIndex);
  const compressed = oldMessages.map((msg) => {
    if (
      msg.role === "assistant" &&
      msg.tool_calls &&
      msg.tool_calls.length > 0
    ) {
      return summarizeAssistantMessage(msg);
    }
    if (msg.role === "tool") {
      return summarizeToolMessage(msg);
    }
    return msg;
  });

  const recentMessages = loopMessages.slice(recentStartIndex);
  return [...preLoop, ...compressed, ...recentMessages];
}
