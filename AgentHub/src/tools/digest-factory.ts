/**
 * Factory for creating digest/get tools that fetch and format data from stores.
 * Replaces 7 nearly-identical digest tool implementations with a single
 * configurable factory while preserving exact API compatibility.
 */

import type { ToolDefinition, ToolCategory, ToolResult } from "./types";
import { getNumber } from "./input-helpers";

export interface DigestToolConfig<T> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** Fetch items. Receives raw input (for extra filters) and resolved limit. */
  readonly fetchFn: (
    input: Record<string, unknown>,
    limit: number,
  ) => Promise<readonly T[]>;
  /** Format a single item for output. */
  readonly formatFn: (item: T, index: number) => string;
  /** Optional header line. Default: "{name} ({count} results):\n" */
  readonly headerFn?: (
    results: readonly T[],
    input: Record<string, unknown>,
  ) => string;
  readonly emptyMessage?: string;
  readonly errorPrefix?: string;
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
}

export function createDigestTool<T>(
  config: DigestToolConfig<T>,
): ToolDefinition {
  const defaultLimit = config.defaultLimit ?? 30;
  const maxLimit = config.maxLimit ?? 50;
  const emptyMessage = config.emptyMessage ?? "No results found.";
  const errorPrefix = config.errorPrefix ?? "Error retrieving data";

  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    categories: ["research"] as readonly ToolCategory[],
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const limit = getNumber(input, "limit", {
        defaultVal: defaultLimit,
        min: 1,
        max: maxLimit,
      });

      try {
        const items = await config.fetchFn(input, limit);

        if (items.length === 0) {
          return { output: emptyMessage, isError: false };
        }

        const header = config.headerFn
          ? config.headerFn(items, input)
          : `${config.name} (${items.length} results):\n`;
        const rows = items.map(config.formatFn);
        return { output: header + rows.join("\n\n"), isError: false };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { output: `${errorPrefix}: ${msg}`, isError: true };
      }
    },
  };
}
