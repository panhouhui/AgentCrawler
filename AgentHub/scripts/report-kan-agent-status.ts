type PlatformState = {
  readonly status?: string;
  readonly cycle?: number;
  readonly lastCheckedAt?: number | null;
  readonly lastSuccessAt?: number | null;
  readonly lastFailureAt?: number | null;
  readonly discoveredCount?: number;
  readonly rawRecordCount?: number;
  readonly evidenceCount?: number;
  readonly skippedCount?: number;
  readonly errorCount?: number;
};

type MonitorRun = {
  readonly id?: string;
  readonly status?: string;
  readonly currentCycle?: number;
  readonly startedAt?: number | null;
  readonly updatedAt?: number | null;
  readonly stoppedAt?: number | null;
  readonly lastCycleStartedAt?: number | null;
  readonly lastCycleCompletedAt?: number | null;
  readonly platformStates?: Record<string, PlatformState>;
  readonly kanQueue?: Array<{
    readonly status?: string;
    readonly error?: string | null;
    readonly createdAt?: number;
  }>;
};

type ApiResponse<T> = {
  readonly success?: boolean;
  readonly data?: T;
  readonly error?: string;
};

type ReportPayload = {
  readonly display_name?: string;
  readonly reported_at: string;
  readonly last_scan_at: string;
  readonly period_started_at: string;
  readonly stale_after_seconds: number;
  readonly scan_round: number;
  readonly scan_success_count: number;
  readonly candidate_post_count: number;
  readonly ai_approved_count: number;
  readonly ai_filtered_count: number;
  readonly ai_analysis_error_count: number;
  readonly published_count: number;
  readonly published_normal_count: number;
  readonly published_apec_count: number;
  readonly fetch_failure_count: number;
  readonly publish_failure_count: number;
};

const DEFAULT_ENDPOINT = "https://kan.cool/api/external/agent-status/report";
const DEFAULT_API_BASE = "http://127.0.0.1:48080";
const DEFAULT_STALE_AFTER_SECONDS = 900;

