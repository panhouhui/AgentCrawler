import React, { useState, useEffect } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { createRoot } from "react-dom/client";
import { Menu } from "lucide-react";
import { AppLogo, Input, Button } from "./components";
import { installChineseLocalizer } from "./lib/zh-localize";

export type Theme = "dark" | "light";
import {
  apiFetch,
  getToken,
  setToken,
  clearToken,
  initTokenFromUrl,
} from "./api";
import type { Tab } from "./navigation";
import { VALID_TABS, TAB_TITLES } from "./navigation";
import Sidebar from "./components/Sidebar";
import Overview from "./views/Overview";
import Channels from "./views/Channels";
import Sessions from "./views/Sessions";
import Logs from "./views/Logs";
import Chat from "./views/Chat";
import Agents from "./views/agents/Agents";
import Cron from "./views/Cron";
import SystemMetrics from "./views/SystemMetrics";
import News from "./views/News";
import Processes from "./views/Processes";
import Skills from "./views/skills/Skills";
import Tools from "./views/Tools";
import AgentMetrics from "./views/AgentMetrics";
import RoutingRules from "./views/RoutingRules";
import Memory from "./views/Memory";
import Workflows from "./views/Workflows";
import Settings from "./views/Settings";
import Sige from "./views/Sige";
import SigeIdeas from "./views/SigeIdeas";
import Pipelines from "./views/Pipelines";
import PipelineIdeas from "./views/PipelineIdeas";
import KeywordResearch from "./views/KeywordResearch";
import SocialFusion from "./views/SocialFusion";
import KanPushConfig from "./views/KanPushConfig";
import CrawlerConfig from "./views/CrawlerConfig";

const THEME_KEY = "agenthub-theme";
const LEGACY_THEME_KEY = "opencrow-theme";

interface StatusResponse {
  uptime: number;
  authEnabled: boolean;
  version: string;
  sessions: number;
  channels: Record<string, { status: string; type: string }>;
  agents: number;
  cron: { running: boolean; jobCount: number; nextDueAt: number | null } | null;
}

