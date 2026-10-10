import { getDb } from "./db";

export async function claimKanInbound(externalId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db`
    INSERT INTO kan_inbound_messages (external_id, received_at)
    VALUES (${externalId}, ${Math.floor(Date.now() / 1000)})
    ON CONFLICT (external_id) DO NOTHING
    RETURNING external_id
  `;
  return rows.length > 0;
}

export async function recordKanDelivery(input: {
  eventKey?: string;
  destinationType: "channel" | "direct";
  destinationId: string;
  userId?: string;
  messageId?: string;
  message: string;
  status: "sent" | "failed" | "skipped";
  error?: string | null;
}): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO kan_deliveries
      (id, event_key, destination_type, destination_id, user_id, message_id,
       message, status, error, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${input.eventKey ?? null}, ${input.destinationType},
       ${input.destinationId}, ${input.userId ?? null}, ${input.messageId ?? null},
       ${input.message}, ${input.status}, ${input.error ?? null},
       ${Math.floor(Date.now() / 1000)}, ${Math.floor(Date.now() / 1000)})
  `;
}
