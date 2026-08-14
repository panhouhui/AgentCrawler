import type { FusedSocialEvent, PlatformReport } from "./schemas";

export interface SocialFusionDedupeFingerprint {
  readonly eventKey: string;
  readonly eventTitle: string;
  readonly urls: readonly string[];
  readonly nodes: readonly string[];
  readonly titleTokens: readonly string[];
  readonly platforms: readonly string[];
}

export interface SocialFusionDedupeComparison {
  readonly isDuplicate: boolean;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly commonUrls: readonly string[];
  readonly commonNodes: readonly string[];
  readonly commonTitleTokens: readonly string[];
}

interface EvidenceBundleLike {
  readonly signal?: {
    readonly platform?: string;
    readonly title?: string;
    readonly summary?: string;
    readonly evidence?: readonly string[];
    readonly raw?: unknown;
  };
}

const COMMON_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "about",
  "breaking",
  "news",
  "update",
  "video",
  "post",
  "china",
  "chinese",
  "hong",
  "kong",
  "taiwan",
  "中国",
  "中國",
  "香港",
  "台湾",
  "臺灣",
  "美国",
  "美國",
  "日本",
  "政府",
  "官方",
  "消息",
  "事件",
  "视频",
  "新聞",
  "新闻",
  "最新",
  "相關",
  "相关",
  "傳言",
  "传言",
  "討論",
  "讨论",
  "爆料",
  "发布",
  "發布",
  "回应",
  "回應",
  "去世",
  "病逝",
  "逝世",
  "死亡",
  "死讯",
  "死訊",
  "有人",
  "目前",
  "突发",
  "突發",
  "政治",
  "安全",
  "中国政治",
  "中共政治",
  "国家安全",
  "政权安全",
]);

const NODE_KEYS = [
  "channel",
  "channelName",
  "channel_name",
  "chat_title",
  "dialog_title",
  "channel_title",
  "room_name",
  "board",
  "page",
  "page_name",
  "author",
  "author_username",
  "username",
  "screen_name",
  "sender",
  "source",
  "source_name",
  "repository",
  "repository_name",
  "full_name",
] as const;

export function buildSocialFusionDedupeFingerprint(input: {
  readonly fused: FusedSocialEvent;
  readonly reports: readonly PlatformReport[];
  readonly evidenceBundles?: readonly EvidenceBundleLike[];
}): SocialFusionDedupeFingerprint {
  const urls = new Set<string>();
  const nodes = new Set<string>();
  const titleTexts = new Set<string>();
  const platforms = new Set<string>();

  titleTexts.add(input.fused.event_title);
  collectUrls(input.fused.evidence, urls);
  for (const node of input.fused.core_propagation_nodes) addNode(nodes, node);

  for (const report of input.reports) {
    if (report.detection_status === "not_found") continue;
    platforms.add(report.platform);
    titleTexts.add(report.event_title);
    titleTexts.add(report.summary);
    collectUrls(report.evidence, urls);
    collectNodes(report, nodes);
    collectPlatformSpecificNodes(report, nodes);
  }

  for (const bundle of input.evidenceBundles ?? []) {
    const signal = bundle.signal;
    if (!signal) continue;
    if (signal.platform) platforms.add(signal.platform);
    if (signal.title) titleTexts.add(signal.title);
    if (signal.summary) titleTexts.add(signal.summary);
    collectUrls(signal.evidence ?? [], urls);
    collectUrls(signal.raw, urls);
    collectNodes(signal.raw, nodes);
    collectTitles(signal.raw, titleTexts);
  }

  return {
    eventKey: input.fused.event_key,
    eventTitle: input.fused.event_title,
    urls: [...urls].sort().slice(0, 40),
    nodes: [...nodes].sort().slice(0, 40),
    titleTokens: tokensFromTexts([...titleTexts]).slice(0, 80),
    platforms: [...platforms].sort(),
  };
}

