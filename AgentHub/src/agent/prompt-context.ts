/**
 * Prompt building and context enrichment utilities for the Agent SDK.
 * Handles conversation history injection and user preferences.
 */
import { createLogger } from "../logger";
import {
  getActivePreferences,
  formatPreferencesForPrompt,
} from "../memory/preference-extractor";
import type { ConversationMessage } from "./types";

const log = createLogger("prompt-context");

export const MAX_HISTORY_IN_PROMPT = 50;

/**
 * Format a single ConversationMessage into a prompt line.
 * For user messages with a senderName, the content already contains the
 * "[Name]: text" label (written by agent-handler), so we use it as-is.
 * For assistant messages we prepend "[assistant]: ".
 */
function formatMessageLine(m: ConversationMessage): string {
  if (m.role === "assistant") {
    return `[assistant]: ${m.content}`;
  }
  // User messages with senderName: content already carries "[Name]: text" label
  let line = m.senderName ? m.content : `[user]: ${m.content}`;
  if (m.imageBase64) {
    line += "\n[User attached an image]";
  }
  return line;
}

/**
 * Extract the last message content from a messages array.
 */
export function lastUserMessage(
  messages: readonly ConversationMessage[],
): string {
  if (messages.length === 0) return "";
  return messages[messages.length - 1]!.content;
}

/**
 * Build a prompt that includes recent conversation history.
 *
 * The Agent SDK's session resume is supposed to maintain context, but sessions
 * break on errors, process restarts, or expiry. By including recent history
 * in the prompt, the model retains conversational context even when the session
 * is lost. When the session IS valid, the history is redundant but harmless.
 */
export function buildPromptWithHistory(
  messages: readonly ConversationMessage[],
  maxHistory = MAX_HISTORY_IN_PROMPT,
): string {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return "";

  // Single message or empty — no history to include
  if (messages.length <= 1) return lastMsg.content;

  // Take recent history (excluding the last message)
  const historySlice = messages.slice(
    Math.max(0, messages.length - 1 - maxHistory),
    messages.length - 1,
  );

  if (historySlice.length === 0) return lastMsg.content;

  const history = historySlice
    .map((m) => formatMessageLine(m))
    .join("\n\n");

  // The last user message: if it has a senderName the content already carries
  // the "[Name]: text" label, so we use the content directly.
  const lastLine = formatMessageLine(lastMsg);

  // Add anti-repetition instruction between history and current message
  // for ongoing conversations (>8 messages with at least one assistant turn)
  let instruction = "";
  if (historySlice.length > 8) {
    const hasAssistantMessages = historySlice.some(
      (m) => m.role === "assistant",
    );
    if (hasAssistantMessages) {
      instruction =
        "\n\n<instruction>Reference prior messages naturally. Never repeat jokes, observations, or phrases you already used above. Keep responses short (1-3 sentences).</instruction>";
    }
  }

  return `<conversation_history>\n${history}\n</conversation_history>${instruction}\n\n${lastLine}`;
}

/**
 * Inject user preferences into the prompt.
 */
export async function enrichPromptWithContext(
  basePrompt: string,
  _sessionId?: string,
): Promise<string> {
  let enrichedPrompt = basePrompt;

  // Add user preferences
  try {
    const preferences = await getActivePreferences();
    if (preferences.length > 0) {
      const formattedPrefs = formatPreferencesForPrompt(preferences);
      enrichedPrompt += `\n\n${formattedPrefs}`;
    }
  } catch (err) {
    log.debug("Failed to load user preferences", { error: String(err) });
  }

  return enrichedPrompt;
}
