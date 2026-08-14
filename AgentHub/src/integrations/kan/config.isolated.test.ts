import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const realAgentHubRoot = process.env.AGENT_HUB_ROOT;
const realCrawlerEnvRoot = process.env.CRAWLER_ENV_ROOT;
const realSocialFusionKanEnv = process.env.SOCIAL_FUSION_KAN_ENV;
const tempParent = join(process.cwd(), ".tmp");
mkdirSync(tempParent, { recursive: true });
const tempRoot = mkdtempSync(join(tempParent, "kan-config-"));
const crawlerEnvRoot = join(tempRoot, "Crawler_env");
const socialFusionEnv = join(crawlerEnvRoot, "SocialFusion_env");

mkdirSync(crawlerEnvRoot, { recursive: true });
process.env.AGENT_HUB_ROOT = tempRoot;
process.env.CRAWLER_ENV_ROOT = crawlerEnvRoot;
delete process.env.SOCIAL_FUSION_KAN_ENV;

beforeAll(() => {});

afterAll(() => {
  if (realAgentHubRoot === undefined) delete process.env.AGENT_HUB_ROOT;
  else process.env.AGENT_HUB_ROOT = realAgentHubRoot;
  if (realCrawlerEnvRoot === undefined) delete process.env.CRAWLER_ENV_ROOT;
  else process.env.CRAWLER_ENV_ROOT = realCrawlerEnvRoot;
  if (realSocialFusionKanEnv === undefined) delete process.env.SOCIAL_FUSION_KAN_ENV;
  else process.env.SOCIAL_FUSION_KAN_ENV = realSocialFusionKanEnv;
  rmSync(tempRoot, { recursive: true, force: true });
});

const {
  SOCIAL_FUSION_KAN_ROUTE_ID,
  getKanPushOverview,
  saveKanPushRouteConfig,
} = await import("./config");

describe("社交融合 Kan 总推送配置", () => {
  test("写入独立 env 文件，并且接口概览不暴露机器人令牌", async () => {
    const overview = await saveKanPushRouteConfig({
      routeId: SOCIAL_FUSION_KAN_ROUTE_ID,
      baseUrl: "https://kan.example",
      botToken: "secret-social-token",
      channelIds: ["channel-a", "channel-b"],
    });

    expect(existsSync(socialFusionEnv)).toBe(true);
    const envText = readFileSync(socialFusionEnv, "utf-8");
    expect(envText).toContain("SOCIAL_FUSION_KAN_BASE_URL=https://kan.example");
    expect(envText).toContain("SOCIAL_FUSION_KAN_CHANNEL_IDS=channel-a,channel-b");
    expect(envText).toContain("SOCIAL_FUSION_KAN_BOT_TOKEN=secret-social-token");

    const route = overview.routes.find((item) => item.id === SOCIAL_FUSION_KAN_ROUTE_ID);
    expect(route).toBeDefined();
    expect(route?.platform).toBe("social-fusion");
    expect(route?.platformLabel).toBe("社交融合总控");
    expect(route?.tokenConfigured).toBe(true);
    expect(JSON.stringify(route)).not.toContain("secret-social-token");

    const freshOverview = await getKanPushOverview();
    expect(JSON.stringify(freshOverview)).not.toContain("secret-social-token");
  });
});
