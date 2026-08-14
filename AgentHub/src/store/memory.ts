import { getDb } from "./db";

export interface MemoryEntry {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: number;
}

interface MemoryRow {
  key: string;
  value: string;
  updated_at: number;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  };
}

export async function getAgentMemories(
  agentId: string,
): Promise<readonly MemoryEntry[]> {
  const db = getDb();

  const rows = await db`
    SELECT key, value, updated_at FROM agent_memory
    WHERE agent_id = ${agentId}
    ORDER BY updated_at
  `;

  return (rows as MemoryRow[]).map(rowToEntry);
}

export async function setMemory(
  agentId: string,
  key: string,
  value: string,
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  await db`
    INSERT INTO agent_memory (agent_id, key, value, updated_at)
    VALUES (${agentId}, ${key}, ${value}, ${now})
    ON CONFLICT (agent_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `;
}

export function formatMemoryBlock(entries: readonly MemoryEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- ${e.key}: ${e.value}`);
  return `## Your Memory\n${lines.join("\n")}`;
}
