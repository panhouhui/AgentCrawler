import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { getAgentHubRoot } from "../config/agenthub-root";
import { getCrawlerPlatformConfig } from "../integrations/crawlers/config";
import { buildKeywordChinaGate } from "../pipelines/social/china-relevance";
import type { ToolCategory, ToolDefinition, ToolResult } from "./types";
import { getBoolean, getNumber, getString } from "./input-helpers";

type CrawlerPlatform =
  | "x"
  | "telegram"
  | "lihkg"
  | "facebook"
  | "github"
  | "instagram"
  | "lien"
  | "netlight"
  | "ptt"
  | "youtube";

type ToolMode = "smoke" | "probe" | "crawl";
type ToolPhase = "discover" | "search";

interface CommandPlan {
  readonly argv: readonly string[];
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly artifacts?: readonly CrawlerArtifact[];
  readonly unsupportedReason?: string;
}

type ArtifactKind = "json" | "jsonl" | "csv" | "dir-json";

interface CrawlerArtifact {
  readonly label: string;
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly file?: string;
}

interface CrawlerSpec {
  readonly platform: CrawlerPlatform;
  readonly label: string;
  readonly toolName: string;
  readonly description: string;
  readonly cwd: string;
  readonly envFile?: string;
  readonly smoke: CommandPlan;
  buildProbe(input: CrawlerToolInput): CommandPlan;
  buildCrawl(input: CrawlerToolInput): CommandPlan;
}

interface CrawlerToolInput {
  readonly mode: ToolMode;
  readonly phase: ToolPhase;
  readonly eventTitle: string;
  readonly limit: number;
  readonly timeoutMs: number;
  readonly dryRun: boolean;
}

const AGENT_HUB_ROOT = getAgentHubRoot();
const PROJECT_ROOT = process.env.AGENTHUB_PROJECT_ROOT ?? process.cwd();
const CRAWLER_ROOT = process.env.CRAWLER_ROOT ?? join(AGENT_HUB_ROOT, "Crawler");
const CRAWLER_ENV_ROOT =
  process.env.CRAWLER_ENV_ROOT ?? join(AGENT_HUB_ROOT, "env", "Crawler_env");
const MODEL_ENV_ROOT =
  process.env.MODEL_ENV_ROOT ?? join(AGENT_HUB_ROOT, "env", "model_env");
const TEST_OUTPUT_ROOT =
  process.env.AGENTHUB_TEST_OUTPUT_ROOT ?? join(AGENT_HUB_ROOT, "test");
const RUNTIME_TMP_ROOT =
  process.env.AGENTHUB_CRAWLER_OUTPUT_DIR ?? join(TEST_OUTPUT_ROOT, "crawler-tools");

const PYTHON = process.env.AGENTHUB_PYTHON ?? "python";
const CRAWLER_PROXY_PORT = process.env.AGENTHUB_CRAWLER_PROXY_PORT ?? "59217";
const CRAWLER_PROXY_URL =
  process.env.AGENTHUB_CRAWLER_PROXY_URL ?? `http://127.0.0.1:${CRAWLER_PROXY_PORT}`;
const MAX_OUTPUT_CHARS = 12_000;
const MAX_SAMPLE_RECORDS = 3;

