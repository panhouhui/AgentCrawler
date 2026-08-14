import type {
  ChinaGateAction,
  ChinaImpact,
  ChinaRelevanceResult,
  ChinaRiskCategory,
  LightweightSocialSignal,
} from "./types";
import { parseChinaRelevance } from "./schemas";

const CHINA_RELEVANCE_DEEP_THRESHOLD = 0.6;
const CHINA_RISK_DEEP_THRESHOLD = 0.6;

const POLITICAL_SECURITY_CATEGORIES = new Set<ChinaRiskCategory>([
  "national_security",
  "public_security",
  "social_stability",
  "territorial_sovereignty",
  "foreign_interference",
  "disinformation",
  "cyber_security",
]);

const CHINA_TERMS: readonly string[] = [
  "中国",
  "中國",
  "大陆",
  "大陸",
  "香港",
  "澳门",
  "澳門",
  "台湾",
  "台灣",
  "北京",
  "上海",
  "深圳",
  "广州",
  "廣州",
  "华人",
  "華人",
  "中共",
  "中国政府",
  "中國政府",
  "中国企业",
  "中國企業",
  "中资",
  "中資",
  "解放军",
  "解放軍",
  "China",
  "Chinese",
  "Hong Kong",
  "Taiwan",
  "Macau",
  "Beijing",
  "Shanghai",
  "Xinjiang",
  "Tibet",
];

