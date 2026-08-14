import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentHubRoot } from "./agenthub-root";

export interface ModelEnvLoadResult {
  readonly found: boolean;
  readonly loadedKeys: readonly string[];
}

const AGENT_HUB_ROOT = getAgentHubRoot();
const MODEL_ENV_ROOT =
  process.env.MODEL_ENV_ROOT ?? join(AGENT_HUB_ROOT, "env", "model_env");
const DEFAULT_MINIMAX_ENV_FILE = join(MODEL_ENV_ROOT, "minimax_env");
const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io/anthropic";

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvText(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (trimmed && !trimmed.includes("=")) {
    return { MINIMAX_INTL_API_KEY: trimmed };
  }

  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    const value = unquote(normalized.slice(eq + 1));
    if (key && value) values[key] = value;
  }
  return values;
}

export function loadMiniMaxModelEnv(
  filePath = process.env.MINIMAX_ENV_FILE ?? DEFAULT_MINIMAX_ENV_FILE,
): ModelEnvLoadResult {
  const loadedKeys: string[] = [];
  if (!existsSync(filePath)) {
    process.env.MINIMAX_BASE_URL ??= DEFAULT_MINIMAX_BASE_URL;
    return { found: false, loadedKeys };
  }

  const values = parseEnvText(readFileSync(filePath, "utf-8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loadedKeys.push(key);
    }
  }

  process.env.MINIMAX_BASE_URL ??= DEFAULT_MINIMAX_BASE_URL;
  return { found: true, loadedKeys };
}