export function deriveSocialFusionDedupeFingerprintFromPayload(
  payload: Record<string, unknown>,
): SocialFusionDedupeFingerprint {
  const event = asRecord(payload.event);
  const reports = Array.isArray(payload.platformReports)
    ? payload.platformReports.filter((item): item is Record<string, unknown> =>
        Boolean(asRecord(item)),
      )
    : [];
  const platformEvidence = Array.isArray(payload.platformEvidence)
    ? payload.platformEvidence.filter((item): item is Record<string, unknown> =>
        Boolean(asRecord(item)),
      )
    : [];

  const urls = new Set<string>();
  const nodes = new Set<string>();
  const titleTexts = new Set<string>();
  const platforms = new Set<string>();
  const eventTitle = stringValue(event?.event_title) || stringValue(event?.title) || "";
  const eventKey = stringValue(event?.event_key) || "";

  if (eventTitle) titleTexts.add(eventTitle);
  collectUrls(payload, urls);
  collectNodes(event, nodes);
  for (const node of arrayOfStrings(event?.core_propagation_nodes)) addNode(nodes, node);

  for (const report of reports) {
    const detection = stringValue(report.detection_status);
    if (detection === "not_found") continue;
    const platform = stringValue(report.platform);
    if (platform) platforms.add(platform);
    const title = stringValue(report.event_title) || stringValue(report.title);
    if (title) titleTexts.add(title);
    const summary = stringValue(report.summary);
    if (summary) titleTexts.add(summary);
    collectNodes(report, nodes);
    collectUrls(report, urls);
  }

  for (const snapshot of platformEvidence) {
    const platform = stringValue(snapshot.platform);
    if (platform) platforms.add(platform);
    const title = stringValue(snapshot.title);
    if (title) titleTexts.add(title);
    collectNodes(snapshot, nodes);
    collectUrls(snapshot, urls);
    collectTitles(snapshot, titleTexts);
  }

  return {
    eventKey,
    eventTitle,
    urls: [...urls].sort().slice(0, 40),
    nodes: [...nodes].sort().slice(0, 40),
    titleTokens: tokensFromTexts([...titleTexts]).slice(0, 80),
    platforms: [...platforms].sort(),
  };
}

export function buildSocialFusionDedupeKey(
  fingerprint: SocialFusionDedupeFingerprint,
  fallbackEventKey: string,
): string {
  if (fingerprint.urls.length > 0) {
    return `social-fusion:url:${hashParts(fingerprint.urls)}`;
  }
  if (fingerprint.nodes.length > 0 && fingerprint.titleTokens.length > 0) {
    return `social-fusion:node-title:${hashParts([
      ...fingerprint.nodes.slice(0, 12),
      ...fingerprint.titleTokens.slice(0, 24),
    ])}`;
  }
  if (fingerprint.titleTokens.length > 0) {
    return `social-fusion:title:${hashParts(fingerprint.titleTokens.slice(0, 32))}`;
  }
  return `social-fusion:${fallbackEventKey}`;
}

