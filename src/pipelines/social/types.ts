import type { ModelRoutingKey } from "../../store/model-routing";

export const SOCIAL_PLATFORMS = [
  "x",
  "telegram",
  "lihkg",
  "facebook",
  "github",
  "instagram",
  "lien",
  "netlight",
  "ptt",
  "youtube",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type ChinaRelevance = "direct" | "indirect" | "none" | "uncertain";
export type ChinaGateAction = "deep_crawl" | "shallow_watch" | "skip";
export type ChinaImpact =
  | "threatening"
  | "negative"
  | "neutral"
  | "beneficial"
  | "uncertain";
export type ChinaRiskCategory =
  | "national_security"
  | "public_security"
  | "social_stability"
  | "territorial_sovereignty"
  | "foreign_interference"
  | "economic_security"
  | "public_health"
  | "reputation_attack"
  | "disinformation"
  | "cyber_security"
  | "none";

export interface LightweightSocialSignal {
  readonly id: string;
  readonly platform: SocialPlatform;
  readonly title: string;
  readonly summary: string;
  readonly observedAt: number;
  readonly evidence: readonly string[];
  readonly metrics?: Record<string, unknown>;
  readonly raw?: unknown;
}

export interface ChinaRelevanceResult {
  readonly china_relevance: ChinaRelevance;
  readonly is_china_related: boolean;
  readonly score: number;
  readonly matched_dimensions: readonly string[];
  readonly evidence: readonly string[];
  readonly threat_to_china_security: boolean;
  readonly negative_to_china: boolean;
  readonly china_impact: ChinaImpact;
  readonly risk_score: number;
  readonly risk_categories: readonly ChinaRiskCategory[];
  readonly risk_evidence: readonly string[];
  readonly deep_crawl_allowed: boolean;
  readonly recommended_action: ChinaGateAction;
  readonly reason: string;
}

export interface SocialAgentRunner {
  run(input: {
    readonly agentId: string;
    readonly task: string;
    readonly routeKey: ModelRoutingKey;
  }): Promise<string>;
}

export interface SkippedSocialSignal {
  readonly signal: LightweightSocialSignal;
  readonly gate: ChinaRelevanceResult;
}