function argValue(name: string, fallback = ""): string {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1] ?? fallback;
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function numberValue(name: string, fallback: number): number {
  const raw = argValue(name, "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function assertNonEmpty(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function toNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function formatChinaTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000 + 8 * 60 * 60 * 1000);
  const text = date.toISOString().replace("Z", "");
  return `${text.slice(0, 19)}+08:00`;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AgentHub API ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

function latestTime(...values: Array<number | null | undefined>): number {
  const valid = values
    .map((value) => toNumber(value, 0))
    .filter((value) => value > 0);
  return valid.length > 0 ? Math.max(...valid) : unixNow();
}

function isGlobalRadarPlatform(platform: string): boolean {
  return platform === "global-radar" || platform === "global" || platform === "radar";
}

function buildGlobalRadarPayload(
  run: MonitorRun | null,
  staleAfterSeconds: number,
  displayName: string,
): ReportPayload {
  const states = Object.values(run?.platformStates ?? {});
  const scanRound = Math.max(
    0,
    toNumber(run?.currentCycle, Math.max(0, ...states.map((state) => toNumber(state.cycle, 0)))),
  );
  const lastScanAt = latestTime(
    ...states.flatMap((state) => [
      state.lastCheckedAt,
      state.lastSuccessAt,
      state.lastFailureAt,
    ]),
    run?.lastCycleStartedAt,
    run?.lastCycleCompletedAt,
    run?.updatedAt,
  );
  const platformFailureCount = states.filter(
    (state) =>
      state.status === "error" ||
      toNumber(state.lastFailureAt, 0) > toNumber(state.lastSuccessAt, 0),
  ).length;
  const platformSuccessCount = states.filter(
    (state) => toNumber(state.lastSuccessAt, 0) > 0 && state.status !== "missing_config",
  ).length;
  const rawRecordCount = states.reduce(
    (sum, state) => sum + Math.max(0, toNumber(state.rawRecordCount, 0)),
    0,
  );
  const evidenceCount = states.reduce(
    (sum, state) => sum + Math.max(0, toNumber(state.evidenceCount, 0)),
    0,
  );
  const skippedCount = states.reduce(
    (sum, state) => sum + Math.max(0, toNumber(state.skippedCount, 0)),
    0,
  );
  const candidateCount = Math.max(
    rawRecordCount,
    states.reduce(
      (sum, state) => sum + Math.max(0, toNumber(state.discoveredCount, 0)),
      0,
    ),
  );
  const sentQueue = (run?.kanQueue ?? []).filter((item) => item.status === "sent");
  const failedQueue = (run?.kanQueue ?? []).filter(
    (item) => item.status === "pending" && typeof item.error === "string" && item.error.trim(),
  );

  return {
    ...(displayName ? { display_name: displayName } : {}),
    reported_at: formatChinaTime(unixNow()),
    last_scan_at: formatChinaTime(lastScanAt),
    period_started_at: formatChinaTime(latestTime(run?.startedAt)),
    stale_after_seconds: staleAfterSeconds,
    scan_round: scanRound,
    scan_success_count: Math.max(
      platformSuccessCount,
      scanRound > 0 ? scanRound - Math.min(platformFailureCount, Math.max(0, scanRound - 1)) : 0,
    ),
    candidate_post_count: candidateCount,
    ai_approved_count: evidenceCount,
    ai_filtered_count: Math.max(skippedCount, rawRecordCount > 0 ? rawRecordCount - evidenceCount : 0),
    ai_analysis_error_count: 0,
    published_count: sentQueue.length,
    published_normal_count: sentQueue.length,
    published_apec_count: 0,
    fetch_failure_count: platformFailureCount,
    publish_failure_count: failedQueue.length,
  };
}

function buildPayload(
  run: MonitorRun | null,
  platform: string,
  staleAfterSeconds: number,
  displayName: string,
): ReportPayload {
  if (isGlobalRadarPlatform(platform)) {
    return buildGlobalRadarPayload(run, staleAfterSeconds, displayName);
  }

  const state = run?.platformStates?.[platform] ?? {};
  const scanRound = Math.max(0, toNumber(state.cycle, toNumber(run?.currentCycle, 0)));
  const fetchFailureCount = Math.max(0, toNumber(state.errorCount, 0));
  const rawRecordCount = Math.max(0, toNumber(state.rawRecordCount, 0));
  const evidenceCount = Math.max(0, toNumber(state.evidenceCount, 0));
  const skippedCount = Math.max(0, toNumber(state.skippedCount, 0));
  const candidateCount = Math.max(0, toNumber(state.discoveredCount, rawRecordCount));
  const sentQueue = (run?.kanQueue ?? []).filter((item) => item.status === "sent");
  const failedQueue = (run?.kanQueue ?? []).filter(
    (item) => item.status === "pending" && typeof item.error === "string" && item.error.trim(),
  );
  const lastScanAt = latestTime(
    state.lastCheckedAt,
    state.lastSuccessAt,
    state.lastFailureAt,
    run?.lastCycleStartedAt,
    run?.lastCycleCompletedAt,
    run?.updatedAt,
  );
  const periodStartedAt = latestTime(run?.startedAt);

  return {
    ...(displayName ? { display_name: displayName } : {}),
    reported_at: formatChinaTime(unixNow()),
    last_scan_at: formatChinaTime(lastScanAt),
    period_started_at: formatChinaTime(periodStartedAt),
    stale_after_seconds: staleAfterSeconds,
    scan_round: scanRound,
    scan_success_count: Math.max(0, scanRound - fetchFailureCount),
    candidate_post_count: candidateCount,
    ai_approved_count: evidenceCount,
    ai_filtered_count: Math.max(skippedCount, rawRecordCount > 0 ? rawRecordCount - evidenceCount : 0),
    ai_analysis_error_count: 0,
    published_count: sentQueue.length,
    published_normal_count: sentQueue.length,
    published_apec_count: 0,
    fetch_failure_count: fetchFailureCount,
    publish_failure_count: failedQueue.length,
  };
}

async function postReport(input: {
  readonly endpoint: string;
  readonly reportKey: string;
  readonly secret: string;
  readonly payload: ReportPayload;
}): Promise<{ readonly status: number; readonly body: string }> {
  if (/[^\x20-\x7e]/.test(input.reportKey)) {
    return postReportWithCurl(input);
  }

  try {
    return await postReportWithFetch(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/header/i.test(message) && /invalid/i.test(message)) {
      return postReportWithCurl(input);
    }
    throw error;
  }
}

async function postReportWithFetch(input: {
  readonly endpoint: string;
  readonly reportKey: string;
  readonly secret: string;
  readonly payload: ReportPayload;
}): Promise<{ readonly status: number; readonly body: string }> {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Report-Key": input.reportKey,
      Authorization: `Bearer ${input.secret}`,
    },
    body: JSON.stringify(input.payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`KAN status report failed ${response.status}: ${body.slice(0, 500)}`);
  }
  return { status: response.status, body };
}

