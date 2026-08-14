import type {
  ChinaRelevanceResult,
  LightweightSocialSignal,
  SocialPlatform,
} from "./types";
import { stableEventKey } from "./json";

export const CHINA_GATE_AGENT_ID = "china-relevance-gate";
export const SOCIAL_CONTROL_AGENT_ID = "social-control-agent";
export const SOCIAL_FUSION_AGENT_ID = "social-fusion-agent";

export const PLATFORM_AGENT_IDS: Record<SocialPlatform, string> = {
  x: "x-social-agent",
  telegram: "telegram-social-agent",
  lihkg: "lihkg-social-agent",
  facebook: "facebook-social-agent",
  github: "github-social-agent",
  instagram: "instagram-social-agent",
  lien: "lien-social-agent",
  netlight: "netlight-social-agent",
  ptt: "ptt-social-agent",
  youtube: "youtube-social-agent",
};

function genericSchema(
  platform: SocialPlatform,
  nodeLabel: string,
): Record<string, unknown> {
  return {
    schema: `${platform}_alert_v1`,
    platform,
    event_key: "stable normalized event key",
    event_title: "event title",
    detection_status: "found | not_found",
    observed_at: 0,
    china_relevance: {},
    summary: "平台证据摘要",
    evidence: ["URL、频道、帖子、评论或公开内容证据"],
    regions: ["地区"],
    core_nodes: [nodeLabel],
    item_count: 0,
    growth_percent: 0,
    source_nodes: [nodeLabel],
    matched_terms: ["事件表述或传播节点"],
    content_overlap_percent: 0,
    status: "found | watching | stable | declining",
  };
}

const PLATFORM_SCHEMAS: Record<SocialPlatform, Record<string, unknown>> = {
  x: {
    schema: "x_alert_v1",
    platform: "x",
    event_key: "stable normalized event key",
    event_title: "event title",
    detection_status: "found | not_found",
    observed_at: 0,
    china_relevance: {},
    summary: "X 平台证据摘要",
    evidence: ["推文 URL、账号、话题或文本证据"],
    regions: ["region"],
    core_nodes: ["公开账号或话题标签"],
    hashtag: "#example",
    discussion_growth_percent: 780,
    participant_accounts: 2350,
    main_source: "香港地区",
    status: "rapid_spread | watching | stable | declining",
  },
  telegram: {
    schema: "telegram_alert_v1",
    platform: "telegram",
    event_key: "stable normalized event key",
    event_title: "event title",
    detection_status: "found | not_found",
    observed_at: 0,
    china_relevance: {},
    summary: "Telegram 平台证据摘要",
    evidence: ["频道名、消息 ID、消息链接或文本证据"],
    regions: ["region"],
    core_nodes: ["公开频道"],
    channel_path: ["频道A", "频道B", "频道C"],
    shared_content_percent: 82,
    bridge_channels: ["桥接频道"],
  },
  lihkg: {
    schema: "lihkg_alert_v1",
    platform: "lihkg",
    event_key: "stable normalized event key",
    event_title: "event title",
    detection_status: "found | not_found",
    observed_at: 0,
    china_relevance: {},
    summary: "LIHKG 平台证据摘要",
    evidence: ["帖子 URL、主题、楼层或评论证据"],
    regions: ["region"],
    core_nodes: ["帖子 ID 或用户"],
    topic: "topic",
    heat: "★★★★★",
    participant_count: 23000,
    stance: {
      support_percent: 45,
      oppose_percent: 38,
      neutral_percent: 17,
    },
    main_arguments: ["主要观点"],
  },
  facebook: {
    schema: "facebook_alert_v1",
    platform: "facebook",
    event_key: "stable normalized event key",
    event_title: "event title",
    detection_status: "found | not_found",
    observed_at: 0,
    china_relevance: {},
    summary: "Facebook 平台证据摘要",
    evidence: ["主页、帖子 URL、公开互动或转载证据"],
    regions: ["region"],
    core_nodes: ["主页或公开帖子"],
    pages: ["page name"],
    interaction_growth_percent: 300,
    propagation_users: 12000,
    influence_regions: ["香港", "台湾"],
  },
  github: genericSchema("github", "仓库、议题、组织或用户"),
  instagram: genericSchema("instagram", "公开账号、话题或帖子"),
  lien: genericSchema("lien", "公开资料、公司主页或帖子"),
  netlight: genericSchema("netlight", "Matrix 房间或消息源"),
  ptt: genericSchema("ptt", "看板、文章或作者"),
  youtube: genericSchema("youtube", "频道、视频或评论区"),
};

