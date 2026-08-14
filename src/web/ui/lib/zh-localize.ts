const TEXT_REPLACEMENTS = new Map<string, string>([
  ["Loading", "加载中"],
  ["LOADING", "加载中"],
  ["Connecting...", "连接中..."],
  ["Connected", "已连接"],
  ["CONNECTED", "已连接"],
  ["Reconnecting", "重连中"],
  ["LIVE", "实时"],
  ["live", "实时"],
  ["polling", "轮询"],
  ["System Status", "系统状态"],
  ["SYSTEM STATUS", "系统状态"],
  ["All Systems Online", "所有系统在线"],
  ["Partial Connectivity", "部分连接"],
  ["Systems Offline", "系统离线"],
  ["Operational", "运行正常"],
  ["Degraded", "部分降级"],
  ["Down", "离线"],
  ["Uptime", "运行时间"],
  ["UPTIME", "运行时间"],
  ["Sessions", "会话"],
  ["SESSIONS", "会话"],
  ["Version", "版本"],
  ["VERSION", "版本"],
  ["Operations", "运行概况"],
  ["OPERATIONS", "运行概况"],
  ["Token Usage", "模型用量"],
  ["TOKEN USAGE", "模型用量"],
  ["Agents", "智能体"],
  ["AGENTS", "智能体"],
  ["Processes", "进程"],
  ["PROCESSES", "进程"],
  ["Cron Jobs", "定时任务"],
  ["CRON JOBS", "定时任务"],
  ["Memory", "记忆"],
  ["MEMORY", "记忆"],
  ["Channels", "渠道"],
  ["CHANNELS", "渠道"],
  ["Access Token", "访问令牌"],
  ["Auth enabled", "已启用认证"],
  ["Token configured", "令牌已配置"],
  ["Token saved.", "令牌已保存。"],
  ["Invalid token.", "令牌无效。"],
  ["Token cleared. Refresh to re-enter.", "令牌已清除。刷新后重新输入。"],
  ["registered", "已注册"],
  ["scheduler active", "调度器运行中"],
  ["scheduler stopped", "调度器已停止"],
  ["channels active", "个渠道在线"],
  ["healthy", "健康"],
  ["spent", "已花费"],
  ["requests", "次请求"],
  ["sources", "来源"],
  ["tokens indexed", "已索引 tokens"],
  ["in", "输入"],
  ["out", "输出"],
  ["connected", "已连接"],
  ["preview", "预览"],
  ["alive", "存活"],
  ["stale", "心跳过期"],
  ["dead", "已停止"],
  ["New Agent", "新建智能体"],
  ["Create Agent", "创建智能体"],
  ["Configure a new AI agent", "配置新的 AI 智能体"],
  ["Update agent configuration", "更新智能体配置"],
  ["Basic", "基础"],
  ["Model", "模型"],
  ["Tools & Skills", "工具与技能"],
  ["Advanced", "高级"],
  ["Identity", "身份"],
  ["Start from Template", "从模板开始"],
  ["Model Configuration", "模型配置"],
  ["Provider", "服务商"],
  ["Max Iterations", "最大迭代次数"],
  ["Max Input Length", "最大输入长度"],
  ["Max Input Length (0 = no limit)", "最大输入长度（0 表示不限）"],
  ["Extended Thinking", "扩展思考"],
  ["Thinking Mode", "思考模式"],
  ["Thinking Budget (tokens)", "思考预算（tokens）"],
  ["Effort Level", "推理强度"],
  ["System Prompt", "系统提示词"],
  ["Tool Access", "工具权限"],
  ["Mode", "模式"],
  ["All tools", "全部工具"],
  ["Allowlist", "允许列表"],
  ["Blocklist", "屏蔽列表"],
  ["Select all", "全选"],
  ["Clear all", "清空全部"],
  ["Preloaded Skills", "预加载技能"],
  ["No skills available", "暂无可用技能"],
  ["Sub-Agents", "子智能体"],
  ["Allowed Agents", "允许的智能体"],
  ["Max Children", "最大子智能体数"],
  ["MCP Servers", "MCP 服务器"],
  ["Hooks", "钩子"],
  ["Audit Log", "审计日志"],
  ["Notification Forwarding", "通知转发"],
  ["Notifications", "通知"],
  ["Telegram", "Telegram"],
  ["Bot Token", "机器人令牌"],
  ["Cancel", "取消"],
  ["Confirm", "确认"],
  ["Close", "关闭"],
  ["Delete", "删除"],
  ["Edit", "编辑"],
  ["Save", "保存"],
  ["Saving...", "保存中..."],
  ["Creating...", "创建中..."],
  ["Save Changes", "保存修改"],
  ["Delete Agent", "删除智能体"],
  ["Set as Default", "设为默认"],
  ["Edit Agent", "编辑智能体"],
  ["Default", "默认"],
  ["Enabled", "已启用"],
  ["Off", "关闭"],
  ["Yes", "是"],
  ["No", "否"],
  ["None", "无"],
  ["Allowed", "已允许"],
  ["Blocked", "已屏蔽"],
  ["All tools available", "所有工具均可用"],
  ["No system prompt configured", "未配置系统提示词"],
  ["Failed to load agent details", "智能体详情加载失败"],
  ["Loading details...", "正在加载详情..."],
  ["Alibaba Token Plan", "阿里云 Token 配置"],
  ["Configured", "已配置"],
  ["Not set", "未设置"],
  ["API Key", "API 密钥"],
  ["Base URL (optional)", "Base URL（可选）"],
  ["Update", "更新"],
  ["Remove", "移除"],
  ["Loading...", "加载中..."],
  ["Chat", "对话"],
  ["Talk to your agent directly", "直接与智能体对话"],
  ["Clear", "清空"],
  ["Start a conversation", "开始对话"],
  ["Skills", "技能"],
  ["Create Skill", "创建技能"],
  ["Edit Skill", "编辑技能"],
  ["Create and manage skill definitions for your agents", "创建和管理智能体技能定义"],
  ["Load File", "加载文件"],
  ["AI Generate", "AI 生成"],
  ["Failed to load skills", "技能加载失败"],
  ["No skills match your search.", "没有匹配的技能。"],
  ["Name", "名称"],
  ["Description", "描述"],
  ["Content", "内容"],
  ["Templates", "模板"],
  ["Blank Skill", "空白技能"],
  ["Start from scratch", "从空白开始"],
  ["Code Review", "代码审查"],
  ["Data Analysis", "数据分析"],
  ["API Design", "API 设计"],
  ["Content Writing", "内容写作"],
  ["AI Skill Generator", "AI 技能生成器"],
  ["Describe the skill you want", "描述你想要的技能"],
  ["Try one of these:", "可以试试这些："],
  ["Generating skill...", "正在生成技能..."],
  ["Skill generated", "技能已生成"],
  ["Content Preview", "内容预览"],
  ["Waiting for response...", "等待响应..."],
  ["Try Again", "重试"],
  ["Stop", "停止"],
  ["Generate", "生成"],
  ["Use This Skill", "使用这个技能"],
  ["Retry", "重试"],
  ["Delete this skill?", "删除这个技能？"],
  ["No content defined for this skill.", "这个技能还没有定义内容。"],
  ["Something went wrong", "页面出错了"],
  ["Try again", "重试"],
  ["Failed to load sessions", "会话加载失败"],
  ["Failed to load metrics. Will retry.", "指标加载失败，稍后会重试。"],
  ["Failed to load channels", "渠道加载失败"],
  ["Routing Rules", "路由规则"],
  ["Route messages to agents based on channel, chat, or pattern", "按渠道、聊天或模式把消息分配给指定智能体"],
  ["Add Rule", "添加规则"],
  ["No routing rules configured. Add a rule to route messages to specific agents.", "暂无路由规则。添加规则后可将消息路由到指定智能体。"],
  ["Tools", "工具"],
  ["Search tools...", "搜索工具..."],
  ["Show disabled", "显示已停用"],
  ["disabled", "已停用"],
  ["All", "全部"],
  ["Category", "分类"],
  ["Parameters", "参数"],
  ["Play Store", "Play Store"],
  ["Scrape Now", "立即抓取"],
  ["Scrape Trending", "抓取趋势"],
  ["Scrape", "抓取"],
  ["Scraping...", "抓取中..."],
  ["Scraping…", "抓取中..."],
  ["Backfill RAG", "补写 RAG"],
  ["Add Account", "添加账号"],
  ["Top Apps", "热门应用"],
  ["Discovered", "已发现"],
  ["Reviews", "评论"],
  ["Top Free", "免费榜"],
  ["Top Paid", "付费榜"],
  ["No rankings", "暂无排名"],
  ["No rankings data yet.", "暂无排名数据。"],
  ["No apps for this filter.", "这个筛选条件下暂无应用。"],
  ["Untitled Workflow", "未命名工作流"],
  ["Description (optional)...", "描述（可选）..."],
  ["Workflow name...", "工作流名称..."],
  ["Nodes", "节点"],
  ["NODES", "节点"],
  ["Trigger", "触发器"],
  ["Agent", "智能体"],
  ["Tool", "工具"],
  ["Skill", "技能"],
  ["Condition", "条件"],
  ["Transform", "转换"],
  ["Output", "输出"],
  ["Start the workflow", "启动工作流"],
  ["Run an AI agent", "运行 AI 智能体"],
  ["Execute a tool", "执行工具"],
  ["Apply a skill", "应用技能"],
  ["Branch on expression", "按表达式分支"],
  ["Map / reshape data", "映射或重组数据"],
  ["Return or send result", "返回或发送结果"],
  ["Properties", "属性"],
  ["Label", "标签"],
  ["Node label", "节点标签"],
  ["Delete node", "删除节点"],
  ["Saved Workflows", "已保存工作流"],
  ["No saved workflows yet.", "暂无已保存工作流。"],
  ["Delete Workflow", "删除工作流"],
  ["Import Workflow", "导入工作流"],
  ["Upload JSON file", "上传 JSON 文件"],
  ["Choose .json file", "选择 .json 文件"],
  ["Paste JSON", "粘贴 JSON"],
  ["New", "新建"],
  ["Load", "加载"],
  ["Import", "导入"],
  ["Export", "导出"],
  ["Run", "运行"],
  ["Running", "运行中"],
  ["Running...", "运行中..."],
  ["Stopped", "已停止"],
  ["Disabled", "已停用"],
  ["Active Sessions", "活跃会话"],
  ["No active sessions", "暂无活跃会话"],
  ["Channel", "渠道"],
  ["Chat ID", "聊天 ID"],
  ["Last Active", "最近活跃"],
  ["Created", "创建时间"],
  ["Open", "打开"],
  ["Channel Status", "渠道状态"],
  ["Configure", "配置"],
  ["Hide", "收起"],
  ["Restart", "重启"],
  ["Connected", "已连接"],
  ["Disconnected", "未连接"],
  ["Not configured", "未配置"],
  ["Status", "状态"],
  ["QR Code", "二维码"],
  ["Pairing Code", "配对码"],
  ["Get Code", "获取配对码"],
  ["Requesting...", "请求中..."],
  ["Waiting for QR code...", "等待二维码..."],
  ["No setup form available for this channel.", "这个渠道暂无配置表单。"],
  ["Failed to load data — the API may be unreachable.", "数据加载失败，API 可能暂时不可用。"],
  ["Failed to load products", "产品加载失败"],
  ["No products yet. Click \"Scrape Now\" to fetch.", "暂无产品。点击“立即抓取”获取数据。"],
  ["Scrape failed. Check API credentials.", "抓取失败，请检查 API 凭据。"],
  ["RAG backfill failed", "RAG 补写失败"],
  ["Add Reddit Account", "添加 Reddit 账号"],
  ["Label", "标签"],
  ["Cookies JSON", "Cookies JSON"],
  ["e.g. Main Reddit Account...", "例如：主 Reddit 账号..."],
  ["Paste full cookie export JSON array from browser extension (e.g. Cookie Quick Manager)...", "粘贴浏览器扩展导出的完整 cookie JSON 数组..."],
  ["Export all cookies from reddit.com using a browser extension and paste the JSON array here. Must include the reddit_session cookie.", "使用浏览器扩展导出 reddit.com 的全部 cookies，并把 JSON 数组粘贴到这里。必须包含 reddit_session cookie。"],
  ["Label and cookies JSON are required", "标签和 cookies JSON 必填"],
  ["Invalid JSON - paste the full cookie export array", "JSON 无效，请粘贴完整的 cookie 导出数组"],
  ["Failed to create account", "账号创建失败"],
  ["Verify", "验证"],
  ["Last scraped:", "最近抓取："],
  ["No X accounts", "暂无 X 账号"],
  ["Add your first X account to get started.", "添加第一个 X 账号后即可开始。"],
  ["Scrape Search", "抓取搜索结果"],
  ["Hottest", "最热"],
  ["Most Stars", "星标最多"],
  ["Most Forks", "Fork 最多"],
  ["Newest", "最新"],
  ["Daily + Weekly", "每日 + 每周"],
  ["Today", "今天"],
  ["This week", "本周"],
  ["All languages", "全部语言"],
  ["No repos yet. Click \"Scrape Now\" to fetch.", "暂无仓库。点击“立即抓取”获取数据。"],
  ["Failed to load repos", "仓库加载失败"],
  ["Total stars", "总星标数"],
  ["Forks", "Fork 数"],
  ["upvotes", "个赞"],
  ["comments", "条评论"],
  ["reviews", "条评论"],
  ["week", "本周"],
  ["day", "今天"],
  ["stars", "星标"],
  ["forks", "Fork"],
  ["Config saved.", "配置已保存。"],
  ["Failed to save config.", "配置保存失败。"],
  ["Failed to load scraper config.", "爬虫配置加载失败。"],
  ["Loading config…", "正在加载配置..."],
  ["Refresh", "刷新"],
  ["Other", "其他"],
  ["Synced", "已同步"],
  ["Starting", "启动中"],
  ["Restarting", "重启中"],
  ["Crash loop", "崩溃循环"],
  ["Keyword Research", "关键词研究"],
  ["App Store keyword opportunities — feed the strongest ones into the ideas pipeline.", "App Store 关键词机会，可把最强的线索送入创意管线。"],
  ["Generate ideas from these keywords", "基于这些关键词生成创意"],
  ["Keywords", "关键词"],
  ["Concepts", "概念"],
  ["Screener", "筛选器"],
  ["Indie sweet spot", "独立开发机会"],
  ["Heating", "升温"],
  ["Min demand", "最低需求"],
  ["Any", "不限"],
  ["Max competitiveness", "最高竞争度"],
  ["Min incumbent weakness", "最低存量弱点"],
  ["Min opportunity", "最低机会"],
  ["Min buildability", "最低可构建性"],
  ["Trend", "趋势"],
  ["Hide junk", "隐藏低质项"],
  ["Search all keywords…", "搜索全部关键词..."],
  ["Rows per page", "每页行数"],
  ["Prev", "上一页"],
  ["Next", "下一页"],
  ["Idea Pipelines", "创意管线"],
  ["AI-powered idea generation from all your data sources", "基于全部数据源的 AI 创意生成"],
  ["Generator", "生成器"],
  ["Pipeline Ideas", "管线创意"],
  ["Search ideas...", "搜索创意..."],
  ["Failed to load pipeline ideas", "管线创意加载失败"],
  ["Idea archived", "创意已归档"],
  ["Idea validated", "创意已验证"],
  ["Idea restored", "创意已恢复"],
  ["Failed to update idea", "创意更新失败"],
  ["this run:", "本次运行："],
  ["lessons injected", "已注入经验"],
  ["pending", "等待中"],
  ["completed", "已完成"],
  ["failed", "失败"],
  ["empty", "空结果"],
  ["interrupted", "已中断"],
  ["App Landscape", "应用格局"],
  ["Reviews", "评论"],
  ["Capabilities", "能力"],
  ["Deep Search", "深度搜索"],
  ["Synthesize", "合成"],
  ["Validate", "验证"],
  ["Store", "存储"],
  ["Trends", "趋势"],
  ["Pain Points", "痛点"],
  ["Collect", "收集"],
  ["Signals", "信号"],
  ["Analysis", "分析"],
  ["Strategic Idea Generation Engine", "战略创意生成引擎"],
  ["Session Detail", "会话详情"],
  ["Session started successfully.", "会话已成功启动。"],
  ["Failed to start session. Please try again.", "会话启动失败，请重试。"],
  ["Loading sessions...", "正在加载会话..."],
  ["Game-theoretic multi-agent simulation for strategically robust idea generation", "通过博弈论多智能体模拟生成更稳健的战略创意"],
  ["Seed Input", "种子输入"],
  ["Enter the strategic question, market data, competitive landscape, or any context for the idea generation engine...", "输入战略问题、市场数据、竞争格局，或任何给创意生成引擎使用的上下文..."],
  ["Advanced Config", "高级配置"],
  ["Start Session", "启动会话"],
  ["Fast Agent (auto)", "快速智能体（自动）"],
  ["Judge 0", "评审 0"],
  ["Judge 1", "评审 1"],
  ["Judge 2", "评审 2"],
  ["SIGE Ideas", "SIGE 创意"],
  ["Game-theoretic ideas aggregated across all runs", "聚合所有运行的博弈论创意"],
  ["All ideas produced by SIGE across every run and round, ranked by score", "按分数排序展示 SIGE 在所有运行和轮次中生成的创意"],
  ["Failed to load ideas:", "创意加载失败："],
  ["All rounds", "全部轮次"],
  ["Final only", "仅最终结果"],
  ["Top score", "最高分"],
  ["Newest run", "最新运行"],
  ["Any score", "不限分数"],
  ["10 runs", "10 次运行"],
  ["25 runs", "25 次运行"],
  ["50 runs", "50 次运行"],
  ["Sort ideas", "创意排序"],
  ["Sessions to scan", "扫描会话数"],
  ["No sessions yet", "暂无会话"],
  ["Start a new session by entering a seed input above. The engine will run a multi-agent game simulation and return ranked, strategically robust ideas.", "在上方输入种子内容启动新会话。引擎会运行多智能体博弈模拟，并返回按分数排序的稳健创意。"],
  ["News", "新闻源"],
  ["Calendar", "经济日历"],
  ["Search", "搜索"],
  ["Trending", "趋势"],
  ["all", "全部"],
  ["idea", "创意"],
  ["validated", "已验证"],
  ["archived", "已归档"],
]);

