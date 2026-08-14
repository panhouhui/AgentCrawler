/**
 * Shared input extraction & validation helpers for all tools.
 * Replaces unsafe `input.x as string` casts with safe, validated accessors.
 */

import type { ToolResult } from "./types";

// ---------------------------------------------------------------------------
// String
// ---------------------------------------------------------------------------

interface StringOpts {
  /** Maximum character length (truncates if exceeded). */
  readonly maxLength?: number;
  /** Allow empty strings? Default false. */
  readonly allowEmpty?: boolean;
  /** Trim whitespace? Default true. */
  readonly trim?: boolean;
}

/** Extract a string from input. Returns undefined if missing/empty. */
export function getString(
  input: Record<string, unknown>,
  key: string,
  opts: StringOpts = {},
): string | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) return undefined;
  let val = String(raw);
  if (opts.trim !== false) val = val.trim();
  if (!opts.allowEmpty && val.length === 0) return undefined;
  if (opts.maxLength && val.length > opts.maxLength) {
    val = val.slice(0, opts.maxLength);
  }
  return val;
}

/**
 * Extract a required string. Returns `ToolResult` error if missing/empty.
 *
 * Usage:
 * ```ts
 * const query = requireString(input, "query");
 * if (isToolError(query)) return query;
 * ```
 */
export function requireString(
  input: Record<string, unknown>,
  key: string,
  opts: StringOpts = {},
): string | ToolResult {
  const val = getString(input, key, opts);
  if (val === undefined || val.length === 0) {
    return { output: `Missing required field: ${key}.`, isError: true };
  }
  return val;
}

// ---------------------------------------------------------------------------
// Number
// ---------------------------------------------------------------------------

interface NumberOpts {
  readonly min?: number;
  readonly max?: number;
  readonly defaultVal?: number;
}

/** Extract a number with clamping. Always returns a number (never undefined). */
export function getNumber(
  input: Record<string, unknown>,
  key: string,
  opts: NumberOpts = {},
): number {
  const raw = input[key];
  let val: number;
  if (raw === undefined || raw === null) {
    val = opts.defaultVal ?? 0;
  } else {
    val = Number(raw);
    if (Number.isNaN(val)) val = opts.defaultVal ?? 0;
  }
  if (opts.min !== undefined && val < opts.min) val = opts.min;
  if (opts.max !== undefined && val > opts.max) val = opts.max;
  return val;
}

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

/** Extract a value validated against an allowed set. Returns undefined if invalid. */
export function getEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) return undefined;
  const val = String(raw).trim();
  return values.includes(val as T) ? (val as T) : undefined;
}

// ---------------------------------------------------------------------------
// Boolean
// ---------------------------------------------------------------------------

/** Extract a boolean with a default. */
export function getBoolean(
  input: Record<string, unknown>,
  key: string,
  defaultVal: boolean = false,
): boolean {
  const raw = input[key];
  if (raw === undefined || raw === null) return defaultVal;
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === 1) return true;
  if (raw === "false" || raw === 0) return false;
  return defaultVal;
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** Type guard: check if a return value is a ToolResult error. */
export function isToolError(val: unknown): val is ToolResult {
  return (
    typeof val === "object" &&
    val !== null &&
    "isError" in val &&
    (val as ToolResult).isError === true
  );
}
