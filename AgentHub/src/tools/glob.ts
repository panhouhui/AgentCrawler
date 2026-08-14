import { resolve, relative } from "path";
import type { ToolDefinition, ToolResult, ToolCategory } from "./types";
import type { ToolsConfig } from "../config/schema";
import { resolveAllowedDirs, expandHome, isPathAllowed } from "./path-utils";
import { createLogger } from "../logger";

const log = createLogger("tool:glob");

const MAX_RESULTS = 100;
const DEFAULT_RESULTS = 30;

export function createGlobTool(config: ToolsConfig): ToolDefinition {
  const allowedDirs = resolveAllowedDirs(config.allowedDirectories);

  return {
    name: "glob",
    description:
      "Find files matching a glob pattern. Returns file paths relative to the search directory. Use to discover files before reading them.",
    categories: ["fileops", "code"] as readonly ToolCategory[],
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: 'Glob pattern, e.g. "**/*.ts", "src/**/*.tsx", "*.json"',
        },
        path: {
          type: "string",
          description: "Directory to search in (default: project root)",
        },
        maxResults: {
          type: "number",
          description: `Max results (default ${DEFAULT_RESULTS}, max ${MAX_RESULTS})`,
        },
      },
      required: ["pattern"],
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const pattern = String(input.pattern ?? "");
      if (!pattern) {
        return { output: "Error: pattern is required", isError: true };
      }

      const home = process.env.HOME ?? "";
      const searchPath = input.path
        ? resolve(expandHome(String(input.path)))
        : home;

      if (!(await isPathAllowed(searchPath, allowedDirs))) {
        return {
          output: `Error: path not allowed: ${searchPath}`,
          isError: true,
        };
      }

      const limit = Math.min(
        Math.max(1, Number(input.maxResults) || DEFAULT_RESULTS),
        MAX_RESULTS,
      );

      log.debug("Running glob", { pattern, path: searchPath, limit });

      try {
        const glob = new Bun.Glob(pattern);
        const results: string[] = [];

        for await (const match of glob.scan({
          cwd: searchPath,
          dot: false,
          onlyFiles: true,
        })) {
          // Skip noise directories
          if (
            match.includes("node_modules/") ||
            match.includes(".git/") ||
            match.includes("dist/") ||
            match.includes("coverage/")
          ) {
            continue;
          }

          results.push(match);
          if (results.length >= limit) break;
        }

        if (results.length === 0) {
          return { output: "No files matched.", isError: false };
        }

        const header = `[${results.length} files in ${relative(home, searchPath) || "."}]\n`;
        return { output: header + results.join("\n"), isError: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error("Glob error", error);
        return { output: `Error running glob: ${message}`, isError: true };
      }
    },
  };
}
