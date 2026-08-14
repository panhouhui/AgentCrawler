import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import { cn } from "../lib/cn";
import { LoadingState, EmptyState, PageHeader, SearchBar, FilterTabs, Toggle } from "../components";

interface ToolInfo {
  name: string;
  category: string;
  description: string;
  params: string[];
  enabled: boolean;
}

interface ToolsResponse {
  success: boolean;
  data: ToolInfo[];
  categories: Record<string, string>;
  disabledTools: string[];
}

const TOOL_NAME_LABELS: Record<string, string> = {
  bash: "执行命令",
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "编辑文件",
  list_files: "列出文件",
  grep: "文本搜索",
  glob: "文件匹配",
  list_skills: "列出技能",
  use_skill: "使用技能",
  list_agents: "列出智能体",
  spawn_agent: "启动子智能体",
  cron: "管理定时任务",
  trigger_cron: "触发定时任务",
  remember: "写入长期记忆",
  search_memory: "搜索长期记忆",
  search_news: "搜索新闻",
  get_news_digest: "获取新闻摘要",
  get_calendar: "查看经济日历",
  get_scraper_status: "查看爬虫状态",
  get_subagent_runs: "查看子智能体运行",
  get_scraper_runs: "查看爬虫运行",
  db_query: "数据库查询",
  get_process_logs: "查看进程日志",
  get_process_health: "查看进程健康",
  process_manage: "管理进程",
  list_mcp_capabilities: "列出 MCP 能力",
  websearch: "网页搜索",
  webscrape: "网页抓取",
  lookupdocs: "查询文档",
  project_context: "读取项目上下文",
  validate_code: "验证代码",
  run_tests: "运行测试",
  deploy: "部署",
  self_restart: "自我重启",
  social_gate: "中国相关性判断",
  social_platform_report: "平台事件报告",
  social_fusion: "社交融合分析",
  crawler_probe: "爬虫轻量探测",
};

const PARAM_LABELS: Record<string, string> = {
  action: "动作",
  agentId: "智能体 ID",
  channel: "渠道",
  chatId: "会话 ID",
  command: "命令",
  content: "内容",
  crawler: "爬虫",
  cwd: "工作目录",
  days: "天数",
  directory: "目录",
  dry_run: "干跑",
  evidence: "证据",
  event: "事件",
  file: "文件",
  filePath: "文件路径",
  filter: "筛选",
  input: "输入",
  keyword: "关键词",
  limit: "数量上限",
  message: "消息",
  metrics: "指标",
  path: "路径",
  pattern: "匹配模式",
  platform: "平台",
  platform_reports: "平台报告",
  query: "查询",
  reason: "原因",
  source: "来源",
  summary: "摘要",
  china_relevance: "中国相关性",
  text: "文本",
  timeout: "超时",
  title: "标题",
  tool: "工具",
  value: "值",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  core: "用于读取、搜索、编辑文件以及执行本地命令。",
  skills: "用于查看和调用可复用技能。",
  agents: "用于查看智能体或启动子智能体执行任务。",
  scheduling: "用于管理、触发和查看定时任务。",
  memory: "用于写入或检索长期记忆。",
  news: "用于搜索新闻、摘要和日历事件。",
  observability: "用于查看运行状态和历史记录。",
  database: "用于执行受控数据库查询。",
  process: "用于查看进程、日志和健康状态。",
  mcp: "用于调用外部 MCP 能力。",
  development: "用于项目上下文、代码验证和测试。",
  system: "用于系统级维护操作。",
  social: "用于社交事件发现、复核和融合。",
  crawler: "用于调用已有爬虫做轻量探测。",
  research: "用于通用研究和资料检索。",
};

const HIDDEN_LEGACY_TOOL_CATEGORIES = new Set([
  "product_hunt",
  "hacker_news",
  "reddit",
  "github",
  "x_timeline",
  "appstore",
  "playstore",
]);

const HIDDEN_LEGACY_TOOL_NAMES = new Set([
  "search_products",
  "get_product_digest",
  "search_hn",
  "get_hn_digest",
  "search_reddit",
  "get_reddit_digest",
  "get_github_repos",
  "search_github_repos",
  "search_x_timeline",
  "get_timeline_digest",
  "get_liked_tweets",
  "get_x_analytics",
  "get_appstore_rankings",
  "get_appstore_complaints",
  "search_appstore_reviews",
  "search_appstore_apps",
  "get_playstore_rankings",
  "get_playstore_complaints",
  "search_playstore_reviews",
  "search_playstore_apps",
]);