function TokenModal({ onSuccess }: { onSuccess: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setLoading(true);
    setError("");
    setToken(value.trim());
    try {
      await apiFetch<StatusResponse>("/api/status");
      onSuccess();
    } catch {
      clearToken();
      setError("令牌无效，请重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-bg">
      <div className="bg-bg-1 border border-border-2 rounded-xl p-10 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <AppLogo size="lg" />
          <div>
            <h1 className="text-2xl font-bold text-strong tracking-tight leading-none">
              AgentHub
            </h1>
            <p className="text-muted text-sm mt-1">
              请输入访问令牌后继续。
            </p>
          </div>
        </div>
        {error && (
          <div className="bg-danger-subtle border border-danger/20 rounded-lg px-4 py-3 text-danger text-base mb-5">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <Input
              id="token-input"
              label="访问令牌"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="输入令牌..."
              autoFocus
            />
          </div>
          <Button type="submit" loading={loading} className="w-full">
            继续
          </Button>
        </form>
      </div>
    </div>
  );
}

function tabFromHash(): Tab {
  const hash = location.hash.slice(1);
  return VALID_TABS.has(hash as Tab) ? (hash as Tab) : "overview";
}

interface FeaturesState {
  readonly qdrantEnabled: boolean;
}

function computeHiddenTabs(features: FeaturesState | null): ReadonlySet<Tab> {
  if (!features) return new Set();
  const hidden = new Set<Tab>();

  // Hide memory tab when Qdrant/RAG is disabled
  if (!features.qdrantEnabled) {
    hidden.add("memory");
  }

  return hidden;
}

function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [authState, setAuthState] = useState<"loading" | "ok" | "needed">(
    "loading",
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const current = localStorage.getItem(THEME_KEY) as Theme | null;
    if (current) return current;
    const legacy = localStorage.getItem(LEGACY_THEME_KEY) as Theme | null;
    if (legacy) {
      localStorage.setItem(THEME_KEY, legacy);
      localStorage.removeItem(LEGACY_THEME_KEY);
      return legacy;
    }
    return "dark";
  });
  const [features, setFeatures] = useState<FeaturesState | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    localStorage.removeItem(LEGACY_THEME_KEY);
  }, [theme]);

  useEffect(() => installChineseLocalizer(), []);

  useEffect(() => {
    document.title = `${TAB_TITLES[tab]} - AgentHub`;
  }, [tab]);

  useEffect(() => {
    initTokenFromUrl();
    checkAuth();
  }, []);

  useEffect(() => {
    function onHashChange() {
      setTab(tabFromHash());
      setMobileNavOpen(false);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Re-fetch features when settings change
  useEffect(() => {
    function onFeaturesChanged() {
      fetchFeatures();
    }
    window.addEventListener("features-changed", onFeaturesChanged);
    return () => window.removeEventListener("features-changed", onFeaturesChanged);
  }, []);

  function navigateTo(newTab: Tab) {
    location.hash = newTab;
    setTab(newTab);
  }

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  async function fetchFeatures() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const res = await apiFetch<{
        data: {
          scrapers: { enabled: string[] };
          qdrant: { enabled: boolean };
        };
      }>("/api/features", { signal: controller.signal });
      setFeatures({
        qdrantEnabled: res.data.qdrant.enabled,
      });
    } catch {
      // Non-critical: show all tabs if features can't be loaded.
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function checkAuth() {
    try {
      await apiFetch<StatusResponse>("/api/status");
      await fetchFeatures();
      setAuthState("ok");
    } catch (err: unknown) {
      const apiErr = err as { status?: number };
      if (apiErr?.status === 401) {
        setAuthState("needed");
      } else {
        await fetchFeatures();
        setAuthState("ok");
      }
    }
  }

  function handleLogout() {
    clearToken();
    setAuthState("needed");
  }

  if (authState === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <span className="w-7 h-7 border-2 border-border-2 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === "needed") {
    return <TokenModal onSuccess={() => setAuthState("ok")} />;
  }

  const hasToken = Boolean(getToken());
  const hiddenTabs = computeHiddenTabs(features);

  return (
    <div className="grid grid-cols-[230px_minmax(0,1fr)] max-lg:grid-cols-[56px_minmax(0,1fr)] max-md:grid-cols-[1fr] h-screen overflow-hidden bg-bg">
      {/* Mobile-only top bar */}
      <div className="hidden max-md:flex items-center gap-3 fixed top-0 left-0 right-0 h-[52px] bg-bg border-b border-border px-4 z-[200]">
        <button
          className="flex items-center justify-center w-9 h-9 shrink-0 border-none rounded-md bg-transparent text-foreground cursor-pointer hover:bg-bg-2 transition-colors"
          onClick={() => setMobileNavOpen(true)}
          aria-label="打开导航"
        >
          <Menu size={20} />
        </button>
        <AppLogo size="sm" />
        <span className="text-base font-semibold text-strong">
          AgentHub
        </span>
      </div>

      <Sidebar
        activeTab={tab}
        onSelect={navigateTo}
        hiddenTabs={hiddenTabs}
        showSignOut={hasToken}
        onSignOut={handleLogout}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        theme={theme}
        onThemeToggle={toggleTheme}
      />

      <main className="overflow-y-auto max-md:pt-[52px]">
        <ErrorBoundary key={tab} onReset={() => navigateTo(tab)}>
          <div
            className="px-8 py-7 max-lg:px-6 max-lg:py-6 max-md:px-4 max-md:py-5"
          >
            {tab === "overview" && <Overview />}
            {tab === "channels" && <Channels />}
            {tab === "sessions" && <Sessions />}
            {tab === "chat" && <Chat />}
            {tab === "agents" && <Agents />}
            {tab === "skills" && <Skills />}
            {tab === "tools" && <Tools />}
            {tab === "cron" && <Cron />}
            {tab.startsWith("crawler-") && <CrawlerConfig platformId={tab.slice("crawler-".length)} />}
            {tab === "news" && <News />}
            {tab === "keyword-research" && <KeywordResearch navigateTo={navigateTo} />}
            {tab === "social-fusion" && <SocialFusion />}
            {tab === "kan-push" && <KanPushConfig />}
            {tab === "pipelines" && <Pipelines />}
            {tab === "pipeline-ideas" && <PipelineIdeas />}
            {tab === "memory" && <Memory />}
            {tab === "processes" && <Processes />}
            {tab === "routing" && <RoutingRules />}
            {tab === "agent-metrics" && <AgentMetrics />}
            {tab === "system" && <SystemMetrics />}
            {tab === "logs" && <Logs />}
            {tab === "settings" && <Settings />}
            {tab === "workflows" && <Workflows />}
            {tab === "sige" && <Sige />}
            {tab === "sige-ideas" && <SigeIdeas navigateTo={navigateTo} />}
          </div>
        </ErrorBoundary>
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
