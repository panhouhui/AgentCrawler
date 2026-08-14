import { loadConfig, loadConfigWithOverrides } from "../src/config/loader";
import { AGENT_SEEDS } from "../src/config/agent-seeds";
import { initDb, closeDb } from "../src/store/db";
import { upsertAgentOverride } from "../src/store/agent-overrides";
import { SOCIAL_AGENT_TOOL_BINDINGS } from "../src/tools/crawler-tools";

async function main(): Promise<void> {
  const base = loadConfig();
  await initDb(process.env.DATABASE_URL ?? base.postgres.url, { max: 3 });

  try {
    const config = await loadConfigWithOverrides();
    const seedById = new Map(AGENT_SEEDS.map((agent) => [agent.id, agent]));
    const updated: Array<{ agentId: string; tools: readonly string[] }> = [];

    for (const [agentId, tools] of Object.entries(SOCIAL_AGENT_TOOL_BINDINGS)) {
      const agent =
        seedById.get(agentId) ?? config.agents.find((item) => item.id === agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      await upsertAgentOverride(agentId, {
        ...agent,
        toolFilter: { mode: "allowlist", tools: [...tools] },
      });
      updated.push({ agentId, tools });
    }

    console.log(JSON.stringify({ ok: true, updated }, null, 2));
  } finally {
    await closeDb();
  }
}

main().catch(async (error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  await closeDb().catch(() => undefined);
  process.exit(1);
});
