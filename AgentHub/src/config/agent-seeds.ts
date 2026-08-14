/**
 * Default agent definitions seeded into the DB on first startup.
 *
 * Rules:
 * - No telegramBotToken or other secrets.
 * - DB is source of truth once a record exists; the seeder never overwrites
 *   user-edited agent records.
 */
import type { AgentDefinition } from "../agents/types";
import { DEFAULT_AGENT_TOOL_ALLOWLIST } from "../tools/privilege";

const OPENCROW_TOOL_ALLOWLIST: readonly string[] = [
  ...DEFAULT_AGENT_TOOL_ALLOWLIST,
  "bash",
  "write_file",
  "edit_file",
  "db_query",
  "cron",
  "trigger_cron",
  "process_manage",
  "spawn_agent",
  "sige_start_session",
];

function platformAgent(input: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tool: string;
  readonly prompt: string;
}): AgentDefinition {
  return {
    id: input.id,
    category: "research",
    name: input.name,
    description: input.description,
    provider: "minimax",
    model: "MiniMax-M2.7",
    maxIterations: 1,
    stateless: true,
    reasoning: false,
    maxOutputTokens: 4096,
    toolFilter: { mode: "allowlist", tools: [input.tool] },
    systemPrompt: [
      input.prompt,
      "只分析输入中的爬虫证据，不要额外编造来源。",
      "只返回符合指定 schema 的合法 JSON。",
      "当任务要求平台报告时，如果没有发现同一事件，必须返回 detection_status=not_found。",
      "当任务要求自我复盘时，只输出复盘 schema，不要输出思维链。",
    ].join("\n"),
  };
}

