import { z } from "zod";
import { parseJsonFromText, stableEventKey } from "./json";
import { SOCIAL_PLATFORMS } from "./types";
import type { ChinaRelevanceResult } from "./types";

export const chinaRelevanceSchema = z.object({
  china_relevance: z.enum(["direct", "indirect", "none", "uncertain"]),
  is_china_related: z.boolean().default(false),
  score: z.number().min(0).max(1),
  matched_dimensions: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  threat_to_china_security: z.boolean().default(false),
  negative_to_china: z.boolean().default(false),
  china_impact: z
    .enum(["threatening", "negative", "neutral", "beneficial", "uncertain"])
    .default("uncertain"),
  risk_score: z.number().min(0).max(1).default(0),
  risk_categories: z
    .array(
      z.enum([
        "national_security",
        "public_security",
        "social_stability",
        "territorial_sovereignty",
        "foreign_interference",
        "economic_security",
        "public_health",
        "reputation_attack",
        "disinformation",
        "cyber_security",
        "none",
      ]),
    )
    .default([]),
  risk_evidence: z.array(z.string()).default([]),
  deep_crawl_allowed: z.boolean().default(false),
  recommended_action: z.enum(["deep_crawl", "shallow_watch", "skip"]),
  reason: z.string().default(""),
});

const baseReportSchema = z.object({
  schema: z.string().min(1),
  event_key: z.string().min(1),
  event_title: z.string().min(1),
  detection_status: z.enum(["found", "not_found"]).optional(),
  observed_at: z.number().int().nonnegative(),
  china_relevance: chinaRelevanceSchema,
  summary: z.string().default(""),
  evidence: z.array(z.string()).default([]),
  regions: z.array(z.string()).default([]),
  core_nodes: z.array(z.string()).default([]),
});

export const xReportSchema = baseReportSchema.extend({
  schema: z.literal("x_alert_v1"),
  platform: z.literal("x"),
  hashtag: z.string().default(""),
  discussion_growth_percent: z.number().default(0),
  participant_accounts: z.number().int().nonnegative().default(0),
  main_source: z.string().default("unknown"),
  status: z.enum(["rapid_spread", "watching", "stable", "declining"]).default("watching"),
});

export const telegramReportSchema = baseReportSchema.extend({
  schema: z.literal("telegram_alert_v1"),
  platform: z.literal("telegram"),
  channel_path: z.array(z.string()).default([]),
  shared_content_percent: z.number().min(0).max(100).default(0),
  bridge_channels: z.array(z.string()).default([]),
});

export const lihkgReportSchema = baseReportSchema.extend({
  schema: z.literal("lihkg_alert_v1"),
  platform: z.literal("lihkg"),
  topic: z.string().default(""),
  heat: z.string().default(""),
  participant_count: z.number().int().nonnegative().default(0),
  stance: z.object({
    support_percent: z.number().min(0).max(100).default(0),
    oppose_percent: z.number().min(0).max(100).default(0),
    neutral_percent: z.number().min(0).max(100).default(0),
  }),
  main_arguments: z.array(z.string()).default([]),
});

export const facebookReportSchema = baseReportSchema.extend({
  schema: z.literal("facebook_alert_v1"),
  platform: z.literal("facebook"),
  pages: z.array(z.string()).default([]),
  interaction_growth_percent: z.number().default(0),
  propagation_users: z.number().int().nonnegative().default(0),
  influence_regions: z.array(z.string()).default([]),
});

const genericStatusSchema = z
  .enum(["found", "watching", "stable", "declining"])
  .default("watching");

function genericPlatformReportSchema<P extends Exclude<(typeof SOCIAL_PLATFORMS)[number], "x" | "telegram" | "lihkg" | "facebook">>(
  platform: P,
) {
  return baseReportSchema.extend({
    schema: z.literal(`${platform}_alert_v1`),
    platform: z.literal(platform),
    item_count: z.number().int().nonnegative().default(0),
    growth_percent: z.number().default(0),
    source_nodes: z.array(z.string()).default([]),
    matched_terms: z.array(z.string()).default([]),
    content_overlap_percent: z.number().min(0).max(100).default(0),
    status: genericStatusSchema,
  });
}

export const githubReportSchema = genericPlatformReportSchema("github");
export const instagramReportSchema = genericPlatformReportSchema("instagram");
export const lienReportSchema = genericPlatformReportSchema("lien");
export const netlightReportSchema = genericPlatformReportSchema("netlight");
export const pttReportSchema = genericPlatformReportSchema("ptt");
export const youtubeReportSchema = genericPlatformReportSchema("youtube");

export const platformReportSchema = z.discriminatedUnion("platform", [
  xReportSchema,
  telegramReportSchema,
  lihkgReportSchema,
  facebookReportSchema,
  githubReportSchema,
  instagramReportSchema,
  lienReportSchema,
  netlightReportSchema,
  pttReportSchema,
  youtubeReportSchema,
]);

export type ChinaRelevanceReport = z.infer<typeof chinaRelevanceSchema>;
export type PlatformReport = z.infer<typeof platformReportSchema>;

export const platformReflectionSchema = z.object({
  schema: z.literal("platform_agent_reflection_v1").default("platform_agent_reflection_v1"),
  platform: z.enum(SOCIAL_PLATFORMS),
  phase: z.enum(["discover", "search", "china_gate"]),
  status: z.string().default("unknown"),
  reflection_summary: z.string().default(""),
  observed_patterns: z.array(z.string()).default([]),
  failure_causes: z.array(z.string()).default([]),
  improvement_plan: z.string().default(""),
  next_action: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type PlatformReflection = z.infer<typeof platformReflectionSchema>;

export const fusedSocialEventSchema = z.object({
  schema: z.literal("social_fusion_v1").default("social_fusion_v1"),
  event_key: z.string().min(1),
  event_title: z.string().min(1),
  same_event_confidence: z.number().min(0).max(1).default(0),
  impact_level: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
  trend: z.enum(["rising", "stable", "declining", "uncertain"]).default("uncertain"),
  platform_sequence: z.array(z.enum(SOCIAL_PLATFORMS)).default([]),
  platform_counts: z.record(z.string(), z.number()).default({}),
  core_propagation_nodes: z.array(z.string()).default([]),
  relationship_summary: z.string().default(""),
  recommended_actions: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});

export type FusedSocialEvent = z.infer<typeof fusedSocialEventSchema>;

export function parseChinaRelevance(text: string): ChinaRelevanceReport {
  return chinaRelevanceSchema.parse(parseJsonFromText(text));
}

function normalizePlatformReportInput(
  value: unknown,
  gate?: ChinaRelevanceReport | ChinaRelevanceResult,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
  };

  if (gate && !chinaRelevanceSchema.safeParse(normalized.china_relevance).success) {
    normalized.china_relevance = gate;
  }

  if (
    (normalized.event_key === undefined || normalized.event_key === "") &&
    typeof normalized.event_title === "string"
  ) {
    normalized.event_key = stableEventKey(normalized.event_title);
  }

  return normalized;
}

export function parsePlatformReport(
  text: string,
  gate?: ChinaRelevanceReport | ChinaRelevanceResult,
): PlatformReport {
  return platformReportSchema.parse(
    normalizePlatformReportInput(parseJsonFromText(text), gate),
  );
}

export function parsePlatformReflection(text: string): PlatformReflection {
  return platformReflectionSchema.parse(parseJsonFromText(text));
}

export function parseFusedSocialEvent(text: string): FusedSocialEvent {
  return fusedSocialEventSchema.parse(parseJsonFromText(text));
}
