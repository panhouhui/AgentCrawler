import type { FusedSocialEvent, PlatformReport } from "./schemas";

export interface SocialFusionDedupeFingerprint {
  readonly fingerprintVersion: 2;
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
  readonly status?: string;
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
  "facebook",
  "github",
  "instagram",
  "lien",
  "lihkg",
  "netlight",
  "ptt",
  "telegram",
  "webpage",
  "preview",
  "youtube",
  "https",
  "www",
  "com",
  "一事",
  "一事件",
  "不要",
  "不要求",
  "不要求真",
  "也发",
  "也發",
  "也发现",
  "也發現",
  "也发现了",
  "也發現了",
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

export function buildSocialFusionDedupeFingerprint(input: {
  readonly fused: FusedSocialEvent;
  readonly reports: readonly PlatformReport[];
  readonly evidenceBundles?: readonly EvidenceBundleLike[];
  readonly candidate?: {
    readonly platform?: string;
    readonly title?: string;
    readonly raw?: unknown;
  };
}): SocialFusionDedupeFingerprint {
  const urls = new Set<string>();
  const nodes = new Set<string>();
  const titleTexts = new Set<string>();
  const platforms = new Set<string>();

  titleTexts.add(input.fused.event_title);

  if (input.candidate) {
    if (input.candidate.platform) platforms.add(input.candidate.platform);
    if (input.candidate.title) titleTexts.add(input.candidate.title);
    collectAnchoredEvidence(input.candidate.raw, urls, nodes);
  }

  for (const report of input.reports) {
    if (report.detection_status === "not_found") continue;
    platforms.add(report.platform);
    titleTexts.add(report.event_title);
  }

  for (const bundle of input.evidenceBundles ?? []) {
    if (bundle.status && bundle.status !== "found") continue;
    const signal = bundle.signal;
    if (!signal) continue;
    if (signal.platform) platforms.add(signal.platform);
    collectAnchoredEvidence(
      signal.raw,
      urls,
      nodes,
      titleTexts,
      input.fused.event_title,
    );
  }

  return {
    fingerprintVersion: 2,
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
  collectAnchoredEvidence(payload.candidateAnchor, urls, nodes, titleTexts);

  for (const snapshot of platformEvidence) {
    const status = stringValue(snapshot.status);
    if (status && status !== "found") continue;
    const platform = stringValue(snapshot.platform);
    if (platform) platforms.add(platform);
    collectAnchoredEvidence(snapshot.evidence, urls, nodes, titleTexts, eventTitle);
  }

  return {
    fingerprintVersion: 2,
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
  const reliableUrls = fingerprint.urls.filter(isReliableEventUrl);
  if (reliableUrls.length > 0) {
    return `social-fusion:v2:url:${hashParts(reliableUrls)}`;
  }
  if (fingerprint.nodes.length > 0 && fingerprint.titleTokens.length > 0) {
    return `social-fusion:v2:node-title:${hashParts([
      ...fingerprint.nodes.slice(0, 12),
      ...fingerprint.titleTokens.slice(0, 24),
    ])}`;
  }
  if (fingerprint.titleTokens.length > 0) {
    return `social-fusion:v2:title:${hashParts(fingerprint.titleTokens.slice(0, 32))}`;
  }
  return `social-fusion:v2:${fallbackEventKey}`;
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
  const currentReliableUrls = current.urls.filter(isReliableEventUrl);
  const previousReliableUrls = previous.urls.filter(isReliableEventUrl);
  const commonReliableUrls = intersection(currentReliableUrls, previousReliableUrls);
  const newReliableUrls = difference(currentReliableUrls, previousReliableUrls);
  const newPlatforms = difference(current.platforms, previous.platforms);
  const reasons: string[] = [];

  if (newReliableUrls.length > 0 || newPlatforms.length > 0) {
    if (newReliableUrls.length > 0) reasons.push(`新增可靠原帖 ${newReliableUrls.length} 个`);
    if (newPlatforms.length > 0) reasons.push(`新增发现平台 ${newPlatforms.length} 个`);
    return {
      isDuplicate: false,
      score: commonReliableUrls.length > 0 ? 0.78 : 0,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  if (commonReliableUrls.length > 0) {
    reasons.push(`可靠原帖 URL 重合 ${commonReliableUrls.length} 个`);
    return {
      isDuplicate: true,
      score: 0.98,
      reasons,
      commonUrls: commonReliableUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  if (
    current.eventKey &&
    previous.eventKey &&
    normalizeToken(current.eventKey) === normalizeToken(previous.eventKey)
  ) {
    reasons.push("事件 key 完全相同，且没有新增可靠证据");
    return {
      isDuplicate: true,
      score: 0.94,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  const hasDistinctiveTitleToken = commonTitleTokens.some(isDistinctiveTitleToken);
  if (
    commonNodes.length >= 1 &&
    commonTitleTokens.length >= 6 &&
    titleOverlap >= 0.6 &&
    hasDistinctiveTitleToken
  ) {
    reasons.push("同一公开节点和高重合事件事实同时匹配");
    return {
      isDuplicate: true,
      score: 0.88,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  if (commonTitleTokens.length >= 8 && titleOverlap >= 0.72 && hasDistinctiveTitleToken) {
    reasons.push("事件标题中的具体事实高度重合");
    return {
      isDuplicate: true,
      score: 0.84,
      reasons,
      commonUrls,
      commonNodes,
      commonTitleTokens,
    };
  }

  const score = Math.max(
    commonUrls.length > 0 ? 0.35 : 0,
    commonNodes.length > 0 ? Math.min(0.55, 0.25 + nodeOverlap * 0.3) : 0,
    commonTitleTokens.length > 0 ? Math.min(0.7, titleOverlap * 0.7) : 0,
  );
  if (commonUrls.length > 0) reasons.push(`非锚点 URL 重合 ${commonUrls.length} 个`);
  if (commonNodes.length > 0) reasons.push(`公开节点部分重合 ${commonNodes.length} 个`);
  if (commonTitleTokens.length > 0) reasons.push(`事件事实词部分重合 ${commonTitleTokens.length} 个`);
  return {
    isDuplicate: false,
    score,
    reasons,
    commonUrls,
    commonNodes,
    commonTitleTokens,
  };
}

function collectAnchoredEvidence(
  value: unknown,
  urls: Set<string>,
  nodes: Set<string>,
  titles?: Set<string>,
  eventTitle?: string,
): void {
  const record = asRecord(value);
  if (!record) return;
  const items = Array.isArray(record.items) ? record.items : [];
  for (const itemValue of items) {
    const item = asRecord(itemValue);
    if (!item) continue;
    if (eventTitle && !anchoredItemMatchesEvent(item, eventTitle)) continue;
    const url = stringValue(item.url);
    if (url) collectUrls(url, urls);
    for (const key of ["channelName", "sourceName", "author"]) addNode(nodes, item[key]);
    if (titles) {
      const title = stringValue(item.title);
      if (title) titles.add(title);
    }
  }
}

function anchoredItemMatchesEvent(
  item: Record<string, unknown>,
  eventTitle: string,
): boolean {
  const itemText = normalizeForSearch([
    stringValue(item.title),
    stringValue(item.content),
  ].join(" "));
  if (!itemText.trim()) return false;

  const eventText = normalizeForSearch(eventTitle);
  const latinTerms = eventText.match(/[a-z0-9][a-z0-9_-]{4,}/g) ?? [];
  const hanSegments = eventText.match(/[\p{Script=Han}]{4,}/gu) ?? [];
  const concreteTerms = new Set<string>(latinTerms);
  for (const segment of hanSegments) {
    if (segment.length <= 8) concreteTerms.add(segment);
    for (const size of [6, 4]) {
      if (segment.length < size) continue;
      for (let index = 0; index <= segment.length - size; index += 1) {
        const term = segment.slice(index, index + size);
        if (!COMMON_TOKENS.has(term)) concreteTerms.add(term);
      }
    }
  }
  const hits = [...concreteTerms].filter((term) => itemText.includes(term));
  return hits.some((term) => term.length >= 6) || hits.length >= 2;
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
    const initialHost = url.hostname
      .replace(/^www\./, "")
      .replace(/^mobile\./, "")
      .replace(/^m\./, "")
      .replace(/^twitter\.com$/, "x.com")
      .toLowerCase();
    const nestedUrl = extractWrappedUrl(url, initialHost);
    if (nestedUrl) return canonicalUrl(nestedUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        ["fbclid", "gclid", "igshid", "spm", "ref", "feature", "s"].includes(key)
      ) {
        url.searchParams.delete(key);
      }
    }
    const host = initialHost;
    if (isStaticOrWrapperUrl(url, host)) return "";
    if (host === "youtu.be") {
      const videoId = url.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
      return videoId ? `https://youtube.com/watch?v=${videoId}` : "";
    }
    if (host === "youtube.com") {
      const videoId = youtubeVideoId(url);
      return videoId ? `https://youtube.com/watch?v=${videoId}` : "";
    }
    if (host === "lihkg.com") {
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "thread" && /^\d+$/.test(pathParts[1] ?? "")) {
        return `https://lihkg.com/thread/${pathParts[1]}`;
      }
    }
    url.hostname = host;
    const normalized = url.toString().replace(/\/$/, "");
    return normalized.toLowerCase();
  } catch {
    return "";
  }
}

function extractWrappedUrl(url: URL, host: string): string {
  if (
    (host === "r.lihkg.com" && url.pathname === "/link") ||
    (host === "embed.lih.kg" && url.pathname === "/frame")
  ) {
    return url.searchParams.get("u") ?? "";
  }
  return "";
}

function isStaticOrWrapperUrl(url: URL, host: string): boolean {
  const pathname = url.pathname.toLowerCase();
  if (host === "r.lihkg.com" || host === "embed.lih.kg") return true;
  if (host === "youtube.com" && (pathname === "/results" || pathname.startsWith("/@"))) {
    return true;
  }
  if (host === "lihkg.com" && pathname.startsWith("/assets/")) return true;
  if (pathname.includes("/thumbnail") || pathname.includes("/thumbnails/")) return true;
  if (/\.(?:gif|png|jpe?g|webp|svg|ico)(?:$|[?#])/i.test(pathname)) return true;
  return false;
}

function youtubeVideoId(url: URL): string {
  if (url.pathname === "/watch") return url.searchParams.get("v") ?? "";
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (["shorts", "embed", "live"].includes(pathParts[0] ?? "")) return pathParts[1] ?? "";
  return "";
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

function difference(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((item) => !rightSet.has(item));
}

function isDistinctiveTitleToken(token: string): boolean {
  return /^[\p{Script=Han}]{4,}$/u.test(token) || /^[a-z0-9_-]{6,}$/i.test(token);
}

function isReliableEventUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1] ?? "";
    if (host === "x.com") return pathParts.includes("status") && /^\d+$/.test(lastPart);
    if (host === "youtube.com") {
      return parsed.pathname === "/watch" && Boolean(parsed.searchParams.get("v"));
    }
    if (host === "t.me") return pathParts.length >= 2 && /^\d+$/.test(lastPart);
    if (host === "lihkg.com") {
      return pathParts[0] === "thread" && /^\d+$/.test(pathParts[1] ?? "");
    }
    if (host === "instagram.com") {
      return ["p", "reel", "reels", "tv"].includes(pathParts[0] ?? "") && pathParts.length >= 2;
    }
    if (host === "facebook.com") {
      return /\/(?:posts|videos|permalink\.php|story\.php)/i.test(parsed.pathname);
    }
    if (host === "github.com") {
      return pathParts.length >= 4 &&
        ["issues", "pull", "discussions", "commit"].includes(pathParts[2] ?? "");
    }
    if (host === "ptt.cc") return pathParts[0] === "bbs" && pathParts.length >= 3;
    return false;
  } catch {
    return false;
  }
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
