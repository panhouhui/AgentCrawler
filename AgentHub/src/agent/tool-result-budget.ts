/**
 * Dynamic tool result budget based on context window size.
 * Prevents a single large tool result from consuming too much context.
 *
 * Adapted from OpenClaw's tool-result-context-guard.ts
 */

/**
 * Chars per token for tool results.
 * Tool results (code, paths, CLI output) tend to be denser than prose,
 * so we use a conservative 4 chars/token matching the project-wide estimate.
 */
const TOOL_RESULT_CHARS_PER_TOKEN = 4;

/** Reserve 50% of context for framing, system prompt, history, etc. */
const CONTEXT_HEADROOM = 0.5;

/** A single tool result should not exceed 15% of input context */
const SINGLE_RESULT_SHARE = 0.15;

/** Hard cap per result — prevents any single result from dominating context */
const HARD_CAP_CHARS = 20_000;

export interface ToolResultBudget {
  /** Max chars for any single tool result */
  readonly maxSingleResultChars: number;
}

export function computeToolResultBudget(
  contextWindowTokens: number,
): ToolResultBudget {
  const inputBudgetTokens = contextWindowTokens * CONTEXT_HEADROOM;
  const singleResultTokens = inputBudgetTokens * SINGLE_RESULT_SHARE;
  const singleResultChars = Math.floor(
    singleResultTokens * TOOL_RESULT_CHARS_PER_TOKEN,
  );

  return {
    maxSingleResultChars: Math.max(
      4_096,
      Math.min(singleResultChars, HARD_CAP_CHARS),
    ),
  };
}

export function truncateToolResult(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;

  // Head-only truncation to avoid exposing secrets from tail
  const suffix = `\n\n[... ${output.length} chars total, truncated ...]`;
  const headChars = Math.max(0, maxChars - suffix.length);
  const head = output.slice(0, headChars);
  return `${head}${suffix}`;
}