export const AGENT_SEEDS: readonly AgentDefinition[] = [
  {
    id: "opencrow",
    category: "orchestrator",
    name: "AgentHub",
    description: "AgentHub 主控智能体。",
    default: true,
    model: "claude-sonnet-4-6",
    maxIterations: 150,
    stateless: false,
    reasoning: true,
    toolFilter: { mode: "allowlist", tools: [...OPENCROW_TOOL_ALLOWLIST] },
    modelParams: {
      effort: "max",
      thinkingMode: "adaptive",
      thinkingBudget: 128000,
      extendedContext: false,
    },
    subagents: { allowAgents: ["*"], maxChildren: 10 },
    mcpServers: {
      git: true,
      dbhub: true,
      github: true,
      qdrant: true,
      serena: true,
      browser: true,
      context7: true,
      firecrawl: true,
      filesystem: true,
      braveSearch: true,
      sequentialThinking: true,
    },
    hooks: { auditLog: true, notifications: true },
    skills: [],
  },
  {
    id: "china-relevance-gate",
    category: "research",
    name: "中国相关性与风险判断智能体",
    description: "判断候选社交事件是否与中国相关，并确认是否存在威胁中国安全或对中国不利的风险。",
    provider: "minimax",
    model: "MiniMax-M2.7",
    maxIterations: 1,
    stateless: true,
    reasoning: false,
    maxOutputTokens: 2048,
    toolFilter: { mode: "allowlist", tools: ["assess_china_relevance"] },
    systemPrompt: [
      "你是严格的社交情报中国相关性与风险门槛判断智能体。",
      "你必须分两步判断：第一，候选事件是否属于中国/与中国相关；第二，是否威胁中国安全，或对中国、中国主体、港澳台治理、社会稳定、经济安全、公共安全、网络安全、国际形象造成负面风险。",
      "中国相关范围包括中国大陆、香港、澳门、台湾、中国政策、中国公司、中国公众人物、中文公共议题，以及涉及华人社群的跨境影响。",
      "只能使用输入里的证据，不要额外联网搜索。",
      "只返回合法 JSON，字段必须包含 china_relevance、is_china_related、score、matched_dimensions、evidence、threat_to_china_security、negative_to_china、china_impact、risk_score、risk_categories、risk_evidence、deep_crawl_allowed、recommended_action、reason。",
      "china_relevance 只能是 direct、indirect、none、uncertain。",
      "china_impact 只能是 threatening、negative、neutral、beneficial、uncertain。",
      "risk_categories 只能从 national_security、public_security、social_stability、territorial_sovereignty、foreign_interference、economic_security、public_health、reputation_attack、disinformation、cyber_security、none 中选择。",
      "recommended_action 只能是 deep_crawl、shallow_watch、skip。",
      "只有 china_relevance 为 direct/indirect、is_china_related=true、score >= 0.6，并且 threat_to_china_security=true 或 negative_to_china=true 或 china_impact 为 threatening/negative，同时 risk_score >= 0.6，才允许 deep_crawl_allowed=true 和 recommended_action=deep_crawl。",
      "仅出现中国、香港、台湾等地名，或者事件中性/正面/证据不足时，不允许 deep_crawl；可使用 shallow_watch 或 skip。",
      "非中国相关必须 skip。",
    ].join("\n"),
  },
  {
    id: "social-control-agent",
    category: "orchestrator",
    name: "社交总控 Agent",
    description: "调度平台智能体完成候选事件复核、证据汇总和融合前置流程。",
    provider: "minimax",
    model: "MiniMax-M2.7",
    maxIterations: 1,
    stateless: true,
    reasoning: false,
    maxOutputTokens: 2048,
    toolFilter: { mode: "allowlist", tools: [] },
    systemPrompt: [
      "你是社交总控 Agent。",
      "你的职责是根据候选事件调度各平台智能体复核同一事件，并要求每个平台返回 found 或 not_found 的结构化证据。",
      "不要执行 Kan 推送，推送只进入干跑队列。",
    ].join("\n"),
  },
  platformAgent({
    id: "x-social-agent",
    name: "X 社交智能体",
    description: "分析 X/Twitter 平台异常传播速度、参与账号和主要来源。",
    tool: "crawl_x_social",
    prompt:
      "你是 X 平台情报智能体。重点判断传播速度、参与规模、来源地区、话题标签、核心账号，以及事件是否正在快速扩散。",
  }),
  platformAgent({
    id: "telegram-social-agent",
    name: "Telegram 社交智能体",
    description: "分析 Telegram 频道传播路径、共同内容占比和桥接频道。",
    tool: "crawl_telegram_social",
    prompt:
      "你是 Telegram 平台情报智能体。重点判断频道传播路径、共同内容占比、最早传播频道、桥接频道，以及内容是否跨频道集群扩散。",
  }),
  platformAgent({
    id: "lihkg-social-agent",
    name: "LIHKG 社交智能体",
    description: "分析 LIHKG 热门讨论、热度、参与人数和观点分布。",
    tool: "crawl_lihkg_social",
    prompt:
      "你是 LIHKG 平台情报智能体。重点判断热门帖子、热度、参与人数、立场分布和主要观点。",
  }),
  platformAgent({
    id: "facebook-social-agent",
    name: "Facebook 社交智能体",
    description: "分析 Facebook 页面扩散、新增互动、传播用户和影响区域。",
    tool: "crawl_facebook_social",
    prompt:
      "你是 Facebook 平台情报智能体。重点判断页面扩散、新增互动、传播用户、影响区域、转载链路和影响范围。",
  }),
  platformAgent({
    id: "github-social-agent",
    name: "GitHub 社交智能体",
    description: "分析 GitHub 仓库、议题、组织和用户公开活动中的事件线索。",
    tool: "crawl_github_social",
    prompt:
      "你是 GitHub 平台情报智能体。重点判断仓库、议题、提交、组织、用户和事件复核条件是否指向同一公共事件。",
  }),
  platformAgent({
    id: "instagram-social-agent",
    name: "Instagram 社交智能体",
    description: "分析 Instagram/Threads 账号、话题和帖子扩散线索。",
    tool: "crawl_instagram_social",
    prompt:
      "你是 Instagram/Threads 平台情报智能体。重点判断公开账号、话题、帖子、共同文本和互动变化。",
  }),
  platformAgent({
    id: "lien-social-agent",
    name: "Lien 社交智能体",
    description: "分析 Lien/LinkedIn 公开资料、公司主页和帖子事件线索。",
    tool: "crawl_lien_social",
    prompt:
      "你是 Lien/LinkedIn 平台情报智能体。重点判断公开资料、公司页面、帖子和候选事件条件是否相关。",
  }),
  platformAgent({
    id: "netlight-social-agent",
    name: "NetLight 社交智能体",
    description: "分析 NetLight/Matrix 房间消息中的事件传播线索。",
    tool: "crawl_netlight_social",
    prompt:
      "你是 NetLight/Matrix 平台情报智能体。重点判断房间、消息源、重复文本和传播节点。",
  }),
  platformAgent({
    id: "ptt-social-agent",
    name: "PTT 社交智能体",
    description: "分析 PTT 看板文章、推文和事件传播线索。",
    tool: "crawl_ptt_social",
    prompt:
      "你是 PTT 平台情报智能体。重点判断看板、文章、作者、推文和候选事件条件是否属于同一事件。",
  }),
  platformAgent({
    id: "youtube-social-agent",
    name: "YouTube 社交智能体",
    description: "分析 YouTube 频道、视频和评论区事件传播线索。",
    tool: "crawl_youtube_social",
    prompt:
      "你是 YouTube 平台情报智能体。重点判断频道、视频、标题、描述、评论和传播节点是否属于同一事件。",
  }),
  {
    id: "social-fusion-agent",
    category: "orchestrator",
    name: "社交融合智能体",
    description: "聚合各平台报告，判断同一事件、影响等级、趋势和传播路径。",
    provider: "minimax",
    model: "MiniMax-M2.7",
    maxIterations: 1,
    stateless: true,
    reasoning: false,
    maxOutputTokens: 4096,
    toolFilter: { mode: "allowlist", tools: ["fuse_social_reports"] },
    systemPrompt: [
      "你是中央社交融合智能体。",
      "你需要把各平台报告融合成一个事件判断：确认是否为同一事件，推断平台传播顺序，总结核心传播节点，并给出影响等级。",
      "只能使用输入提供的平台报告。不要编造私人身份或隐藏关系。",
      "只有当输入支持时，才可以基于公开账号、页面、频道、帖子、URL、媒体哈希和重复文本推断公开传播关系。",
      "只返回符合指定 schema 的合法 JSON。",
    ].join("\n"),
  },
] as const;