async function postReportWithCurl(input: {
  readonly endpoint: string;
  readonly reportKey: string;
  readonly secret: string;
  readonly payload: ReportPayload;
}): Promise<{ readonly status: number; readonly body: string }> {
  const { spawnSync } = await import("node:child_process");
  const marker = "\n__AGENT_STATUS_HTTP_STATUS__:";
  const result = spawnSync(
    "curl",
    [
      "--fail-with-body",
      "-sS",
      "-X",
      "POST",
      input.endpoint,
      "-H",
      "Content-Type: application/json",
      "-H",
      `X-Agent-Report-Key: ${input.reportKey}`,
      "-H",
      `Authorization: Bearer ${input.secret}`,
      "--data-binary",
      "@-",
      "-w",
      `${marker}%{http_code}`,
    ],
    {
      input: JSON.stringify(input.payload),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const markerIndex = combined.lastIndexOf(marker);
  const body = markerIndex >= 0 ? combined.slice(0, markerIndex) : combined;
  const statusText = markerIndex >= 0 ? combined.slice(markerIndex + marker.length).trim() : "";
  const status = Number(statusText);
  if (result.status !== 0 || !Number.isFinite(status) || status >= 400) {
    throw new Error(
      `KAN status report failed ${Number.isFinite(status) ? status : result.status}: ${body.slice(0, 500)}`,
    );
  }
  return { status, body };
}

async function main(): Promise<void> {
  const platform = assertNonEmpty(argValue("platform", "x"), "缺少 --platform").toLowerCase();
  const reportKey = assertNonEmpty(argValue("report-key", ""), "缺少 --report-key");
  const displayName = argValue("display-name", process.env.KAN_AGENT_STATUS_DISPLAY_NAME ?? "");
  const endpoint = argValue("endpoint", process.env.KAN_AGENT_STATUS_REPORT_ENDPOINT ?? DEFAULT_ENDPOINT);
  const apiBase = argValue("api-base", process.env.AGENTHUB_STATUS_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const staleAfterSeconds = numberValue("stale-after-seconds", DEFAULT_STALE_AFTER_SECONDS);
  const webToken = assertNonEmpty(
    argValue("web-token", process.env.OPENCROW_WEB_TOKEN ?? ""),
    "缺少 OPENCROW_WEB_TOKEN 或 --web-token",
  );
  const secret = argValue("secret", process.env.KAN_AGENT_STATUS_REPORT_SECRET ?? "");

  const latest = await fetchJson<ApiResponse<MonitorRun | null>>(
    `${apiBase}/api/social/monitor/latest`,
    webToken,
  );
  const payload = buildPayload(latest.data ?? null, platform, staleAfterSeconds, displayName);

  if (hasFlag("dry-run")) {
    console.log(JSON.stringify({ ok: true, dryRun: true, reportKey, platform, payload }, null, 2));
    return;
  }

  assertNonEmpty(secret, "缺少 KAN_AGENT_STATUS_REPORT_SECRET 或 --secret");
  const result = await postReport({ endpoint, reportKey, secret, payload });
  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        reportKey,
        platform,
        httpStatus: result.status,
        responseHead: result.body.slice(0, 500),
        payload,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
