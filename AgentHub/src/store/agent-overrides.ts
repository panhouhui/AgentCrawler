import {
  getAllOverrides,
  getOverride,
  setOverride,
  deleteOverride,
} from "./config-overrides";
import type { AgentDefinition } from "../agents/types";

const NAMESPACE = "agents";

export interface AgentOverride {
  readonly id: string;
  readonly definition: AgentDefinition & { readonly _deleted?: boolean };
}

export async function getAgentOverrides(): Promise<readonly AgentOverride[]> {
  const rows = await getAllOverrides(NAMESPACE);
  return rows.map((row) => ({
    id: row.key,
    definition: row.value as AgentOverride["definition"],
  }));
}

export async function getAgentOverride(
  id: string,
): Promise<AgentOverride | null> {
  const value = await getOverride(NAMESPACE, id);
  if (!value) return null;
  return { id, definition: value as AgentOverride["definition"] };
}

export async function upsertAgentOverride(
  id: string,
  definition: AgentDefinition,
): Promise<void> {
  await setOverride(NAMESPACE, id, definition);
}

export async function tombstoneAgentOverride(id: string): Promise<void> {
  await setOverride(NAMESPACE, id, { _deleted: true });
}

export async function deleteAgentOverrideRow(id: string): Promise<void> {
  await deleteOverride(NAMESPACE, id);
}