const RISK_TERMS: readonly {
  readonly term: string;
  readonly category: Exclude<ChinaRiskCategory, "none">;
  readonly impact: Exclude<ChinaImpact, "neutral" | "beneficial" | "uncertain">;
}[] = [
  { term: "国家安全", category: "national_security", impact: "threatening" },
  { term: "國家安全", category: "national_security", impact: "threatening" },
  { term: "国安", category: "national_security", impact: "threatening" },
  { term: "國安", category: "national_security", impact: "threatening" },
  { term: "间谍", category: "national_security", impact: "threatening" },
  { term: "間諜", category: "national_security", impact: "threatening" },
  { term: "窃密", category: "national_security", impact: "threatening" },
  { term: "竊密", category: "national_security", impact: "threatening" },
  { term: "情报泄露", category: "national_security", impact: "threatening" },
  { term: "情報外洩", category: "national_security", impact: "threatening" },
  { term: "渗透", category: "foreign_interference", impact: "threatening" },
  { term: "滲透", category: "foreign_interference", impact: "threatening" },
  { term: "外部干预", category: "foreign_interference", impact: "threatening" },
  { term: "外部干預", category: "foreign_interference", impact: "threatening" },
  { term: "制裁", category: "economic_security", impact: "negative" },
  { term: "出口管制", category: "economic_security", impact: "negative" },
  { term: "供应链", category: "economic_security", impact: "negative" },
  { term: "供應鏈", category: "economic_security", impact: "negative" },
  { term: "金融攻击", category: "economic_security", impact: "negative" },
  { term: "金融攻擊", category: "economic_security", impact: "negative" },
  { term: "网络攻击", category: "cyber_security", impact: "threatening" },
  { term: "網絡攻擊", category: "cyber_security", impact: "threatening" },
  { term: "网攻", category: "cyber_security", impact: "threatening" },
  { term: "網攻", category: "cyber_security", impact: "threatening" },
  { term: "数据泄露", category: "cyber_security", impact: "negative" },
  { term: "資料外洩", category: "cyber_security", impact: "negative" },
  { term: "黑客", category: "cyber_security", impact: "threatening" },
  { term: "勒索软件", category: "cyber_security", impact: "threatening" },
  { term: "勒索軟件", category: "cyber_security", impact: "threatening" },
  { term: "台独", category: "territorial_sovereignty", impact: "threatening" },
  { term: "台獨", category: "territorial_sovereignty", impact: "threatening" },
  { term: "港独", category: "territorial_sovereignty", impact: "threatening" },
  { term: "港獨", category: "territorial_sovereignty", impact: "threatening" },
  { term: "藏独", category: "territorial_sovereignty", impact: "threatening" },
  { term: "疆独", category: "territorial_sovereignty", impact: "threatening" },
  { term: "分裂", category: "territorial_sovereignty", impact: "threatening" },
  { term: "军演", category: "territorial_sovereignty", impact: "threatening" },
  { term: "軍演", category: "territorial_sovereignty", impact: "threatening" },
  { term: "恐袭", category: "public_security", impact: "threatening" },
  { term: "恐襲", category: "public_security", impact: "threatening" },
  { term: "袭击", category: "public_security", impact: "threatening" },
  { term: "襲擊", category: "public_security", impact: "threatening" },
  { term: "爆炸", category: "public_security", impact: "threatening" },
  { term: "暴乱", category: "social_stability", impact: "threatening" },
  { term: "暴亂", category: "social_stability", impact: "threatening" },
  { term: "骚乱", category: "social_stability", impact: "threatening" },
  { term: "騷亂", category: "social_stability", impact: "threatening" },
  { term: "冲突", category: "social_stability", impact: "negative" },
  { term: "衝突", category: "social_stability", impact: "negative" },
  { term: "疫情", category: "public_health", impact: "negative" },
  { term: "病毒", category: "public_health", impact: "negative" },
  { term: "造谣", category: "disinformation", impact: "negative" },
  { term: "造謠", category: "disinformation", impact: "negative" },
  { term: "谣言", category: "disinformation", impact: "negative" },
  { term: "謠言", category: "disinformation", impact: "negative" },
  { term: "虚假信息", category: "disinformation", impact: "negative" },
  { term: "假消息", category: "disinformation", impact: "negative" },
  { term: "抹黑", category: "reputation_attack", impact: "negative" },
  { term: "污名化", category: "reputation_attack", impact: "negative" },
  { term: "抵制", category: "reputation_attack", impact: "negative" },
  { term: "反华", category: "disinformation", impact: "negative" },
  { term: "反中", category: "disinformation", impact: "negative" },
  { term: "辱华", category: "reputation_attack", impact: "negative" },
  { term: "煽动", category: "social_stability", impact: "threatening" },
  { term: "顛覆", category: "national_security", impact: "threatening" },
  { term: "颠覆", category: "national_security", impact: "threatening" },
  { term: "颜色革命", category: "foreign_interference", impact: "threatening" },
  { term: "政权", category: "national_security", impact: "threatening" },
  { term: "政權", category: "national_security", impact: "threatening" },
  { term: "推翻", category: "national_security", impact: "threatening" },
  { term: "反政府", category: "social_stability", impact: "threatening" },
  { term: "反共", category: "disinformation", impact: "negative" },
  { term: "共产党", category: "disinformation", impact: "negative" },
  { term: "共產黨", category: "disinformation", impact: "negative" },
  { term: "政治谣言", category: "disinformation", impact: "negative" },
  { term: "政治謠言", category: "disinformation", impact: "negative" },
  { term: "boycott", category: "reputation_attack", impact: "negative" },
  { term: "sanction", category: "economic_security", impact: "negative" },
  { term: "espionage", category: "national_security", impact: "threatening" },
  { term: "cyberattack", category: "cyber_security", impact: "threatening" },
  { term: "data breach", category: "cyber_security", impact: "negative" },
  { term: "terror", category: "public_security", impact: "threatening" },
  { term: "riot", category: "social_stability", impact: "threatening" },
  { term: "separatism", category: "territorial_sovereignty", impact: "threatening" },
  { term: "disinformation", category: "disinformation", impact: "negative" },
  { term: "anti-china", category: "disinformation", impact: "negative" },
  { term: "anti ccp", category: "disinformation", impact: "negative" },
  { term: "regime change", category: "foreign_interference", impact: "threatening" },
  { term: "overthrow", category: "national_security", impact: "threatening" },
];