const ATTRIBUTE_NAMES = [
  "placeholder",
  "title",
  "aria-label",
  "alt",
  "value",
] as const;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function preserveOuterWhitespace(original: string, replacement: string): string {
  const leading = original.match(/^\s*/)?.[0] ?? "";
  const trailing = original.match(/\s*$/)?.[0] ?? "";
  return `${leading}${replacement}${trailing}`;
}

function dynamicReplacement(value: string): string | null {
  const text = normalize(value);
  const exact = TEXT_REPLACEMENTS.get(text);
  if (exact) return exact;

  let match = /^(\d+)\s+channels$/.exec(text);
  if (match) return `${match[1]} 个渠道`;
  match = /^(\d+)\s+sessions$/.exec(text);
  if (match) return `${match[1]} 个会话`;
  match = /^(\d+)\s+selected$/.exec(text);
  if (match) return `已选择 ${match[1]} 个`;
  match = /^(\d+)\s+tools$/.exec(text);
  if (match) return `${match[1]} 个工具`;
  match = /^(\d+)\s+enabled,\s+(\d+)\s+disabled$/.exec(text);
  if (match) return `${match[1]} 个已启用，${match[2]} 个已停用`;
  match = /^(\d+)\s+requests$/.exec(text);
  if (match) return `${match[1]} 次请求`;
  match = /^(\d+)\s+jobs$/.exec(text);
  if (match) return `${match[1]} 个任务`;
  match = /^(\d+)\s+accounts configured$/.exec(text);
  if (match) return `已配置 ${match[1]} 个账号`;
  match = /^(\d+)\s+products\s+·\s+Last updated:\s+(.+)$/.exec(text);
  if (match) return `${match[1]} 个产品 · 最近更新：${match[2]}`;
  match = /^(\d+)\s+posts\s+\|\s+(\d+)\s+subreddits\s+\|\s+Last updated:\s+(.+)$/.exec(text);
  if (match) return `${match[1]} 条帖子 | ${match[2]} 个社区 | 最近更新：${match[3]}`;
  match = /^(\d+)\s+repos\s+\|\s+(\d+)\s+languages\s+\|\s+Last updated:\s+(.+)$/.exec(text);
  if (match) return `${match[1]} 个仓库 | ${match[2]} 种语言 | 最近更新：${match[3]}`;
  match = /^(\d+)\s+upvotes$/.exec(text);
  if (match) return `${match[1]} 个赞`;
  match = /^(\d+)\s+comments$/.exec(text);
  if (match) return `${match[1]} 条评论`;
  match = /^(\d+)\s+reviews$/.exec(text);
  if (match) return `${match[1]} 条评论`;
  match = /^(\d+)\s+posts$/.exec(text);
  if (match) return `${match[1]} 条帖子`;
  match = /^Indexed\s+(\d+)\s+(articles|posts|products)$/.exec(text);
  if (match) return `已索引 ${match[1]} 条内容`;
  match = /^Trending\s+\((\d+)\)$/.exec(text);
  if (match) return `趋势（${match[1]}）`;
  match = /^Search\s+\((\d+)\)$/.exec(text);
  if (match) return `搜索（${match[1]}）`;
  match = /^Showing\s+(.+)\s+of\s+(.+)$/.exec(text);
  if (match) return `显示 ${match[1]} / ${match[2]}`;
  match = /^Page\s+(\d+)\s+of\s+(\d+)$/.exec(text);
  if (match) return `第 ${match[1]} / ${match[2]} 页`;
  match = /^(\d+)\s+ideas generated by AI pipelines$/.exec(text);
  if (match) return `AI 管线已生成 ${match[1]} 个创意`;
  match = /^all(\d+)$/.exec(text);
  if (match) return `全部 ${match[1]}`;
  match = /^(\d+)\s+steps$/.exec(text);
  if (match) return `${match[1]} 个步骤`;
  match = /^(\d+)\s+error(s)?$/.exec(text);
  if (match) return `${match[1]} 个错误`;
  match = /^(\d+)\s+apps\s+·\s+(\d+)\s+reviews\s+·\s+(\d+)\s+categories\s+·\s+Updated\s+(.+)$/.exec(text);
  if (match) return `${match[1]} 个应用 · ${match[2]} 条评论 · ${match[3]} 个分类 · 更新于 ${match[4]}`;
  match = /^(\d+)\s+allowed$/.exec(text);
  if (match) return `${match[1]} 个已允许`;
  match = /^(\d+)\s+blocked$/.exec(text);
  if (match) return `${match[1]} 个已屏蔽`;
  match = /^(\d+)\/(\d+)\s+healthy$/.exec(text);
  if (match) return `${match[1]}/${match[2]} 健康`;
  match = /^(.+)\s+spent\s+·\s+(.+)\s+requests$/.exec(text);
  if (match) return `${match[1]} 已花费 · ${match[2]} 次请求`;
  match = /^(.+)\s+sources$/.exec(text);
  if (match) return `${match[1]} 个来源`;
  match = /^(.+)\s+agents$/.exec(text);
  if (match) return `${match[1]} 个智能体`;
  match = /^(.+)\s+tokens indexed$/.exec(text);
  if (match) return `已索引 ${match[1]} tokens`;
  match = /^next in (.+)$/.exec(text);
  if (match) return `下次执行：${match[1]}`;

  return null;
}

