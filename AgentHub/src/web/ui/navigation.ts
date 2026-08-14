import type { LucideIcon } from "lucide-react";
import {
  Home,
  Bot,
  MessageSquare,
  Hash,
  Wrench,
  MessageCircle,
  Github,
  GraduationCap,
  Newspaper,
  Clock,
  Activity,
  FileText,
  Server,
  BarChart3,
  GitBranch,
  Brain,
  Settings,
  MessagesSquare,
  Workflow,
  Swords,
  Zap,
  Lightbulb,
  Sparkles,
  Search,
  Network,
  Send,
  Facebook,
  Instagram,
  Linkedin,
  Youtube,
  Radio,
  Cable,
  AtSign,
} from "lucide-react";

export type Tab =
  | "overview"
  | "chat"
  | "agents"
  | "skills"
  | "sessions"
  | "channels"
  | "crawler-x"
  | "crawler-facebook"
  | "crawler-github"
  | "crawler-instagram"
  | "crawler-lien"
  | "crawler-lihkg"
  | "crawler-netlight"
  | "crawler-ptt"
  | "crawler-telegram"
  | "crawler-youtube"
  | "news"
  | "cron"
  | "processes"
  | "system"
  | "tools"
  | "agent-metrics"
  | "routing"
  | "memory"
  | "logs"
  | "settings"
  | "workflows"
  | "sige"
  | "sige-ideas"
  | "pipelines"
  | "pipeline-ideas"
  | "keyword-research"
  | "social-fusion"
  | "kan-push";

export interface NavItem {
  readonly id: Tab;
  readonly label: string;
  readonly Icon: LucideIcon;
}

export interface NavSection {
  readonly title: string;
  readonly collapsible: boolean;
  readonly items: readonly NavItem[];
}

export const VALID_TABS = new Set<Tab>([
  "overview", "chat", "agents", "skills", "sessions", "channels",
  "crawler-x", "crawler-facebook", "crawler-github", "crawler-instagram", "crawler-lien",
  "crawler-lihkg", "crawler-netlight", "crawler-ptt", "crawler-telegram", "crawler-youtube",
  "news", "cron",
  "processes", "system", "tools", "agent-metrics", "routing",
  "memory", "logs", "settings", "workflows", "sige", "sige-ideas", "pipelines", "pipeline-ideas",
  "keyword-research", "social-fusion", "kan-push",
]);

export const TAB_TITLES: Record<Tab, string> = {
  overview: "总览",
  chat: "对话",
  agents: "智能体",
  skills: "技能",
  sessions: "会话",
  channels: "渠道",
  "crawler-x": "X 爬虫配置",
  "crawler-facebook": "Facebook 爬虫配置",
  "crawler-github": "GitHub 爬虫配置",
  "crawler-instagram": "instagram 爬虫配置",
  "crawler-lien": "Lien 爬虫配置",
  "crawler-lihkg": "Lihkg 爬虫配置",
  "crawler-netlight": "NetLight 爬虫配置",
  "crawler-ptt": "PTT 爬虫配置",
  "crawler-telegram": "Telegram 爬虫配置",
  "crawler-youtube": "YouTube 爬虫配置",
  news: "新闻源",
  cron: "定时任务",
  processes: "进程",
  system: "指标",
  tools: "工具",
  "agent-metrics": "智能体指标",
  routing: "路由",
  memory: "记忆",
  logs: "日志",
  settings: "设置",
  workflows: "工作流",
  sige: "SIGE",
  "sige-ideas": "SIGE 创意",
  pipelines: "管线",
  "pipeline-ideas": "管线创意",
  "keyword-research": "关键词研究",
  "social-fusion": "社交融合",
  "kan-push": "kan推送配置",
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: "控制台",
    collapsible: false,
    items: [{ id: "overview", label: "总览", Icon: Home }],
  },
  {
    title: "智能体",
    collapsible: false,
    items: [
      { id: "social-fusion", label: "社交融合", Icon: Network },
      { id: "agents", label: "智能体列表", Icon: Bot },
      { id: "chat", label: "对话", Icon: MessagesSquare },
      { id: "skills", label: "技能", Icon: GraduationCap },
      { id: "tools", label: "工具", Icon: Wrench },
      { id: "agent-metrics", label: "智能体指标", Icon: BarChart3 },
      { id: "sessions", label: "会话", Icon: MessageSquare },
      { id: "routing", label: "路由", Icon: GitBranch },
      { id: "channels", label: "渠道", Icon: Hash },
      { id: "workflows", label: "工作流", Icon: Workflow },
    ],
  },
  {
    title: "爬虫配置",
    collapsible: true,
    items: [
      { id: "crawler-x", label: "X", Icon: AtSign },
      { id: "crawler-facebook", label: "Facebook", Icon: Facebook },
      { id: "crawler-github", label: "GitHub", Icon: Github },
      { id: "crawler-instagram", label: "instagram", Icon: Instagram },
      { id: "crawler-lien", label: "Lien", Icon: Linkedin },
      { id: "crawler-lihkg", label: "Lihkg", Icon: MessageCircle },
      { id: "crawler-netlight", label: "NetLight", Icon: Network },
      { id: "crawler-ptt", label: "PTT", Icon: Radio },
      { id: "crawler-telegram", label: "Telegram", Icon: Cable },
      { id: "crawler-youtube", label: "YouTube", Icon: Youtube },
    ],
  },
  {
    title: "情报分析",
    collapsible: true,
    items: [
      { id: "news", label: "新闻源", Icon: Newspaper },
      { id: "keyword-research", label: "关键词研究", Icon: Search },
      { id: "pipelines", label: "管线", Icon: Zap },
      { id: "pipeline-ideas", label: "管线创意", Icon: Lightbulb },
      { id: "sige", label: "SIGE", Icon: Swords },
      { id: "sige-ideas", label: "SIGE 创意", Icon: Sparkles },
      { id: "memory", label: "记忆", Icon: Brain },
    ],
  },
  {
    title: "kan推送配置",
    collapsible: false,
    items: [
      { id: "kan-push", label: "kan推送配置", Icon: Send },
    ],
  },
  {
    title: "系统",
    collapsible: true,
    items: [
      { id: "cron", label: "定时任务", Icon: Clock },
      { id: "processes", label: "进程", Icon: Server },
      { id: "system", label: "指标", Icon: Activity },
      { id: "logs", label: "日志", Icon: FileText },
      { id: "settings", label: "设置", Icon: Settings },
    ],
  },
];