export function buildChinaRelevanceTask(signal: LightweightSocialSignal): string {
  return [
    "请对这个轻量级社交信号做两阶段判断：第一，是否属于中国/与中国相关；第二，是否威胁中国安全，或对中国、中国主体、港澳台治理、社会稳定、经济安全、公共安全、网络安全、国际形象造成负面风险。",
    "只返回 JSON，结构必须完全符合下面的形状：",
    JSON.stringify({
      china_relevance: "direct | indirect | none | uncertain",
      is_china_related: true,
      score: 0.0,
      matched_dimensions: [
        "mainland_china | hong_kong | macau | taiwan | chinese_policy | chinese_company | chinese_person | chinese_language_context | diaspora | cross_border_influence",
      ],
      evidence: ["来自输入的简短引用或概括证据"],
      threat_to_china_security: false,
      negative_to_china: false,
      china_impact: "threatening | negative | neutral | beneficial | uncertain",
      risk_score: 0.0,
      risk_categories: [
        "national_security | public_security | social_stability | territorial_sovereignty | foreign_interference | economic_security | public_health | reputation_attack | disinformation | cyber_security | none",
      ],
      risk_evidence: ["来自输入的风险/负面证据；没有就保持为空"],
      deep_crawl_allowed: false,
      recommended_action: "deep_crawl | shallow_watch | skip",
      reason: "一句简短解释",
    }),
    "",
    "硬性规则：",
    "- 中国大陆、香港、澳门、台湾、中国政策、中国公司、中国公众人物、中文公共议题、华人社群跨境影响，都属于相关范围。",
    "- 只根据输入里的证据判断，不要额外联网搜索，不要补充输入中没有出现的事实。",
    "- 不能因为只出现中国、香港、台湾等地名或中文语境，就进入 deep_crawl。",
    "- 只有同时满足以下条件，才能设置 deep_crawl_allowed=true 且 recommended_action=deep_crawl：china_relevance 是 direct/indirect，is_china_related=true，score >= 0.6，并且内容属于中国政治安全、国家安全、政权/制度攻击、港澳台/领土主权、外部干预、社会稳定、网络安全攻击、政治谣言/虚假攻击或明显不当政治言论，risk_score >= 0.6。",
    "- 经济、商业、科技、娱乐、公共卫生、普通民生、普通人物八卦、一般外交新闻，即使和中国相关，也不能 deep_crawl，除非输入中有明确政治安全威胁或不当政治言论证据。",
    "- 中国相关但中性、正面、证据不足、纯热点或风险不属于政治安全范围时，不允许 deep_crawl；可用 shallow_watch 或 skip。",
    "- 非中国相关必须 skip。",
    "",
    "信号：",
    JSON.stringify(signal, null, 2),
  ].join("\n");
}

export function normalizeChinaGateDecision(
  result: ChinaRelevanceResult,
): ChinaRelevanceResult {
  const score = clamp01(result.score);
  const riskScore = clamp01(result.risk_score ?? 0);
  const chinaRelevance = result.china_relevance;
  const relevancePass =
    (chinaRelevance === "direct" || chinaRelevance === "indirect") &&
    score >= CHINA_RELEVANCE_DEEP_THRESHOLD;
  const isChinaRelated =
    Boolean(result.is_china_related) ||
    relevancePass ||
    ((chinaRelevance === "direct" || chinaRelevance === "indirect") && score >= 0.4);
  const chinaImpact = result.china_impact ?? "uncertain";
  const threatToChinaSecurity =
    Boolean(result.threat_to_china_security) || chinaImpact === "threatening";
  const negativeToChina =
    Boolean(result.negative_to_china) || chinaImpact === "negative";
  const harmfulImpact = threatToChinaSecurity || negativeToChina;
  const riskCategories = normalizeRiskCategories(result.risk_categories ?? [], harmfulImpact);
  const politicalSecurityThreat = hasPoliticalSecurityThreat(result, riskCategories);
  const deepCrawlAllowed =
    isChinaRelated &&
    relevancePass &&
    harmfulImpact &&
    politicalSecurityThreat &&
    riskScore >= CHINA_RISK_DEEP_THRESHOLD;

  let recommended_action: ChinaGateAction;
  if (deepCrawlAllowed) {
    recommended_action = "deep_crawl";
  } else if (
    isChinaRelated &&
    (riskScore >= 0.35 ||
      chinaImpact === "uncertain" ||
      result.recommended_action === "shallow_watch")
  ) {
    recommended_action = "shallow_watch";
  } else {
    recommended_action = "skip";
  }

  return {
    ...result,
    is_china_related: isChinaRelated,
    score,
    threat_to_china_security: threatToChinaSecurity,
    negative_to_china: negativeToChina,
    china_impact: chinaImpact,
    risk_score: riskScore,
    risk_categories: riskCategories,
    risk_evidence: [...(result.risk_evidence ?? [])],
    deep_crawl_allowed: deepCrawlAllowed,
    recommended_action,
  };
}

