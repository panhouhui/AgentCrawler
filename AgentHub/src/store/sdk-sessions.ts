import { getDb } from "./db";
import { createLogger } from "../logger";

const log = createLogger("sdk-sessions");

export async function getSdkSessionId(
  channel: string,
  chatId: string,
  agentId: string,
): Promise<string | null> {
  const db = getDb();
  const rows = await db`
    SELECT sdk_session_id FROM sdk_sessions
    WHERE channel = ${channel} AND chat_id = ${chatId} AND agent_id = ${agentId}
  `;
  const row = rows[0] as { sdk_session_id: string } | undefined;
  return row?.sdk_session_id ?? null;
}

export async function saveSdkSessionId(
  channel: string,
  chatId: string,
  agentId: string,
  sdkSessionId: string,
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  await db`
    INSERT INTO sdk_sessions (channel, chat_id, agent_id, sdk_session_id, created_at, updated_at)
    VALUES (${channel}, ${chatId}, ${agentId}, ${sdkSessionId}, ${now}, ${now})
    ON CONFLICT (channel, chat_id, agent_id)
    DO UPDATE SET sdk_session_id = ${sdkSessionId}, updated_at = ${now}
  `;
  log.debug("Saved SDK session", { channel, chatId, agentId, sdkSessionId });
}

export async function clearSdkSession(
  channel: string,
  chatId: string,
  agentId: string,
): Promise<void> {
  const db = getDb();
  await db`
    DELETE FROM sdk_sessions
    WHERE channel = ${channel} AND chat_id = ${chatId} AND agent_id = ${agentId}
  `;
  log.debug("Cleared SDK session", { channel, chatId, agentId });
}

export async function clearAllSdkSessions(
  channel: string,
  chatId: string,
): Promise<void> {
  const db = getDb();
  await db`
    DELETE FROM sdk_sessions
    WHERE channel = ${channel} AND chat_id = ${chatId}
  `;
  log.debug("Cleared all SDK sessions for chat", { channel, chatId });
}