export function buildPlatformReportTask(
  signal: LightweightSocialSignal,
  gate: ChinaRelevanceResult,
): string {
  const schema = {
    ...PLATFORM_SCHEMAS[signal.platform],
    event_key: stableEventKey(signal.title),
    event_title: signal.title,
    observed_at: signal.observedAt,
    china_relevance: gate,
  };

  return [
    `请分析这个 ${signal.platform} 平台的爬虫证据，并生成一份平台报告。`,
    "只返回合法 JSON，必须匹配下面的平台 schema 示例：",
    JSON.stringify(schema, null, 2),
    "必须原样复制 china_relevance 对象，不要重新解释中国相关性与风险门槛判断。",
    "只有输入 raw.items 中存在公开 URL、频道名、消息 ID、帖子、评论、公开主页或文本摘要时，才能把 detection_status 设置为 found。",
    "如果 raw.items 为空，或只有账号/频道列表、配置探测、程序状态、路径、报错信息，必须返回 detection_status=not_found。",
    "证据必须来自输入中的公开 URL、频道名、消息 ID、帖子、评论、公开主页或文本摘要；不要编造没有出现过的来源。",
    "没有真实来源的传播速度、共同传播比例、增长率、立场比例等指标必须保持为 0 或空默认值。",
    "",
    "中国相关性与风险门槛判断结果：",
    JSON.stringify(gate, null, 2),
    "",
    "爬虫证据：",
    JSON.stringify(signal, null, 2),
  ].join("\n");
}

export function buildPlatformReflectionTask(input: {
  readonly platform: SocialPlatform;
  readonly phase: "discover" | "search" | "china_gate";
  readonly status: string;
  readonly previousState: unknown;
  readonly toolSummary?: unknown;
  readonly gate?: ChinaRelevanceResult;
  readonly findings?: readonly string[];
  readonly retentionDays: number;
}): string {
  const phaseLabel =
    input.phase === "discover"
      ? "自主发现"
      : input.phase === "search"
        ? "同一事件复核"
        : "中国相关性与风险门槛判断";
  const schema = {
    schema: "platform_agent_reflection_v1",
    platform: input.platform,
    phase: input.phase,
    status: input.status,
    reflection_summary: "面向页面展示的一句话复盘，不包含隐式思维链",
    observed_patterns: ["本平台从真实工具返回中观察到的规律或缺口"],
    failure_causes: ["如果失败/缺配置/证据不足，这里列出原因；没有就空数组"],
    improvement_plan: "下一轮本平台应该如何改进抓取或核验",
    next_action: "下一步动作",
    confidence: 0.0,
  };

  return [
    `你是 ${input.platform} 平台智能体的自我复盘模块。`,
    `本次阶段：${phaseLabel}。请只基于输入中的工具结果、门槛判断和已有状态，输出可展示的复盘 JSON。`,
    "不要输出思维链。不要编造 URL、频道、指标、时间、账号或事实；证据只能来自输入。不要把配置路径、Cookie、Token 或本机路径写入复盘。",
    `时间窗口固定为最近 ${input.retentionDays} 天；超过窗口、缺少时间、缺少 URL/频道/正文的内容，要在复盘中标为证据不足或需要补齐。`,
    "只返回合法 JSON，必须匹配下面结构：",
    JSON.stringify(schema, null, 2),
    "",
    "上一状态：",
    JSON.stringify(input.previousState, null, 2),
    "",
    "工具/门槛结果：",
    JSON.stringify(
      {
        toolSummary: input.toolSummary ?? null,
        gate: input.gate ?? null,
        findings: input.findings ?? [],
      },
      null,
      2,
    ),
  ].join("\n");
}

export function buildFusionTask(reports: readonly unknown[]): string {
  return [
    "请把这些平台报告融合成一个跨平台事件判断。",
    "只返回合法 JSON，结构必须完全符合下面的形状：",
    JSON.stringify(
      {
        schema: "social_fusion_v1",
        event_key: "stable normalized event key",
        event_title: "event title",
        same_event_confidence: 0.0,
        impact_level: "Low | Medium | High | Critical",
        trend: "rising | stable | declining | uncertain",
        platform_sequence: ["telegram", "x", "lihkg", "facebook", "github"],
        platform_counts: {
          x: 3000,
          telegram: 12,
          lihkg: 5,
          facebook: 8,
          github: 4,
          instagram: 6,
          lien: 1,
          netlight: 2,
          ptt: 3,
          youtube: 5,
        },
        core_propagation_nodes: ["公开传播节点"],
        relationship_summary: "公开传播关系摘要",
        recommended_actions: ["建议动作"],
        evidence: ["证据"],
      },
      null,
      2,
    ),
    "",
    "规则：",
    "- 把重复文本、URL、媒体哈希、公开账号、页面、频道和帖子引用视为传播证据。",
    "- detection_status=not_found 表示缺少证据，不能计入传播。",
    "- 如果某个平台报告没有 evidence 中的公开 URL、频道/消息 ID、帖子或内容摘要，不要把它计入 platform_sequence。",
    "- 不要用常识或猜测补全传播路径；证据不足时降低 same_event_confidence。",
    "- 不要推断私人身份或隐藏个人关系。",
    "- 如果报告不明显属于同一事件，降低 same_event_confidence，并在 relationship_summary 中说明原因。",
    "",
    "平台报告：",
    JSON.stringify(reports, null, 2),
  ].join("\n");
}