export function shouldAnalyzePlatform(result: ChinaRelevanceResult): boolean {
  return (
    result.deep_crawl_allowed === true &&
    result.recommended_action === "deep_crawl" &&
    isPoliticalSecurityThreat(result)
  );
}

export function isPoliticalSecurityThreat(result: ChinaRelevanceResult): boolean {
  return hasPoliticalSecurityThreat(result, result.risk_categories);
}

export function parseAndNormalizeChinaGate(text: string): ChinaRelevanceResult {
  return normalizeChinaGateDecision(parseChinaRelevance(text));
}

export function buildKeywordChinaGate(input: {
  readonly title?: string;
  readonly summary?: string;
  readonly evidence?: readonly string[];
}): ChinaRelevanceResult {
  const text = [input.title ?? "", input.summary ?? "", ...(input.evidence ?? [])].join("\n");
  const matchedChinaTerms = matchingTerms(text, CHINA_TERMS);
  const matchedRiskTerms = RISK_TERMS.filter((item) => includesTerm(text, item.term));
  const riskCategories = unique(matchedRiskTerms.map((item) => item.category));
  const hasThreat = matchedRiskTerms.some((item) => item.impact === "threatening");
  const hasNegative = matchedRiskTerms.some((item) => item.impact === "negative");
  const isChinaRelated = matchedChinaTerms.length > 0;
  const riskScore =
    matchedRiskTerms.length === 0
      ? 0.1
      : Math.min(0.95, 0.66 + Math.min(matchedRiskTerms.length, 4) * 0.07);
  const chinaImpact: ChinaImpact = hasThreat ? "threatening" : hasNegative ? "negative" : "neutral";

  return normalizeChinaGateDecision({
    china_relevance: isChinaRelated ? "direct" : "none",
    is_china_related: isChinaRelated,
    score: isChinaRelated ? 0.85 : 0.2,
    matched_dimensions: matchedChinaTerms,
    evidence: isChinaRelated
      ? [`命中中国相关线索：${matchedChinaTerms.join(", ")}`]
      : [],
    threat_to_china_security: hasThreat,
    negative_to_china: hasNegative || hasThreat,
    china_impact: isChinaRelated ? chinaImpact : "uncertain",
    risk_score: isChinaRelated ? riskScore : 0,
    risk_categories: riskCategories.length > 0 ? riskCategories : ["none"],
    risk_evidence:
      matchedRiskTerms.length > 0
        ? [`命中风险/负面线索：${matchedRiskTerms.map((item) => item.term).join(", ")}`]
        : [],
    deep_crawl_allowed: false,
    recommended_action: isChinaRelated && matchedRiskTerms.length > 0 ? "deep_crawl" : "skip",
    reason:
      isChinaRelated && matchedRiskTerms.length > 0
        ? "输入证据同时包含中国相关线索和风险/负面线索。"
        : isChinaRelated
          ? "输入证据包含中国相关线索，但没有明确威胁中国安全或对中国不利的风险证据。"
          : "输入证据没有命中中国相关线索。",
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeRiskCategories(
  categories: readonly ChinaRiskCategory[],
  harmfulImpact: boolean,
): readonly ChinaRiskCategory[] {
  const filtered = unique(categories.filter((category) => category !== "none"));
  if (filtered.length > 0) return filtered;
  return harmfulImpact ? [] : ["none"];
}

function hasPoliticalSecurityThreat(
  result: ChinaRelevanceResult,
  categories: readonly ChinaRiskCategory[],
): boolean {
  if (categories.some((category) => POLITICAL_SECURITY_CATEGORIES.has(category))) {
    return true;
  }
  const text = [
    result.reason,
    result.china_impact,
    ...result.evidence,
    ...result.risk_evidence,
    ...result.matched_dimensions,
  ].join("\n");
  return RISK_TERMS.some(
    (item) =>
      POLITICAL_SECURITY_CATEGORIES.has(item.category) &&
      includesTerm(text, item.term),
  );
}

function matchingTerms(text: string, terms: readonly string[]): string[] {
  return terms.filter((term) => includesTerm(text, term));
}

function includesTerm(text: string, term: string): boolean {
  return text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}