function localizeTextValue(value: string): string | null {
  const replacement = dynamicReplacement(value);
  return replacement ? preserveOuterWhitespace(value, replacement) : null;
}

function shouldSkipTextNode(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return shouldSkipElement(parent);
}

function shouldSkipElement(element: Element): boolean {
  const tag = element.tagName;
  return (
    ["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "SVG"].includes(tag) ||
    element.closest("[data-no-localize]") !== null
  );
}

function localizeElement(element: Element): void {
  if (shouldSkipElement(element)) return;
  for (const name of ATTRIBUTE_NAMES) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const next = localizeTextValue(value);
    if (next && next !== value) element.setAttribute(name, next);
  }
}

function localizeNode(root: Node): void {
  if (root.nodeType === Node.ELEMENT_NODE) {
    localizeElement(root as Element);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE && !shouldSkipTextNode(node)) {
      const value = node.nodeValue ?? "";
      const next = localizeTextValue(value);
      if (next && next !== value) node.nodeValue = next;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      localizeElement(node as Element);
    }
    node = walker.nextNode();
  }
}

export function installChineseLocalizer(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const run = () => localizeNode(document.body);
  run();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        localizeNode(node);
      }
      if (
        mutation.type === "characterData" &&
        mutation.target.nodeType === Node.TEXT_NODE
      ) {
        const value = mutation.target.nodeValue ?? "";
        const next = localizeTextValue(value);
        if (next && next !== value) mutation.target.nodeValue = next;
      }
      if (
        mutation.type === "attributes" &&
        mutation.target.nodeType === Node.ELEMENT_NODE
      ) {
        localizeElement(mutation.target as Element);
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTE_NAMES],
  });

  return () => observer.disconnect();
}