function isLegacyProductTool(tool: ToolInfo): boolean {
  return (
    HIDDEN_LEGACY_TOOL_CATEGORIES.has(tool.category) ||
    HIDDEN_LEGACY_TOOL_NAMES.has(tool.name)
  );
}

function toolDisplayName(name: string): string {
  return TOOL_NAME_LABELS[name] ?? name.replace(/_/g, " ");
}

function paramDisplayName(name: string): string {
  return PARAM_LABELS[name] ?? name.replace(/_/g, " ");
}

function toolDescription(tool: ToolInfo): string {
  if (/[\u4e00-\u9fff]/.test(tool.description)) return tool.description;
  return CATEGORY_DESCRIPTIONS[tool.category] ?? "用于智能体执行对应任务的内部工具。";
}

function ToolCard({
  tool,
  index,
  isSelected,
  onSelect,
  onToggle: _onToggle,
}: {
  tool: ToolInfo;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative bg-bg-1 border rounded-lg overflow-hidden text-left w-full transition-all duration-200",
        "hover:border-border-hover hover:bg-bg-1/80",
        isSelected
          ? "border-accent border-l-[3px] border-l-accent"
          : "border-border border-l-[3px] border-l-transparent",
        !tool.enabled && "opacity-45",
      )}
      style={{
        animation: `agCardIn 0.3s ease-out ${index * 20}ms both`,
      }}
    >
      <button
        type="button"
        className="w-full text-left px-4 py-3 cursor-pointer bg-transparent border-0"
        onClick={onSelect}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-semibold text-strong truncate">
            {toolDisplayName(tool.name)}
          </span>
          {!tool.enabled && (
            <span className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-bg-2 text-faint">
              已停用
            </span>
          )}
        </div>
        <div className="font-mono text-[11px] text-faint mb-1.5 truncate">
          {tool.name}
        </div>
        <p className="text-xs text-muted m-0 leading-relaxed line-clamp-2">
          {toolDescription(tool)}
        </p>
        {tool.params.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tool.params.slice(0, 4).map((p) => (
              <span
                key={p}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-2 text-faint"
              >
                {paramDisplayName(p)}
              </span>
            ))}
            {tool.params.length > 4 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-2 text-faint">
                +{tool.params.length - 4}
              </span>
            )}
          </div>
        )}
      </button>
    </div>
  );
}

