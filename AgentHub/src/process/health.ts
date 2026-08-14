import type { ProcessName, ProcessRecord, ProcessStatus } from "./types";
import { listProcesses } from "./registry";

const ALIVE_THRESHOLD_SEC = 30;
const STALE_THRESHOLD_SEC = 60;

export function computeStatus(
  record: ProcessRecord,
  nowSec: number = Math.floor(Date.now() / 1000),
): ProcessStatus {
  const age = nowSec - record.lastHeartbeat;
  if (age <= ALIVE_THRESHOLD_SEC) return "alive";
  if (age <= STALE_THRESHOLD_SEC) return "stale";
  return "dead";
}

export interface ProcessHealth {
  readonly name: ProcessName;
  readonly pid: number;
  readonly status: ProcessStatus;
  readonly startedAt: number;
  readonly lastHeartbeat: number;
  readonly uptimeSeconds: number;
  readonly metadata: Record<string, unknown>;
}

export async function getProcessStatuses(): Promise<readonly ProcessHealth[]> {
  const records = await listProcesses();
  const now = Math.floor(Date.now() / 1000);

  return records.map((r) => ({
    name: r.name,
    pid: r.pid,
    status: computeStatus(r, now),
    startedAt: r.startedAt,
    lastHeartbeat: r.lastHeartbeat,
    uptimeSeconds: now - r.startedAt,
    metadata: r.metadata,
  }));
}
