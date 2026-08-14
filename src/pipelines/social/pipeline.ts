import {
  CHINA_GATE_AGENT_ID,
  PLATFORM_AGENT_IDS,
  SOCIAL_FUSION_AGENT_ID,
  buildFusionTask,
  buildPlatformReportTask,
} from "./agents";
import {
  buildChinaRelevanceTask,
  parseAndNormalizeChinaGate,
  shouldAnalyzePlatform,
} from "./china-relevance";
import { deterministicFusion, sanitizeFusedSocialEvent } from "./fusion";
import { stableEventKey } from "./json";
import {
  parseFusedSocialEvent,
  parsePlatformReport,
  type FusedSocialEvent,
  type PlatformReport,
} from "./schemas";
import { renderFusedEvent, renderPlatformReport } from "./renderers";
import type {
  ChinaRelevanceResult,
  LightweightSocialSignal,
  SkippedSocialSignal,
  SocialAgentRunner,
} from "./types";

export interface SocialPipelineResult {
  readonly platformReports: readonly PlatformReport[];
  readonly renderedPlatformReports: readonly string[];
  readonly skipped: readonly SkippedSocialSignal[];
  readonly fusedEvent: FusedSocialEvent | null;
  readonly renderedFusedEvent: string | null;
}

function fallbackReport(
  signal: LightweightSocialSignal,
  gate: ChinaRelevanceResult,
): PlatformReport {
  const eventKey = stableEventKey(signal.title);
  const common = {
    event_key: eventKey,
    event_title: signal.title,
    observed_at: signal.observedAt,
    china_relevance: reportGate(gate),
    summary: signal.summary,
    evidence: [...signal.evidence],
    regions: [],
    core_nodes: [],
  };

  switch (signal.platform) {
    case "x":
      return {
        ...common,
        schema: "x_alert_v1",
        platform: "x",
        hashtag: "",
        discussion_growth_percent: Number(signal.metrics?.discussion_growth_percent ?? 0),
        participant_accounts: Number(signal.metrics?.participant_accounts ?? 0),
        main_source: String(signal.metrics?.main_source ?? "unknown"),
        status: "watching",
      };
    case "telegram":
      return {
        ...common,
        schema: "telegram_alert_v1",
        platform: "telegram",
        channel_path: [],
        shared_content_percent: Number(signal.metrics?.shared_content_percent ?? 0),
        bridge_channels: [],
      };
    case "lihkg":
      return {
        ...common,
        schema: "lihkg_alert_v1",
        platform: "lihkg",
        topic: signal.title,
        heat: String(signal.metrics?.heat ?? ""),
        participant_count: Number(signal.metrics?.participant_count ?? 0),
        stance: {
          support_percent: 0,
          oppose_percent: 0,
          neutral_percent: 0,
        },
        main_arguments: [],
      };
    case "facebook":
      return {
        ...common,
        schema: "facebook_alert_v1",
        platform: "facebook",
        pages: [],
        interaction_growth_percent: Number(signal.metrics?.interaction_growth_percent ?? 0),
        propagation_users: Number(signal.metrics?.propagation_users ?? 0),
        influence_regions: [],
      };
    case "github":
    case "instagram":
    case "lien":
    case "netlight":
    case "ptt":
    case "youtube":
      return {
        ...common,
        schema: `${signal.platform}_alert_v1`,
        platform: signal.platform,
        item_count: Number(signal.metrics?.item_count ?? 0),
        growth_percent: Number(signal.metrics?.growth_percent ?? 0),
        source_nodes: [],
        matched_terms: [],
        content_overlap_percent: Number(signal.metrics?.content_overlap_percent ?? 0),
        status: "watching",
      } as PlatformReport;
  }
}

function reportGate(gate: ChinaRelevanceResult) {
  return {
    ...gate,
    matched_dimensions: [...gate.matched_dimensions],
    evidence: [...gate.evidence],
    risk_categories: [...gate.risk_categories],
    risk_evidence: [...gate.risk_evidence],
  };
}

export async function runSocialPipeline(input: {
  readonly signals: readonly LightweightSocialSignal[];
  readonly runner: SocialAgentRunner;
}): Promise<SocialPipelineResult> {
  const platformReports: PlatformReport[] = [];
  const skipped: SkippedSocialSignal[] = [];

  for (const signal of input.signals) {
    const gateText = await input.runner.run({
      agentId: CHINA_GATE_AGENT_ID,
      routeKey: "social.gate",
      task: buildChinaRelevanceTask(signal),
    });
    const gate = parseAndNormalizeChinaGate(gateText);

    if (!shouldAnalyzePlatform(gate)) {
      skipped.push({ signal, gate });
      continue;
    }

    const platformText = await input.runner.run({
      agentId: PLATFORM_AGENT_IDS[signal.platform],
      routeKey: "social.platform",
      task: buildPlatformReportTask(signal, gate),
    });

    try {
      platformReports.push(parsePlatformReport(platformText, gate));
    } catch {
      platformReports.push(fallbackReport(signal, gate));
    }
  }

  const renderedPlatformReports = platformReports.map(renderPlatformReport);

  if (platformReports.length === 0) {
    return {
      platformReports,
      renderedPlatformReports,
      skipped,
      fusedEvent: null,
      renderedFusedEvent: null,
    };
  }

  let fusedEvent: FusedSocialEvent;
  const fusionText = await input.runner.run({
    agentId: SOCIAL_FUSION_AGENT_ID,
    routeKey: "social.fusion",
    task: buildFusionTask(platformReports),
  });

  try {
    fusedEvent = sanitizeFusedSocialEvent(parseFusedSocialEvent(fusionText), platformReports);
  } catch {
    fusedEvent = deterministicFusion(platformReports);
  }

  return {
    platformReports,
    renderedPlatformReports,
    skipped,
    fusedEvent,
    renderedFusedEvent: renderFusedEvent(fusedEvent),
  };
}
