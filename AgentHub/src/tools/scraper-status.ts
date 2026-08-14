import type { ToolDefinition, ToolCategory } from "./types";
import type { ScraperRunRecord } from "../sources/news/types";
import {
  getScraperRuns,
  getArticleStats,
} from "../sources/news/store";

function formatAge(epochSec: number): string {
  const diffMs = Date.now() - epochSec * 1000;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function createGetScraperStatusTool(): ToolDefinition {
  return {
    name: "get_scraper_status",
    description:
      "Check the health and freshness of news scrapers. Shows last run status, error rates, and article counts per source. Use this before searching news to know if data is fresh or stale.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Filter to a specific source name. Omit for all sources.",
        },
      },
      required: [],
    },
    categories: ["research"] as readonly ToolCategory[],
    async execute(input): Promise<{ output: string; isError: boolean }> {
      const source = input.source as string | undefined;

      try {
        const [runs, stats] = await Promise.all([
          getScraperRuns({ source, limit: source ? 5 : 20 }),
          getArticleStats(),
        ]);

        const lines: string[] = [];

        // Article stats
        if (stats.length > 0) {
          lines.push("Article counts by source:");
          for (const s of stats) {
            lines.push(`  ${s.source_name}: ${s.count} articles (latest: ${formatAge(s.latest_at)})`);
          }
        }

        // Recent scraper runs grouped by source
        if (runs.length > 0) {
          const bySource = new Map<string, ScraperRunRecord[]>();
          for (const r of runs) {
            const group = bySource.get(r.source_name) ?? [];
            group.push(r);
            bySource.set(r.source_name, group);
          }

          lines.push("\nRecent scraper runs:");
          for (const [src, srcRuns] of bySource) {
            const latest = srcRuns[0]!;
            const errorCount = srcRuns.filter((r) => r.status !== "ok").length;
            const statusIcon = latest.status === "ok" ? "OK" : "ERROR";
            lines.push(
              `  ${src}: ${statusIcon} — last run ${formatAge(latest.started_at)}, ` +
              `found ${latest.articles_found} (${latest.articles_new} new), ${latest.duration_ms}ms` +
              (errorCount > 0 ? `, ${errorCount}/${srcRuns.length} recent errors` : ""),
            );
            if (latest.status !== "ok" && latest.error) {
              lines.push(`    Error: ${latest.error.slice(0, 200)}`);
            }
          }
        }

        if (lines.length === 0) {
          return { output: "No scraper data found.", isError: false };
        }

        return { output: lines.join("\n"), isError: false };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { output: `Error fetching scraper status: ${msg}`, isError: true };
      }
    },
  };
}
