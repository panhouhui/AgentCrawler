import { resolve, join } from "path";
import { readdir, lstat } from "node:fs/promises";
import type { ToolDefinition, ToolResult, ToolCategory } from "./types";
import type { ToolsConfig } from "../config/schema";
import { resolveAllowedDirs, expandHome, isPathAllowed } from "./path-utils";
import { createLogger } from "../logger";

const log = createLogger("tool:list-files");

const MAX_DEPTH = 10;

async function listRecursive(
  dirPath: string,
  depth: number,
  maxDepth: number,
): Promise<readonly string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  for (const entry of entries) {
    if (entry.name.startsWith(".") && depth > 0) continue;

    const fullPath = join(dirPath, entry.name);

    // Skip symlinks during recursive traversal to prevent escape
    const stats = await lstat(fullPath);
    if (stats.isSymbolicLink()) {
      lines.push(`${indent}${entry.name} -> [symlink]`);
      continue;
    }

    const suffix = entry.isDirectory() ? "/" : "";
    lines.push(`${indent}${entry.name}${suffix}`);

    if (entry.isDirectory() && depth < maxDepth) {
      const subLines = await listRecursive(fullPath, depth + 1, maxDepth);
      lines.push(...subLines);
    }
  }

  return lines;
}

export function createListFilesTool(config: ToolsConfig): ToolDefinition {
  const allowedDirs = resolveAllowedDirs(config.allowedDirectories);

  return {
    name: "list_files",
    description:
      "List files and directories at the given path. Can optionally list recursively up to 3 levels deep.",
    categories: ["fileops", "code"] as readonly ToolCategory[],
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the directory to list",
        },
        recursive: {
          type: "boolean",
          description:
            "Whether to list recursively (default: false, max depth: 3)",
        },
      },
      required: ["path"],
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const rawPath = String(input.path ?? "");
      const dirPath = resolve(expandHome(rawPath));
      const recursive = Boolean(input.recursive);

      if (!(await isPathAllowed(dirPath, allowedDirs))) {
        return {
          output: `Error: path not allowed: ${dirPath}`,
          isError: true,
        };
      }

      log.debug("Listing files", { dirPath, recursive });

      try {
        if (recursive) {
          const lines = await listRecursive(dirPath, 0, MAX_DEPTH);
          return {
            output: lines.join("\n") || "(empty directory)",
            isError: false,
          };
        }

        const entries = await readdir(dirPath, { withFileTypes: true });
        const lines = entries.map((entry: any) => {
          const suffix = entry.isDirectory() ? "/" : "";
          return `${entry.name}${suffix}`;
        });

        return {
          output: lines.join("\n") || "(empty directory)",
          isError: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error("List files error", error);
        return { output: `Error listing directory: ${message}`, isError: true };
      }
    },
  };
}
