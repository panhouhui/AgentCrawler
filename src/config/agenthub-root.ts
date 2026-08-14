import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export function getAgentHubRoot(): string {
  if (process.env.AGENT_HUB_ROOT) return process.env.AGENT_HUB_ROOT;
  const cwd = resolve(process.cwd());
  if (existsSync(join(cwd, "Crawler")) || existsSync(join(cwd, "env"))) {
    return cwd;
  }
  return resolve(cwd, "..");
}