function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  let currentKey = "";
  let currentValue = "";

  const flush = () => {
    if (!currentKey) return;
    values[currentKey] = unquote(currentValue.trim());
    currentKey = "";
    currentValue = "";
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq > 0) {
      flush();
      currentKey = normalized.slice(0, eq).trim();
      currentValue = normalized.slice(eq + 1).trim();
    } else if (currentKey) {
      currentValue += normalized;
    }
  }

  flush();
  return values;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFile(path: string | undefined): Record<string, string> {
  if (!path || !existsSync(path)) return {};
  try {
    return parseEnvText(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function buildChildEnv(spec: CrawlerSpec, plan?: CommandPlan): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env,
    ...readEnvFile(spec.envFile),
    ...readEnvFile(join(MODEL_ENV_ROOT, "minimax_env")),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    KAN_PUSH_ENABLED: "false",
    MATTERMOST_ENABLED: "false",
    OPENCROW_KAN_PUSH_ENABLED: "false",
    OPENCROW_KAN_PUSH_DISABLED: "1",
  };

  if (process.env.AGENTHUB_CRAWLER_USE_PROXY !== "0") {
    env.HTTP_PROXY ||= CRAWLER_PROXY_URL;
    env.HTTPS_PROXY ||= CRAWLER_PROXY_URL;
    env.ALL_PROXY ||= CRAWLER_PROXY_URL;
    env.http_proxy ||= CRAWLER_PROXY_URL;
    env.https_proxy ||= CRAWLER_PROXY_URL;
    env.all_proxy ||= CRAWLER_PROXY_URL;
  }

  if (plan?.env) {
    Object.assign(env, plan.env);
  }

  return env;
}

function clampText(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const head = text.slice(0, 6000);
  const tail = text.slice(-3000);
  return `${head}\n\n[... output truncated ...]\n\n${tail}`;
}

function hasMojibake(text: string): boolean {
  return /�|(?:[\u00c2-\u00f4][\u0080-\u00bf]){2,}|[\u0080-\u009f]/.test(text);
}

function cjkCount(text: string): number {
  return (text.match(/[\u3400-\u9fff]/g) ?? []).length;
}

function repairMojibake(text: string): string {
  if (!hasMojibake(text) || cjkCount(text) > 10) return text;
  try {
    const repaired = Buffer.from(text, "latin1").toString("utf8");
    if (cjkCount(repaired) > cjkCount(text)) return repaired;
  } catch {
    // Keep original text when repair is not possible.
  }
  return text;
}

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const buffer = Buffer.from(await new Response(stream).arrayBuffer());
  return repairMojibake(buffer.toString("utf8"));
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathVariants(path: string): readonly string[] {
  const normalized = normalize(path);
  return [
    normalized,
    normalized.replace(/\\/g, "/"),
    normalized.replace(/\\/g, "\\\\"),
  ];
}

const REDACTED_PATHS: readonly [string, string][] = [
  [CRAWLER_ENV_ROOT, "<crawler-env>"],
  [MODEL_ENV_ROOT, "<model-env>"],
  [CRAWLER_ROOT, "<crawler-root>"],
  [RUNTIME_TMP_ROOT, "<agenthub-test-output>/crawler-tools"],
  [TEST_OUTPUT_ROOT, "<agenthub-test-output>"],
  [AGENT_HUB_ROOT, "<agenthub-root>"],
];

function redactLocalPaths(text: string): string {
  let next = text;
  for (const [target, replacement] of REDACTED_PATHS) {
    for (const variant of pathVariants(target)) {
      if (!variant) continue;
      next = next.replace(new RegExp(regexEscape(variant), "gi"), replacement);
    }
  }
  next = next.replace(/(?<![A-Za-z])[A-Z]:\\(?:[^\\\r\n"'<>|]+\\)*[^\\\r\n"'<>|]*/gi, "<local-path>");
  next = next.replace(/(?<![A-Za-z])[A-Z]:\/(?:[^/\r\n"'<>|]+\/)*[^/\r\n"'<>|]*/gi, "<local-path>");
  return next;
}

const SECRET_ARG_PATTERN =
  /(?:api[-_]?key|access[-_]?token|refresh[-_]?token|bearer|cookie|password|passwd|secret|session[-_]?id|auth[-_]?token)/i;

function safeArgv(argv: readonly string[]): readonly string[] {
  return argv.map((arg, index) => {
    const previous = argv[index - 1] ?? "";
    if (SECRET_ARG_PATTERN.test(arg) || SECRET_ARG_PATTERN.test(previous)) {
      return "[redacted]";
    }
    const redacted = redactLocalPaths(arg);
    if (redacted.length > 180) return `${redacted.slice(0, 80)}...[truncated]`;
    return redacted;
  });
}

function localPython(cwd: string): string {
  if (process.env.AGENTHUB_PYTHON) return PYTHON;
  const candidates = [
    join(cwd, ".venv", "Scripts", "python.exe"),
    join(cwd, "venv", "Scripts", "python.exe"),
    join(cwd, ".venv", "bin", "python"),
    join(cwd, "venv", "bin", "python"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? PYTHON;
}

function commandArgv(spec: CrawlerSpec, argv: readonly string[]): readonly string[] {
  if (argv[0] !== PYTHON) return argv;
  return [localPython(spec.cwd), ...argv.slice(1)];
}

function jsonOutput(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJsonSafe(text: string): unknown | null {
  const clean = repairMojibake(text.replace(/^\uFEFF/, ""));
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

function parseJsonlSafe(text: string): unknown[] {
  return repairMojibake(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJsonSafe(line))
    .filter((item): item is unknown => item !== null);
}

function parseCsvRows(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  const src = repairMojibake(text.replace(/^\uFEFF/, ""));
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);

  const header = rows.shift()?.map((name) => name.trim()) ?? [];
  if (header.length === 0) return [];
  return rows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) =>
      Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])),
    );
}

function outputCsvPath(platform: CrawlerPlatform, suffix: string): string {
  mkdirSync(RUNTIME_TMP_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(RUNTIME_TMP_ROOT, `${platform}-${suffix}-${stamp}.csv`);
}

function outputPath(platform: CrawlerPlatform, suffix: string): string {
  mkdirSync(RUNTIME_TMP_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(RUNTIME_TMP_ROOT, `${platform}-${suffix}-${stamp}.json`);
}

function outputJsonlPath(platform: CrawlerPlatform, suffix: string): string {
  mkdirSync(RUNTIME_TMP_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(RUNTIME_TMP_ROOT, `${platform}-${suffix}-${stamp}.jsonl`);
}

function outputTextPath(platform: CrawlerPlatform, suffix: string, content: string): string {
  mkdirSync(RUNTIME_TMP_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(RUNTIME_TMP_ROOT, `${platform}-${suffix}-${stamp}.txt`);
  writeFileSync(file, content, "utf-8");
  return file;
}

function outputDirPath(platform: CrawlerPlatform, suffix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(RUNTIME_TMP_ROOT, `${platform}-${suffix}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function unsupportedPlan(reason: string): CommandPlan {
  return {
    argv: [],
    unsupportedReason: reason,
  };
}

function eventTitleOrUnsupported(input: CrawlerToolInput, platformLabel: string): string | CommandPlan {
  const title = input.eventTitle.trim();
  if (title) return title;
  return unsupportedPlan(`${platformLabel} 复核阶段需要候选事件标题，不能使用默认搜索文本。`);
}

function artifactReadPath(artifact: CrawlerArtifact): string {
  return artifact.kind === "dir-json" && artifact.file
    ? join(artifact.path, artifact.file)
    : artifact.path;
}

function recordsFromArtifact(artifact: CrawlerArtifact): unknown[] {
  const file = artifactReadPath(artifact);
  if (!existsSync(file)) return [];
  try {
    const text = readFileSync(file, "utf-8");
    if (artifact.kind === "jsonl") return parseJsonlSafe(text);
    if (artifact.kind === "csv") return parseCsvRows(text);
    const parsed = parseJsonSafe(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.text)) return record.text;
      if (Array.isArray(record.audio)) return record.audio;
      if (Array.isArray(record.image)) return record.image;
      if (Array.isArray(record.messages)) return record.messages;
      if (Array.isArray(record.records)) return record.records;
      if (typeof record.total === "number" && record.total > 0) return [parsed];
      return [parsed];
    }
  } catch {
    return [];
  }
  return [];
}

function truncate(value: string, max = 300): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function sanitizeSample(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactLocalPaths(truncate(value, 800));
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    if (depth >= 4) return `共 ${value.length} 项`;
    return value.slice(0, 5).map((item) => sanitizeSample(item, depth + 1));
  }
  if (!value || typeof value !== "object") return String(value);

  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 80);
  for (const [key, raw] of entries) {
    if (SECRET_ARG_PATTERN.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (depth >= 4 && raw && typeof raw === "object") {
      out[key] = Array.isArray(raw) ? `共 ${raw.length} 项` : "已省略深层对象";
      continue;
    }
    out[key] = sanitizeSample(raw, depth + 1);
  }
  return out;
}

function stdoutRecords(platform: CrawlerPlatform, stdout: string): unknown[] {
  const parsed = parseJsonSafe(stdout);
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (platform === "telegram" && Array.isArray(record.groups)) {
      return record.groups.flatMap((group) => {
        if (!group || typeof group !== "object") return [];
        const groupRecord = group as Record<string, unknown>;
        const messages = Array.isArray(groupRecord.messages) ? groupRecord.messages : [];
        return messages
          .filter((message) => message && typeof message === "object")
          .map((message) => ({
            ...(message as Record<string, unknown>),
            dialog_title: groupRecord.dialog_title,
            dialog_username: groupRecord.dialog_username,
          }));
      });
    }
    if (Array.isArray(record.dialogs)) return record.dialogs;
    if (Array.isArray(record.groups)) return record.groups;
    if (Array.isArray(record.tweets)) return record.tweets;
    if (Array.isArray(record.records)) return record.records;
    if (Array.isArray(record.messages)) return record.messages;
    const count =
      typeof record.count === "number"
        ? record.count
        : typeof record.message_count === "number"
          ? record.message_count
          : 0;
    if (count > 0) {
      return [record];
    }
  }

  if (platform === "instagram") {
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("[NEW] "))
      .map((line) => {
        const parts = line.replace(/^\[NEW\]\s*/, "").split(/\s+/);
        return {
          platform: parts[0] ?? "Instagram",
          target: parts[1] ?? "",
          url: parts[2] ?? "",
        };
      });
  }

  const savedCount = /saved\s+(\d+)\s+/i.exec(stdout)?.[1];
  if (savedCount !== undefined) return [{ count: Number(savedCount) }];
  return [];
}

function configuredStatus(platform: CrawlerPlatform): string {
  return getCrawlerPlatformConfig(platform)?.status ?? "missing-env";
}

function isHelpOutput(stdout: string): boolean {
  return /^usage:/im.test(stdout) || /\noptions:\s*$/im.test(stdout);
}

function hasCrawlerErrorSignal(text: string): boolean {
  return (
    /(?:http|status|status_code|response|code)\D{0,24}\b(?:401|403|407|429|500|502|503|504)\b/i.test(text) ||
    /(?:unauthorized|forbidden|rate limit|too many requests|auth failed|proxyerror|sslerror|traceback|connectionerror|timed?\s*out|cloudflare|页面为空白|\[error\])/i.test(
      text,
    ) ||
    /errors['"]?\s*:\s*[1-9]\d*/i.test(text)
  );
}

function hasAuthConfigSignal(text: string): boolean {
  return /(?:缺少\s*(?:X\s*)?Cookie|Cookie\s*(?:已)?(?:失效|不可用)|登录态(?:不可用|失效)|更新\s*Cookie|unauthorized|forbidden|auth failed|401|403)/i.test(text);
}

function dataQuality(input: {
  readonly platform: CrawlerPlatform;
  readonly mode: ToolMode;
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly artifacts?: readonly CrawlerArtifact[];
}): Record<string, unknown> {
  const artifactRecords = (input.artifacts ?? []).flatMap(recordsFromArtifact);
  const parsedStdoutRecords = stdoutRecords(input.platform, input.stdout);
  const records = artifactRecords.length > 0 ? artifactRecords : parsedStdoutRecords;
  const configured = configuredStatus(input.platform);
  const outputText = `${input.stdout}\n${input.stderr}`;
  const mojibake = hasMojibake(outputText);
  const hasErrorSignal = hasCrawlerErrorSignal(outputText);
  const hasAuthConfigIssue = hasAuthConfigSignal(outputText);
  const effectiveConfigured = !input.ok && hasAuthConfigIssue ? "invalid" : configured;

  let status:
    | "real_data"
    | "no_results"
    | "missing_config"
    | "probe_not_supported"
    | "smoke_only"
    | "error";
  if (!input.ok) {
    status = hasAuthConfigIssue || configured !== "ready" ? "missing_config" : "error";
  } else if (configured !== "ready") {
    status = "missing_config";
  } else if (input.mode === "smoke" || isHelpOutput(input.stdout)) {
    status = input.mode === "smoke" ? "smoke_only" : "probe_not_supported";
  } else if (records.length > 0) {
    status = "real_data";
  } else if (hasErrorSignal) {
    status = "error";
  } else {
    status = "no_results";
  }

  return {
    status,
    configured: effectiveConfigured,
    recordCount: records.length,
    hasMojibake: mojibake,
    summary:
      status === "real_data"
        ? `已返回 ${records.length} 条真实数据样本。`
        : status === "no_results"
          ? "爬虫已执行真实查询，但当前请求没有返回数据。"
          : status === "missing_config"
            ? "该平台配置不完整或无法使用，暂不要求真实爬取。"
            : status === "probe_not_supported"
              ? "该爬虫当前只有程序探测入口，尚未提供安全的一次性真实数据入口。"
              : status === "smoke_only"
                ? "当前为 smoke 模式，只验证程序可启动，不代表真实爬取。"
                : "爬虫执行失败。",
    sampleRecords: records.slice(0, MAX_SAMPLE_RECORDS).map((item) => sanitizeSample(item)),
    artifacts: (input.artifacts ?? []).map((artifact) => ({
      label: artifact.label,
      kind: artifact.kind,
      path: redactLocalPaths(artifact.path),
      records: recordsFromArtifact(artifact).length,
    })),
  };
}

async function runCommand(
  spec: CrawlerSpec,
  plan: CommandPlan,
  input: CrawlerToolInput,
): Promise<ToolResult> {
  if (plan.unsupportedReason) {
    return {
      output: jsonOutput({
        ok: true,
        platform: spec.platform,
        mode: input.mode,
        phase: input.phase,
        dryRun: input.dryRun,
        result: {
          records: [],
          reason: plan.unsupportedReason,
        },
        dataQuality: {
          status: "probe_not_supported",
          configured: configuredStatus(spec.platform),
          recordCount: 0,
          hasMojibake: false,
          summary: plan.unsupportedReason,
          sampleRecords: [],
          artifacts: [],
        },
      }),
      isError: false,
    };
  }

  if (!existsSync(spec.cwd)) {
    return {
      output: jsonOutput({
        ok: false,
        platform: spec.platform,
        error: "未找到该平台爬虫目录",
        crawler: `<crawler:${spec.platform}>`,
      }),
      isError: true,
      errorCode: "NOT_FOUND",
    };
  }

  const startedAt = Date.now();
  const argv = commandArgv(spec, plan.argv);
  const proc = Bun.spawn([...argv], {
    cwd: spec.cwd,
    env: buildChildEnv(spec, plan),
    stdin: plan.stdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });

  if (plan.stdin && proc.stdin) {
    proc.stdin.write(plan.stdin);
    proc.stdin.end();
  }

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, input.timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    readStreamText(proc.stdout),
    readStreamText(proc.stderr),
    proc.exited,
  ]).finally(() => clearTimeout(timeout));

  const ok = !timedOut && exitCode === 0;
  const result = {
    ok,
    platform: spec.platform,
    mode: input.mode,
    phase: input.phase,
    dryRun: input.dryRun,
    elapsedMs: Date.now() - startedAt,
    exitCode,
    timedOut,
    command: {
      crawler: `<crawler:${spec.platform}>`,
      argv: safeArgv(argv),
    },
    stdout: redactLocalPaths(clampText(stdout)),
    stderr: redactLocalPaths(clampText(stderr)),
    dataQuality: dataQuality({
      platform: spec.platform,
      mode: input.mode,
      ok,
      stdout,
      stderr,
      artifacts: plan.artifacts,
    }),
  };

  return {
    output: jsonOutput(result),
    isError: !result.ok,
    errorCode: timedOut ? "TIMEOUT" : result.ok ? undefined : "EXTERNAL_SERVICE",
    retriable: timedOut,
  };
}

function crawlerInputSchema(platformLabel: string): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["smoke", "probe", "crawl"],
        description:
          "smoke 只验证程序可加载，probe 做最小安全探测，crawl 执行小范围爬取。",
      },
      phase: {
        type: "string",
        enum: ["discover", "search"],
        description: "discover 为平台自主发现最新/热门/异常事件；search 为按候选事件复核同一事件。",
      },
      eventTitle: {
        type: "string",
        description: `${platformLabel} 复核同一事件时使用的候选事件标题或摘要。discover 阶段不需要传入。`,
      },
      limit: {
        type: "number",
        description: "最多返回/抓取的条数，默认 3，最大 20。",
      },
      dryRun: {
        type: "boolean",
        description: "默认 true，不推送 Kan，不执行常驻监听。",
      },
      timeoutMs: {
        type: "number",
        description: "单次工具调用超时时间，默认 30000ms，最大 180000ms。",
      },
    },
    required: [],
  };
}

function parseCrawlerInput(input: Record<string, unknown>): CrawlerToolInput {
  const modeValue = getString(input, "mode", { maxLength: 20 }) ?? "smoke";
  const mode: ToolMode =
    modeValue === "probe" || modeValue === "crawl" || modeValue === "smoke"
      ? modeValue
      : "smoke";
  const phaseValue = getString(input, "phase", { maxLength: 20 }) ?? "discover";
  const phase: ToolPhase = phaseValue === "search" ? "search" : "discover";
  const eventTitle =
    getString(input, "eventTitle", { maxLength: 240, allowEmpty: true }) ??
    getString(input, "query", { maxLength: 240, allowEmpty: true }) ??
    "";
  return {
    mode,
    phase,
    eventTitle,
    limit: getNumber(input, "limit", { defaultVal: 3, min: 1, max: 20 }),
    timeoutMs: getNumber(input, "timeoutMs", {
      defaultVal: 30_000,
      min: 5_000,
      max: 180_000,
    }),
    dryRun: getBoolean(input, "dryRun", true),
  };
}

function createExternalCrawlerTool(spec: CrawlerSpec): ToolDefinition {
  return {
    name: spec.toolName,
    description: spec.description,
    categories: ["research", "social"] as readonly ToolCategory[],
    inputSchema: crawlerInputSchema(spec.label),
    async execute(raw): Promise<ToolResult> {
      const input = parseCrawlerInput(raw);
      const plan =
        input.mode === "smoke"
          ? spec.smoke
          : input.mode === "probe" || input.dryRun
            ? spec.buildProbe(input)
            : spec.buildCrawl(input);
      return runCommand(spec, plan, input);
    },
  };
}

function buildXProbe(input: CrawlerToolInput): CommandPlan {
  const output = outputPath("x", input.phase === "discover" ? "discover" : "search");
  const argv = [
    PYTHON,
    "x_agent_tool.py",
    "--phase",
    input.phase,
    "--limit",
    String(input.limit),
    "--comments-per-tweet",
    input.mode === "probe" ? "2" : "8",
    "--env-file",
    join(CRAWLER_ENV_ROOT, "X_env"),
    "--proxy",
    CRAWLER_PROXY_URL,
    "--output",
    output,
  ];

  if (input.phase === "search") {
    const eventTitle = eventTitleOrUnsupported(input, "X");
    if (typeof eventTitle !== "string") return eventTitle;
    argv.push("--event-query", eventTitle);
  }

  return {
    argv,
    artifacts: [
      {
        label: input.phase === "discover" ? "X 热门推文" : "X 事件复核推文",
        path: output,
        kind: "json",
      },
    ],
  };
}

function buildLihkgProbe(input: CrawlerToolInput): CommandPlan {
  const output = outputJsonlPath("lihkg", "probe");
  const errors = outputJsonlPath("lihkg", "errors");
  const state = outputPath("lihkg", "state");
  const probeEnv = outputTextPath("lihkg", "env", "MATTERMOST_ENABLED=false\n");
  const lihkgCookie = readEnvFile(join(CRAWLER_ENV_ROOT, "Lihkg_env")).LIHKG_COOKIE ?? "";
  return {
    argv: [
      PYTHON,
      "src\\scrape_category.py",
      "--env-file",
      probeEnv,
      "once",
      "--cat-id",
      "1",
      "--types",
      "hot",
      "--list-pages",
      "1",
      "--list-count",
      String(Math.max(1, input.limit)),
      "--limit-threads",
      String(Math.max(1, input.limit)),
      "--max-pages-per-thread",
      "1",
      "--request-delay",
      "0",
      "--retries",
      "3",
      "--backoff-base",
      "1",
      "--proxy",
      CRAWLER_PROXY_URL,
      "--proxy-rotate-retries",
      "0",
      "--cookie",
      lihkgCookie,
      "--state",
      state,
      "--max-rate-limit-wait",
      "5",
      "--output",
      output,
      "--error-output",
      errors,
    ],
    env: {
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      all_proxy: "",
      LIHKG_PROXY: "",
      MATTERMOST_ENABLED: "false",
      NO_PROXY: "lihkg.com,.lihkg.com",
      no_proxy: "lihkg.com,.lihkg.com",
    },
    artifacts: [{ label: "LIHKG 帖子", path: output, kind: "jsonl" }],
  };
}

function buildGithubProbe(input: CrawlerToolInput): CommandPlan {
  const output = outputJsonlPath("github", "probe");
  if (input.phase === "discover") {
    return {
      argv: [
        PYTHON,
        "github_crawler.py",
        "--discover-latest",
        "--type",
        "repositories",
        "--max-results",
        String(input.limit),
        "--per-page",
        String(Math.max(1, Math.min(input.limit, 10))),
        "--no-exhaustive",
        "--output",
        output,
      ],
      artifacts: [{ label: "GitHub 最新公开仓库", path: output, kind: "jsonl" }],
    };
  }
  const eventTitle = eventTitleOrUnsupported(input, "GitHub");
  if (typeof eventTitle !== "string") return eventTitle;
  return {
    argv: [
      PYTHON,
      "github_crawler.py",
      "--event-query",
      eventTitle,
      "--type",
      "repositories",
      "--max-results",
      String(input.limit),
      "--per-page",
      String(Math.max(1, Math.min(input.limit, 10))),
      "--no-exhaustive",
      "--output",
      output,
    ],
    artifacts: [{ label: "GitHub 事件复核结果", path: output, kind: "jsonl" }],
  };
}

function buildInstagramProbe(input: CrawlerToolInput): CommandPlan {
  const eventTitle =
    input.phase === "search" ? eventTitleOrUnsupported(input, "Instagram/Threads") : "";
  if (typeof eventTitle !== "string") return eventTitle;
  return {
    argv: [
      PYTHON,
      "main.py",
      "--threads",
      "--once",
      ...(eventTitle ? ["--threads-event-filter", eventTitle] : []),
      "--threads-limit",
      String(input.limit),
      "--state-db",
      outputPath("instagram", "seen"),
    ],
  };
}

function buildLienProbe(): CommandPlan {
  return { argv: [PYTHON, "setup.py", "--name"] };
}

function buildNetlightProbe(input: CrawlerToolInput): CommandPlan {
  const outputDir = outputDirPath("netlight", "messages");
  return {
    argv: [
      PYTHON,
      "matrix_message_fetcher.py",
      "--limit",
      String(input.limit),
      "--no-download",
      "--output-dir",
      outputDir,
    ],
    env: {
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      all_proxy: "",
      NO_PROXY: "*",
      no_proxy: "*",
    },
    artifacts: [
      {
        label: "Matrix 消息",
        path: outputDir,
        kind: "dir-json",
        file: "all_messages.json",
      },
    ],
  };
}

function buildPttProbe(input: CrawlerToolInput): CommandPlan {
  const output = outputPath("ptt", "probe");
  const eventTitle = input.phase === "search" ? eventTitleOrUnsupported(input, "PTT") : "";
  if (typeof eventTitle !== "string") return eventTitle;
  return {
    argv: [
      PYTHON,
      "scripts\\crawl_ptt_http.py",
      ...(eventTitle ? ["--event-filter", eventTitle] : []),
      "--limit",
      String(input.limit),
      "--max-pages-per-query",
      "1",
      "--delay",
      "0",
      "--output",
      output,
    ],
    artifacts: [{ label: "PTT 文章", path: output, kind: "json" }],
  };
}

function buildYoutubeProbe(input: CrawlerToolInput): CommandPlan {
  const output = outputPath("youtube", "probe");
  if (input.phase === "discover") {
    return {
      argv: [
        PYTHON,
        join(PROJECT_ROOT, "scripts", "youtube-avtdl-probe.py"),
        "--discover",
        "--limit",
        String(input.limit),
        "--env-file",
        join(CRAWLER_ENV_ROOT, "YouTube_env"),
        "--output",
        output,
      ],
      artifacts: [{ label: "YouTube 自主发现视频", path: output, kind: "json" }],
    };
  }

  const eventTitle = eventTitleOrUnsupported(input, "YouTube");
  if (typeof eventTitle !== "string") return eventTitle;
  return {
    argv: [
      PYTHON,
      join(PROJECT_ROOT, "scripts", "youtube-avtdl-probe.py"),
      "--query",
      eventTitle,
      "--limit",
      String(input.limit),
      "--env-file",
      join(CRAWLER_ENV_ROOT, "YouTube_env"),
      "--output",
      output,
    ],
    artifacts: [{ label: "YouTube 视频", path: output, kind: "json" }],
  };
}

const SPECS: readonly CrawlerSpec[] = [
  {
    platform: "x",
    label: "X",
    toolName: "crawl_x_social",
    description:
      "调用 X 爬虫工具自主发现热门推文，或按候选事件复核同一事件，并抓取推文评论；默认不推送 Kan。",
    cwd: join(CRAWLER_ROOT, "X"),
    envFile: join(CRAWLER_ENV_ROOT, "X_env"),
    smoke: { argv: [PYTHON, "x_agent_tool.py", "--help"] },
    buildProbe(input) {
      return buildXProbe(input);
    },
    buildCrawl(input) {
      return buildXProbe(input);
    },
  },
  {
    platform: "telegram",
    label: "Telegram",
    toolName: "crawl_telegram_social",
    description:
      "调用 Telegram 爬虫入口自主发现监听会话里的最新消息，或按候选事件复核同一事件，默认不推送 Kan。",
    cwd: join(CRAWLER_ROOT, "Telegram"),
    envFile: join(CRAWLER_ENV_ROOT, "Telegram_env"),
    smoke: { argv: [PYTHON, "telegram_ai_tool.py", "--help"] },
    buildProbe(input) {
      if (input.phase === "search") {
        const eventTitle = eventTitleOrUnsupported(input, "Telegram");
        if (typeof eventTitle !== "string") return eventTitle;
        return {
          argv: [PYTHON, "telegram_ai_tool.py", "--stdin"],
          stdin: JSON.stringify({
            action: "crawl_dialogs",
            days: 1,
            max_results: input.limit,
            query: eventTitle,
          }),
        };
      }
      return {
        argv: [PYTHON, "telegram_ai_tool.py", "--stdin"],
        stdin: JSON.stringify({
          action: "crawl_dialogs",
          days: 1,
          max_results: input.limit,
        }),
      };
    },
    buildCrawl(input) {
      const eventTitle = eventTitleOrUnsupported(input, "Telegram");
      if (typeof eventTitle !== "string") return eventTitle;
      return {
        argv: [PYTHON, "telegram_ai_tool.py", "--stdin"],
        stdin: JSON.stringify({
          action: "crawl_dialogs",
          days: 1,
          max_results: input.limit,
          query: eventTitle,
        }),
      };
    },
  },
  {
    platform: "lihkg",
    label: "LIHKG",
    toolName: "crawl_lihkg_social",
    description:
      "调用 LIHKG 爬虫做热门/最新帖子小范围探测，默认不推送 Kan。",
    cwd: join(CRAWLER_ROOT, "Lihkg", "lihkg-scraper"),
    envFile: join(CRAWLER_ENV_ROOT, "Lihkg_env"),
    smoke: { argv: [PYTHON, "src\\scrape_category.py", "--help"] },
    buildProbe(input) {
      return buildLihkgProbe(input);
    },
    buildCrawl(input) {
      return buildLihkgProbe(input);
    },
  },
  {
    platform: "facebook",
    label: "Facebook",
    toolName: "crawl_facebook_social",
    description:
      "调用 Facebook 搜索脚本按候选事件做小范围复核，默认 dry-run 且不推送 Kan。",
    cwd: join(CRAWLER_ROOT, "Facebook", "facebook-pages-scraper"),
    envFile: join(CRAWLER_ENV_ROOT, "Facebook_env"),
    smoke: { argv: [PYTHON, "scripts\\facebook_search.py", "--help"] },
    buildProbe(input) {
      if (input.phase === "discover") {
        const output = outputCsvPath("facebook", "discover");
        return {
          argv: [
            PYTHON,
            "scripts\\facebook_search.py",
            "--discover",
            "--type",
            "posts",
            "--days",
            "1",
            "--limit",
            String(input.limit),
            "--dry-run",
            "--output",
            output,
          ],
          artifacts: [{ label: "Facebook 首页发现帖子", path: output, kind: "csv" }],
        };
      }
      const eventTitle = eventTitleOrUnsupported(input, "Facebook");
      if (typeof eventTitle !== "string") return eventTitle;
      const output = outputCsvPath("facebook", "probe");
      return {
        argv: [
          PYTHON,
          "scripts\\facebook_search.py",
          eventTitle,
          "--type",
          "posts",
          "--days",
          "1",
          "--dry-run",
          "--output",
          output,
        ],
        artifacts: [{ label: "Facebook 帖子", path: output, kind: "csv" }],
      };
    },
    buildCrawl(input) {
      if (input.phase === "discover") {
        const output = outputCsvPath("facebook", "discover");
        return {
          argv: [
            PYTHON,
            "scripts\\facebook_search.py",
            "--discover",
            "--type",
            "posts",
            "--days",
            "1",
            "--limit",
            String(input.limit),
            "--output",
            output,
          ],
          artifacts: [{ label: "Facebook 首页发现帖子", path: output, kind: "csv" }],
        };
      }
      const eventTitle = eventTitleOrUnsupported(input, "Facebook");
      if (typeof eventTitle !== "string") return eventTitle;
      const output = outputCsvPath("facebook", "crawl");
      return {
        argv: [
          PYTHON,
          "scripts\\facebook_search.py",
          eventTitle,
          "--type",
          "posts",
          "--days",
          "1",
          "--output",
          output,
        ],
        artifacts: [{ label: "Facebook 帖子", path: output, kind: "csv" }],
      };
    },
  },
  {
    platform: "github",
    label: "GitHub",
    toolName: "crawl_github_social",
    description:
      "调用 GitHub 爬虫做最新公开仓库发现或候选事件复核，默认不进入监控推送模式。",
    cwd: join(CRAWLER_ROOT, "GitHub"),
    envFile: join(CRAWLER_ENV_ROOT, "GitHub_env"),
    smoke: { argv: [PYTHON, "github_crawler.py", "--help"] },
    buildProbe(input) {
      return buildGithubProbe(input);
    },
    buildCrawl(input) {
      return buildGithubProbe(input);
    },
  },
  {
    platform: "instagram",
    label: "Instagram",
    toolName: "crawl_instagram_social",
    description:
      "调用 Instagram/Threads 监控入口，默认只运行一轮且不推送 Kan。",
    cwd: join(CRAWLER_ROOT, "instagram", "monitor_hub"),
    envFile: join(CRAWLER_ENV_ROOT, "instagram_env"),
    smoke: { argv: [PYTHON, "main.py", "--help"] },
    buildProbe(input) {
      return buildInstagramProbe(input);
    },
    buildCrawl(input) {
      return buildInstagramProbe(input);
    },
  },
  {
    platform: "lien",
    label: "Lien",
    toolName: "crawl_lien_social",
    description:
      "调用 LinkedIn/Lien 爬虫工程做程序加载探测；真实爬取需提供 URL 和登录会话。",
    cwd: join(CRAWLER_ROOT, "Lien", "linkedin_scraper"),
    envFile: join(CRAWLER_ENV_ROOT, "Lien_env"),
    smoke: { argv: [PYTHON, "setup.py", "--name"] },
    buildProbe() {
      return { argv: [PYTHON, "setup.py", "--name"] };
    },
    buildCrawl(_input) {
      return buildLienProbe();
    },
  },
  {
    platform: "netlight",
    label: "NetLight",
    toolName: "crawl_netlight_social",
    description:
      "调用 Matrix/NetLight 房间消息爬虫，默认限制少量消息且不下载媒体。",
    cwd: join(CRAWLER_ROOT, "NetLight"),
    envFile: join(CRAWLER_ENV_ROOT, "NetLight_env"),
    smoke: { argv: [PYTHON, "matrix_message_fetcher.py", "--help"] },
    buildProbe(input) {
      return buildNetlightProbe(input);
    },
    buildCrawl(input) {
      return buildNetlightProbe(input);
    },
  },
  {
    platform: "ptt",
    label: "PTT",
    toolName: "crawl_ptt_social",
    description:
      "调用 PTT HTTPS 爬虫做最新文章发现或候选事件复核。",
    cwd: join(CRAWLER_ROOT, "PTT", "PyPtt"),
    envFile: join(CRAWLER_ENV_ROOT, "PTT_env"),
    smoke: { argv: [PYTHON, "scripts\\crawl_ptt_http.py", "--help"] },
    buildProbe(input) {
      return buildPttProbe(input);
    },
    buildCrawl(input) {
      return buildPttProbe(input);
    },
  },
  {
    platform: "youtube",
    label: "YouTube",
    toolName: "crawl_youtube_social",
    description:
      "调用 YouTube 监控程序做程序加载探测；真实监控由 avtdl 配置控制。",
    cwd: join(CRAWLER_ROOT, "YouTube", "avtdl"),
    envFile: join(CRAWLER_ENV_ROOT, "YouTube_env"),
    smoke: { argv: [PYTHON, "avtdl.py", "--help"] },
    buildProbe(input) {
      return buildYoutubeProbe(input);
    },
    buildCrawl(input) {
      return buildYoutubeProbe(input);
    },
  },
];

function createChinaGateTool(): ToolDefinition {
  return {
    name: "assess_china_relevance",
    description:
      "对爬虫返回的轻量信号做中国相关性和风险门槛预判，只有中国相关且存在对中国安全或利益不利的风险时才允许深度爬取。",
    categories: ["research", "social"] as readonly ToolCategory[],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: [],
    },
    async execute(input): Promise<ToolResult> {
      const gate = buildKeywordChinaGate({
        title: getString(input, "title", { allowEmpty: true }) ?? "",
        summary: getString(input, "summary", { allowEmpty: true }) ?? "",
        evidence: Array.isArray(input.evidence)
          ? input.evidence.filter((item): item is string => typeof item === "string")
          : [],
      });
      return {
        output: jsonOutput(gate),
        isError: false,
      };
    },
  };
}

function createFusionTool(): ToolDefinition {
  return {
    name: "fuse_social_reports",
    description:
      "把多个平台 Agent 上报的结构化报告做确定性合并，用于验证社交融合智能体的聚合工具链。",
    categories: ["analytics", "social"] as readonly ToolCategory[],
    inputSchema: {
      type: "object",
      properties: {
        reports: {
          type: "array",
          items: { type: "object" },
        },
      },
      required: ["reports"],
    },
    async execute(input): Promise<ToolResult> {
      if (!Array.isArray(input.reports)) {
        return {
          output: "reports must be an array",
          isError: true,
          errorCode: "INVALID_INPUT",
        };
      }
      const { deterministicFusion } = await import("../pipelines/social/fusion");
      const { platformReportSchema } = await import("../pipelines/social/schemas");
      const reports = input.reports.map((report) => platformReportSchema.parse(report));
      return {
        output: jsonOutput(deterministicFusion(reports)),
        isError: false,
      };
    },
  };
}

export function createCrawlerTools(): readonly ToolDefinition[] {
  return [
    createChinaGateTool(),
    ...SPECS.map(createExternalCrawlerTool),
    createFusionTool(),
  ];
}

export const SOCIAL_AGENT_TOOL_BINDINGS: Record<string, readonly string[]> = {
  "china-relevance-gate": ["assess_china_relevance"],
  "social-control-agent": [],
  "x-social-agent": ["crawl_x_social"],
  "telegram-social-agent": ["crawl_telegram_social"],
  "lihkg-social-agent": ["crawl_lihkg_social"],
  "facebook-social-agent": ["crawl_facebook_social"],
  "github-social-agent": ["crawl_github_social"],
  "instagram-social-agent": ["crawl_instagram_social"],
  "lien-social-agent": ["crawl_lien_social"],
  "netlight-social-agent": ["crawl_netlight_social"],
  "ptt-social-agent": ["crawl_ptt_social"],
  "youtube-social-agent": ["crawl_youtube_social"],
  "social-fusion-agent": ["fuse_social_reports"],
};

export const SOCIAL_PLATFORM_CRAWLER_TOOLS = {
  x: "crawl_x_social",
  telegram: "crawl_telegram_social",
  lihkg: "crawl_lihkg_social",
  facebook: "crawl_facebook_social",
  github: "crawl_github_social",
  instagram: "crawl_instagram_social",
  lien: "crawl_lien_social",
  netlight: "crawl_netlight_social",
  ptt: "crawl_ptt_social",
  youtube: "crawl_youtube_social",
} as const;
