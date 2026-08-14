import { loadConfig, loadConfigWithOverrides } from "../src/config/loader";
import { createAgentRegistry } from "../src/agents/registry";
import { initDb, closeDb } from "../src/store/db";
import { createToolRegistry } from "../src/tools/registry";
import {
  createCrawlerTools,
  SOCIAL_AGENT_TOOL_BINDINGS,
} from "../src/tools/crawler-tools";
import { isToolGranted } from "../src/tools/privilege";

type VerifyMode = "smoke" | "probe" | "crawl";

interface CheckResult {
  readonly agentId: string;
  readonly toolName: string;
  readonly agentExists: boolean;
  readonly toolRegistered: boolean;
  readonly toolGranted: boolean;
  readonly executed: boolean;
  readonly executionOk: boolean;
  readonly qualityOk: boolean;
  readonly ok: boolean;
  readonly dataQuality?: Record<string, unknown>;
  readonly qualityReason?: string;
  readonly outputPreview: string;
  readonly error?: string;
}

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 800);
}

function parseOutputJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const jsonStart = text.indexOf("{");
    if (jsonStart < 0) return null;
    try {
      const parsed = JSON.parse(text.slice(jsonStart));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function dataQualityFromOutput(output: Record<string, unknown> | null): Record<string, unknown> | undefined {
  const value = output?.dataQuality;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assessQuality(
  toolName: string,
  executionOk: boolean,
  dataQuality?: Record<string, unknown>,
): { readonly ok: boolean; readonly reason?: string } {
  if (!toolName.startsWith("crawl_")) {
    return executionOk
      ? { ok: true }
      : { ok: false, reason: "非爬虫工具执行失败" };
  }

  if (!dataQuality) {
    return { ok: false, reason: "爬虫工具没有返回 dataQuality" };
  }

  if (dataQuality.hasMojibake === true) {
    return { ok: false, reason: "爬虫输出存在乱码特征" };
  }

  const configured = String(dataQuality.configured ?? "");
  const status = String(dataQuality.status ?? "");
  if (configured !== "ready") {
    return status === "missing_config"
      ? { ok: true, reason: "平台缺少必要配置，按约定暂时跳过真实数据要求" }
      : { ok: false, reason: `平台未配置完整，但状态不是 missing_config: ${status}` };
  }

  if (status === "real_data" || status === "no_results" || status === "probe_not_supported" || status === "smoke_only") {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `已配置平台没有返回真实查询状态，当前状态为 ${status}`,
  };
}

function sampleInput(toolName: string, mode: VerifyMode): Record<string, unknown> {
  if (toolName === "assess_china_relevance") {
    return {
      title: "香港测试事件",
      summary: "香港地区出现新的公共讨论，需要判断是否进入深度爬取。",
      evidence: ["香港", "中文讨论"],
    };
  }

  if (toolName === "fuse_social_reports") {
    const gate = {
      china_relevance: "direct",
      score: 0.9,
      matched_dimensions: ["hong_kong"],
      evidence: ["mentions Hong Kong"],
      recommended_action: "deep_crawl",
      reason: "Hong Kong context",
    };
    return {
      reports: [
        {
          schema: "x_alert_v1",
          platform: "x",
          event_key: "hong-kong-test-event",
          event_title: "香港测试事件",
          detection_status: "found",
          observed_at: Math.floor(Date.now() / 1000),
          china_relevance: gate,
          summary: "X detected growth",
          evidence: ["tool smoke"],
          regions: ["Hong Kong"],
          core_nodes: ["#hk"],
          hashtag: "#hk",
          discussion_growth_percent: 100,
          participant_accounts: 10,
          main_source: "Hong Kong",
          status: "watching",
        },
      ],
    };
  }

  return {
    mode,
    phase: "discover",
    eventTitle: "香港测试事件",
    limit: 1,
    dryRun: true,
    timeoutMs: mode === "smoke" ? 15_000 : 120_000,
  };
}

async function main(): Promise<void> {
  const modeRaw = argValue("mode", "probe");
  const mode: VerifyMode =
    modeRaw === "smoke" || modeRaw === "probe" || modeRaw === "crawl"
      ? modeRaw
      : "probe";

  const base = loadConfig();
  await initDb(process.env.DATABASE_URL ?? base.postgres.url, { max: 3 });

  try {
    const config = await loadConfigWithOverrides();
    const agentRegistry = createAgentRegistry(config.agents, config.agent);
    const toolRegistry = createToolRegistry({
      ...config.tools,
      allowedDirectories: [process.cwd()],
    }).withTools(createCrawlerTools());
    const checks: CheckResult[] = [];

    for (const [agentId, tools] of Object.entries(SOCIAL_AGENT_TOOL_BINDINGS)) {
      const agent = agentRegistry.getById(agentId);

      for (const toolName of tools) {
        const toolRegistered = toolRegistry.definitions.some((tool) => tool.name === toolName);
        const toolGranted = agent ? isToolGranted(agent.toolFilter, toolName) : false;
        let executed = false;
        let executionOk = false;
        let qualityOk = false;
        let ok = false;
        let dataQuality: Record<string, unknown> | undefined;
        let qualityReason: string | undefined;
        let outputPreview = "";
        let error: string | undefined;

        if (toolRegistered && toolGranted) {
          const result = await toolRegistry.executeTool(toolName, sampleInput(toolName, mode));
          executed = true;
          executionOk = !result.isError;
          outputPreview = preview(result.output);
          const parsedOutput = parseOutputJson(result.output);
          dataQuality = dataQualityFromOutput(parsedOutput);
          const quality = assessQuality(toolName, executionOk, dataQuality);
          qualityOk = quality.ok;
          qualityReason = quality.reason;
          ok = executionOk || dataQuality?.status === "missing_config";
          ok = ok && qualityOk;
          if (result.isError) error = result.errorCode ?? "tool returned error";
        }

        checks.push({
          agentId,
          toolName,
          agentExists: Boolean(agent),
          toolRegistered,
          toolGranted,
          executed,
          executionOk,
          qualityOk,
          ok,
          ...(dataQuality ? { dataQuality } : {}),
          ...(qualityReason ? { qualityReason } : {}),
          outputPreview,
          ...(error ? { error } : {}),
        });
      }
    }

    const allOk = checks.every(
      (item) =>
        item.agentExists &&
        item.toolRegistered &&
        item.toolGranted &&
        item.executed &&
        item.qualityOk &&
        item.ok,
    );

    console.log(
      JSON.stringify(
        {
          ok: allOk,
          mode,
          checkedAt: new Date().toISOString(),
          checks,
        },
        null,
        2,
      ),
    );

    if (!allOk) process.exitCode = 1;
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