function DetailPanel({
  tool,
  categoryLabel,
  onClose,
  onToggle,
}: {
  tool: ToolInfo;
  categoryLabel: string;
  onClose: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="bg-bg-1 border border-border rounded-xl p-6 sticky top-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-strong m-0">
            {toolDisplayName(tool.name)}
          </h3>
          <div className="font-mono text-xs text-faint mt-1 truncate">
            {tool.name}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Toggle
            checked={tool.enabled}
            onChange={() => onToggle()}
          />
          <button
            type="button"
            className="w-7 h-7 rounded-md border border-border bg-transparent text-muted cursor-pointer flex items-center justify-center hover:bg-bg-2 hover:text-strong transition-colors"
            onClick={onClose}
            aria-label="关闭面板"
          >
            &times;
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <span className="text-[10px] text-faint uppercase tracking-widest font-semibold">
            分类
          </span>
          <p className="text-sm text-foreground m-0 mt-1">{categoryLabel}</p>
        </div>

        <div>
          <span className="text-[10px] text-faint uppercase tracking-widest font-semibold">
            描述
          </span>
          <p className="text-sm text-foreground m-0 mt-1 leading-relaxed">
            {toolDescription(tool)}
          </p>
        </div>

        {tool.params.length > 0 && (
          <div>
            <span className="text-[10px] text-faint uppercase tracking-widest font-semibold">
              参数
            </span>
            <div className="mt-2 space-y-1">
              {tool.params.map((p) => (
                <div
                  key={p}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-bg-2"
                >
                  <span className="text-xs text-foreground">{paramDisplayName(p)}</span>
                  <span className="font-mono text-[10px] text-faint">{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Tools() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);
  const [showDisabled, setShowDisabled] = useState(true);
  const [manuallyDisabled, setManuallyDisabled] = useState<Set<string>>(new Set());

  const loadTools = useCallback(async () => {
    try {
      const res = await apiFetch<ToolsResponse>("/api/tools");
      const visibleTools = res.data.filter((tool) => !isLegacyProductTool(tool));
      setTools(visibleTools);
      setCategories(res.categories);
      setManuallyDisabled(new Set(res.disabledTools ?? []));
      setError("");
    } catch {
      setError("工具加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const toggleTool = useCallback(
    async (toolName: string) => {
      // Only toggle manually disabled state
      const wasManuallyDisabled = manuallyDisabled.has(toolName);
      const newDisabled = new Set(manuallyDisabled);
      if (wasManuallyDisabled) {
        newDisabled.delete(toolName);
      } else {
        newDisabled.add(toolName);
      }
      setManuallyDisabled(newDisabled);

      // Optimistic update on tool list
      const updated = tools.map((t) =>
        t.name === toolName ? { ...t, enabled: wasManuallyDisabled ? true : false } : t,
      );
      setTools(updated);
      setSelectedTool((prev) =>
        prev?.name === toolName ? { ...prev, enabled: wasManuallyDisabled } : prev,
      );

      try {
        await apiFetch("/api/tools/disabled", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disabled: [...newDisabled] }),
        });
        // Reload to get accurate feature-based state
        await loadTools();
      } catch {
        loadTools();
      }
    },
    [tools, manuallyDisabled, loadTools],
  );

  const enabledCount = tools.filter((t) => t.enabled).length;
  const disabledCount = tools.length - enabledCount;

  const uniqueCategories = [...new Set(tools.map((t) => t.category))];
  const filterTabs = [
    { id: "all", label: "全部", count: showDisabled ? tools.length : enabledCount },
    ...uniqueCategories.map((cat) => ({
      id: cat,
      label: categories[cat] ?? cat,
      count: tools.filter((t) => t.category === cat && (showDisabled || t.enabled)).length,
    })).filter((tab) => tab.count > 0),
  ];

  const filtered = tools.filter((t) => {
    if (!showDisabled && !t.enabled) return false;
    if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        toolDisplayName(t.name).toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        toolDescription(t).toLowerCase().includes(q) ||
        t.params.some((p) => p.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Group filtered tools by category
  const grouped = new Map<string, ToolInfo[]>();
  for (const tool of filtered) {
    const list = grouped.get(tool.category) ?? [];
    list.push(tool);
    grouped.set(tool.category, list);
  }

  if (loading) return <LoadingState />;

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="工具"
        subtitle={`${enabledCount} 个已启用，${disabledCount} 个已停用`}
        count={tools.length}
      />

      {error && (
        <div className="bg-danger-subtle border border-danger/20 rounded-lg px-4 py-3 text-danger text-sm mb-5">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1 max-w-md">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="搜索工具..."
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => setShowDisabled(e.target.checked)}
            className="accent-accent"
          />
          显示已停用
        </label>
      </div>

      <FilterTabs
        tabs={filterTabs}
        active={categoryFilter}
        onChange={setCategoryFilter}
      />

      <div className={cn("flex gap-6", selectedTool && "max-lg:flex-col")}>
        <div className="flex-1 min-w-0">
          {filtered.length === 0 && (
            <EmptyState description="没有匹配的工具。" />
          )}

          {[...grouped.entries()].map(([cat, catTools]) => {
            const label = categories[cat] ?? cat;
            return (
              <div key={cat} className="mb-6">
                {categoryFilter === "all" && (
                  <div className="flex items-center gap-3 mb-3 px-1">
                    <h3 className="text-xs uppercase tracking-[0.12em] text-faint font-semibold m-0">
                      {label}
                    </h3>
                    <span className="text-[11px] font-mono text-muted">
                      {catTools.length}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <div className="grid grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-3">
                  {catTools.map((tool, i) => (
                    <ToolCard
                      key={tool.name}
                      tool={tool}
                      index={i}
                      isSelected={selectedTool?.name === tool.name}
                      onSelect={() =>
                        setSelectedTool(
                          selectedTool?.name === tool.name ? null : tool,
                        )
                      }
                      onToggle={() => toggleTool(tool.name)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {selectedTool && (
          <div className="w-[320px] max-lg:w-full shrink-0">
            <DetailPanel
              tool={selectedTool}
              categoryLabel={categories[selectedTool.category] ?? selectedTool.category}
              onClose={() => setSelectedTool(null)}
              onToggle={() => toggleTool(selectedTool.name)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
