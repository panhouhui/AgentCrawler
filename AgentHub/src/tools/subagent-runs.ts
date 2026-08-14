import type { ToolDefinition, ToolCategory } from "./types";
import { getDb } from "../store/db";

interface SubAgentRunRow {
  readonly id: string;
  readonly parent_agent_id: string;
  readonly child_agent_id: string;
  readonly task: string;
  readonly status: string;
  readonly error_message: string | null;
  readonly started_at: number;
  readonly ended_at: number | null;
}

function formatAge(epochSec: number): string {
  const diffMs = Date.now() - epochSec * 1000;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(start: number, end: number | null): string {
  if (!end) return "running";
  const secs = end - start;
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function createGetSubagentRunsTool(): ToolDefinition {
  return {
    name: "get_subagent_runs",
    description:
      "View recent sub-agent execution history. Shows which agents were spawned, their tasks, status (completed/error/timeout), and duration. Useful for understanding failure patterns before retrying.",
    categories: ["analytics"] as readonly ToolCategory[],
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Filter by child agent ID. Omit for all agents.",
        },
        status: {
          type: "string",
          enum: ["completed", "error", "timeout", "running"],
          description: "Filter by status. Omit for all statuses.",
        },
        limit: {
          type: "number",
          description: "Max results (default 20, max 50).",
        },
      },
      required: [],
    },
    async execute(input): Promise<{ output: string; isError: boolean }> {
      const agentId = input.agent_id as string | undefined;
      const status = input.status as string | undefined;
      const limit = Math.min((input.limit as number) || 20, 50);

      try {
        const db = getDb();
        let rows: readonly SubAgentRunRow[];

        if (agentId && status) {
          rows = await db`
            SELECT id, parent_agent_id, child_agent_id, task, status, error_message, started_at, ended_at
            FROM subagent_runs
            WHERE child_agent_id = ${agentId} AND status = ${status}
            ORDER BY started_at DESC
            LIMIT ${limit}
          ` as SubAgentRunRow[];
        } else if (agentId) {
          rows = await db`
            SELECT id, parent_agent_id, child_agent_id, task, status, error_message, started_at, ended_at
            FROM subagent_runs
            WHERE child_agent_id = ${agentId}
            ORDER BY started_at DESC
            LIMIT ${limit}
          ` as SubAgentRunRow[];
        } else if (status) {
          rows = await db`
            SELECT id, parent_agent_id, child_agent_id, task, status, error_message, started_at, ended_at
            FROM subagent_runs
            WHERE status = ${status}
            ORDER BY started_at DESC
            LIMIT ${limit}
          ` as SubAgentRunRow[];
        } else {
          rows = await db`
            SELECT id, parent_agent_id, child_agent_id, task, status, error_message, started_at, ended_at
            FROM subagent_runs
            ORDER BY started_at DESC
            LIMIT ${limit}
          ` as SubAgentRunRow[];
        }

        if (rows.length === 0) {
          return { output: "No sub-agent runs found.", isError: false };
        }

        const lines = rows.map((r, i) => {
          const dur = formatDuration(r.started_at, r.ended_at);
          const taskSnippet = r.task.slice(0, 120);
          const err = r.status === "error" && r.error_message
            ? `\n  Error: ${r.error_message.slice(0, 200)}`
            : "";
          return `${i + 1}. [${r.status}] ${r.parent_agent_id} → ${r.child_agent_id} (${dur}, ${formatAge(r.started_at)})\n  Task: ${taskSnippet}${err}`;
        });

        // Summary stats
        const errorCount = rows.filter((r) => r.status === "error").length;
        const timeoutCount = rows.filter((r) => r.status === "timeout").length;
        const header = `${rows.length} runs` +
          (errorCount > 0 ? `, ${errorCount} errors` : "") +
          (timeoutCount > 0 ? `, ${timeoutCount} timeouts` : "") +
          ":\n\n";

        return { output: header + lines.join("\n\n"), isError: false };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { output: `Error fetching sub-agent runs: ${msg}`, isError: true };
      }
    },
  };
}
