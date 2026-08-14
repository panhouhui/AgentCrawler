import { getDb } from "./db";

export interface StoredMessage {
  readonly id: string;
  readonly channel: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly senderName: string | null;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly mediaType: string | null;
  readonly timestamp: number;
  readonly createdAt: number;
}

interface MessageRow {
  id: string;
  channel: string;
  chat_id: string;
  sender_id: string;
  sender_name: string | null;
  role: "user" | "assistant";
  content: string;
  media_type: string | null;
  timestamp: number;
  created_at: number;
}

function rowToMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    channel: row.channel,
    chatId: row.chat_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    role: row.role,
    content: row.content,
    mediaType: row.media_type,
    timestamp: row.timestamp,
    createdAt: row.created_at,
  };
}

export async function saveMessage(msg: {
  readonly id: string;
  readonly channel: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly senderName?: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly mediaType?: string;
  readonly timestamp: number;
}): Promise<StoredMessage> {
  const db = getDb();

  const [row] = await db`
    INSERT INTO messages (id, channel, chat_id, sender_id, sender_name, role, content, media_type, timestamp)
    VALUES (${msg.id}, ${msg.channel}, ${msg.chatId}, ${msg.senderId}, ${msg.senderName ?? null}, ${msg.role}, ${msg.content}, ${msg.mediaType ?? null}, ${msg.timestamp})
    RETURNING *
  `;

  if (!row) {
    throw new Error(`Failed to save message: ${msg.id}`);
  }

  return rowToMessage(row as MessageRow);
}

export interface PaginatedMessages {
  readonly messages: readonly StoredMessage[];
  readonly nextCursor: string | null;
}

export async function getMessagesByChat(
  channel: string,
  chatId: string,
  limit = 50,
  before?: string,
): Promise<readonly StoredMessage[]> {
  const db = getDb();

  const rows = before
    ? await db`
        SELECT * FROM messages
        WHERE channel = ${channel} AND chat_id = ${chatId}
          AND timestamp < (SELECT timestamp FROM messages WHERE id = ${before})
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `
    : await db`
        SELECT * FROM messages
        WHERE channel = ${channel} AND chat_id = ${chatId}
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `;

  return (rows as MessageRow[]).map(rowToMessage).reverse();
}

export async function getMessagesByChatPaginated(
  channel: string,
  chatId: string,
  limit = 50,
  before?: string,
): Promise<PaginatedMessages> {
  const db = getDb();

  // Fetch one extra to determine if there's a next page
  const fetchLimit = limit + 1;

  const rows = before
    ? await db`
        SELECT * FROM messages
        WHERE channel = ${channel} AND chat_id = ${chatId}
          AND timestamp < (SELECT timestamp FROM messages WHERE id = ${before})
        ORDER BY timestamp DESC
        LIMIT ${fetchLimit}
      `
    : await db`
        SELECT * FROM messages
        WHERE channel = ${channel} AND chat_id = ${chatId}
        ORDER BY timestamp DESC
        LIMIT ${fetchLimit}
      `;

  const allRows = rows as MessageRow[];
  const hasMore = allRows.length > limit;
  const sliced = hasMore ? allRows.slice(0, limit) : allRows;
  const messages = sliced.map(rowToMessage).reverse();
  const nextCursor = hasMore ? messages[0]!.id : null;

  return { messages, nextCursor };
}

export async function getRecentMessages(
  limit = 50,
): Promise<readonly StoredMessage[]> {
  const db = getDb();

  const rows = await db`
    SELECT * FROM messages ORDER BY timestamp DESC LIMIT ${limit}
  `;

  return (rows as MessageRow[]).map(rowToMessage).reverse();
}

export async function clearChatMessages(
  channel: string,
  chatId: string,
): Promise<number> {
  const db = getDb();

  const rows = await db`
    DELETE FROM messages WHERE channel = ${channel} AND chat_id = ${chatId}
  `;

  return rows.count ?? 0;
}
