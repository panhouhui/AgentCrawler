/* ── Redaction utilities for agent secrets ─────────────────── */

export const REDACTED_SENTINEL = "__REDACTED__";

const SECRET_AGENT_KEYS = ["telegramBotToken"] as const;

export function stripRedactedKeys<T extends Record<string, unknown>>(
  partial: T,
): T {
  const cleaned = { ...partial };
  for (const key of SECRET_AGENT_KEYS) {
    if (cleaned[key] === REDACTED_SENTINEL) {
      delete (cleaned as Record<string, unknown>)[key];
    }
  }
  return cleaned;
}