export function compareSocialFusionDedupeFingerprints(
  current: SocialFusionDedupeFingerprint,
  previous: SocialFusionDedupeFingerprint,
): SocialFusionDedupeComparison {
  const commonUrls = intersection(current.urls, previous.urls);
  const commonNodes = intersection(current.nodes, previous.nodes);
  const commonTitleTokens = intersection(current.titleTokens, previous.titleTokens);
  const titleOverlap = overlapRatio(current.titleTokens, previous.titleTokens);
  const nodeOverlap = overlapRatio(current.nodes, previous.nodes);
  const reasons: string[] = [];

  if (commonUrls.length > 0) {
    reasons.push(`公开 URL 重合 ${commonUrls.length} 个`);
    return {
      isDuplicate: true,
      score: 0.98,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  if (commonNodes.length >= 2) {
    reasons.push(`公开传播节点重合 ${commonNodes.length} 个`);
    return {
      isDuplicate: true,
      score: 0.9,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  if (commonNodes.length >= 1 && commonTitleTokens.length >= 2 && titleOverlap >= 0.25) {
    reasons.push("公开节点和标题实体同时重合");
    return {
      isDuplicate: true,
      score: 0.86,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  if (hasPoliticalSecurityCoreOverlap(commonTitleTokens)) {
    reasons.push("政治安全核心实体高度重合");
    return {
      isDuplicate: true,
      score: 0.85,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  if (hasStrongCommonToken(commonTitleTokens) && commonTitleTokens.length >= 3 && titleOverlap >= 0.3) {
    reasons.push("标题中的核心实体高度相似");
    return {
      isDuplicate: true,
      score: 0.84,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  if (commonTitleTokens.length >= 4 && titleOverlap >= 0.55) {
    reasons.push("标题实体词高度重合");
    return {
      isDuplicate: true,
      score: 0.82,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  const score = Math.max(
    commonUrls.length > 0 ? 0.98 : 0,
    commonNodes.length > 0 ? Math.min(0.7, 0.35 + nodeOverlap * 0.35) : 0,
    commonTitleTokens.length > 0 ? Math.min(0.72, titleOverlap * 0.72) : 0,
  );
  if (commonNodes.length > 0) reasons.push(`公开节点部分重合 ${commonNodes.length} 个`);
  if (commonTitleTokens.length > 0) reasons.push(`标题实体词部分重合 ${commonTitleTokens.length} 个`);
  return {
    isDuplicate: false,
    score,
    reasons,
    commonUrls,
    commonNodes,
    commonTitleTokens,
  };
}

function collectPlatformSpecificNodes(report: PlatformReport, nodes: Set<string>): void {
  switch (report.platform) {
    case "telegram":
      for (const node of [...report.channel_path, ...report.bridge_channels]) addNode(nodes, node);
      break;
    case "facebook":
      for (const node of report.pages) addNode(nodes, node);
      break;
    case "github":
    case "instagram":
    case "lien":
    case "netlight":
    case "ptt":
    case "youtube":
      for (const node of report.source_nodes) addNode(nodes, node);
      break;
    case "x":
      addNode(nodes, report.hashtag);
      break;
    case "lihkg":
      addNode(nodes, report.topic);
      break;
  }
}

function collectTitles(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 3 || out.size >= 40) return;
  const record = asRecord(value);
  if (!record) return;
  for (const key of ["title", "event_title", "topic", "subject", "message_text", "content"]) {
    const valueForKey = stringValue(record[key]);
    if (valueForKey) out.add(valueForKey);
  }
  for (const nested of Object.values(record)) collectTitles(nested, out, depth + 1);
}

function collectNodes(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 4 || out.size >= 60) return;
  const record = asRecord(value);
  if (!record) return;
  for (const key of NODE_KEYS) addNode(out, record[key]);
  for (const nested of Object.values(record)) collectNodes(nested, out, depth + 1);
}

function collectUrls(value: unknown, out: Set<string>): void {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const urls = text.match(/https?:\/\/[^\s"'<>\\]+/gi) ?? [];
  for (const url of urls) {
    const canonical = canonicalUrl(url);
    if (canonical) out.add(canonical);
  }
}

function canonicalUrl(value: string): string {
  const clean = value.replace(/[),.;\]}]+$/g, "");
  try {
    const url = new URL(clean);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        ["fbclid", "gclid", "igshid", "spm", "ref", "feature"].includes(key)
      ) {
        url.searchParams.delete(key);
      }
    }
    const host = url.hostname
      .replace(/^www\./, "")
      .replace(/^mobile\./, "")
      .replace(/^m\./, "")
      .replace(/^twitter\.com$/, "x.com");
    if (host === "youtu.be") {
      const videoId = url.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
      return videoId ? `https://youtube.com/watch?v=${videoId}` : "";
    }
    url.hostname = host;
    const normalized = url.toString().replace(/\/$/, "");
    return normalized.toLowerCase();
  } catch {
    return "";
  }
}

function addNode(out: Set<string>, value: unknown): void {
  const normalized = normalizeToken(stringValue(value));
  if (!normalized || COMMON_TOKENS.has(normalized)) return;
  if (/^[\p{Script=Han}]{2,}$/u.test(normalized) || normalized.length >= 3) {
    out.add(normalized);
  }
}

function tokensFromTexts(texts: readonly string[]): string[] {
  const tokens = new Set<string>();
  for (const text of texts) {
    const normalized = normalizeForSearch(text);
    for (const token of normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []) {
      addTitleToken(tokens, token);
    }
    for (const segment of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
      if (segment.length <= 8) addTitleToken(tokens, segment);
      for (let size = 2; size <= 4; size += 1) {
        if (segment.length < size) continue;
        for (let index = 0; index <= segment.length - size; index += 1) {
          addTitleToken(tokens, segment.slice(index, index + size));
        }
      }
    }
  }
  return [...tokens].sort();
}

function addTitleToken(out: Set<string>, value: string): void {
  const token = normalizeToken(value);
  if (!token || COMMON_TOKENS.has(token)) return;
  if (/^[a-z0-9_-]+$/.test(token) && token.length < 3) return;
  if (/^[\p{Script=Han}]+$/u.test(token) && token.length < 2) return;
  out.add(token);
}

function hasStrongCommonToken(tokens: readonly string[]): boolean {
  return tokens.some((token) =>
    /^[\p{Script=Han}]{3,}$/u.test(token) || /^[a-z0-9_-]{5,}$/i.test(token),
  );
}

function hasPoliticalSecurityCoreOverlap(tokens: readonly string[]): boolean {
  const joined = tokens.join(" ");
  const keyTerms = [
    "中国政治",
    "国家安全",
    "政权",
    "颠覆",
    "顛覆",
    "不当言论",
    "不當言論",
    "反政府",
    "反中",
    "反華",
    "反华",
    "港独",
    "台独",
    "疆独",
    "藏独",
    "谣言",
    "謠言",
    "虚假",
    "虚假信息",
    "假消息",
    "政治",
  ];
  return keyTerms.some((term) => joined.includes(term));
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().normalize("NFKC");
}

function normalizeToken(value: string): string {
  return normalizeForSearch(value)
    .replace(/[^\p{Letter}\p{Number}_#@-]+/gu, "")
    .replace(/^[@#]+/, "")
    .trim();
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function arrayOfStrings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function intersection(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((item) => rightSet.has(item));
}

function overlapRatio(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const minSize = Math.min(leftSet.size, rightSet.size);
  if (minSize === 0) return 0;
  let common = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) common += 1;
  }
  return common / minSize;
}

function hashParts(parts: readonly string[]): string {
  return hashString([...new Set(parts)].sort().join("|"));
}

function hashString(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
