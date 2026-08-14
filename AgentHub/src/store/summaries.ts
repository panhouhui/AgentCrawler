import { getDb } from "./db";

export interface ConversationSummary {
  readonly id: string;
  readonly channel: string;
  readonly chatId: string;
  readonly summary: string;
  readonly messageCount: number;
  readonly tokenEstimate: number;
  readonly createdAt: number;
}

export async function getLatestSummary(
  channel: string,
  chatId: string,
): Promise<ConversationSummary | null> {
  const db = getDb();
  const rows = await db`
    SELECT
      id,
      channel,
      chat_id     AS "chatId",
      summary,
      message_count  AS "messageCount",
      token_estimate AS "tokenEstimate",
      created_at     AS "createdAt"
    FROM conversation_summaries
    WHERE channel = ${channel} AND chat_id = ${chatId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as ConversationSummary) ?? null;
}

export async function clearSummaries(
  channel: string,
  chatId: string,
): Promise<void> {
  const db = getDb();
  await db`DELETE FROM conversation_summaries WHERE channel = ${channel} AND chat_id = ${chatId}`;
}
