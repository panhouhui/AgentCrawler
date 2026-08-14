export type KanPushRouteStatus =
  | "ready"
  | "missing-token"
  | "missing-channel";

export interface KanPushRoute {
  readonly id: string;
  readonly platform: string;
  readonly platformLabel: string;
  readonly baseUrl: string;
  readonly tokenConfigured: boolean;
  readonly channelIds: readonly string[];
  readonly channelNames: readonly string[];
  readonly sourceLabels: readonly string[];
  readonly channelMap: Readonly<Record<string, readonly string[]>>;
  readonly status: KanPushRouteStatus;
  readonly notes: string;
}

export interface ResolvedKanPushRoute extends KanPushRoute {
  readonly token: string | null;
}

export interface KanPushTeamChannel {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly teamDisplayName: string | null;
  readonly baseUrl: string;
}

export interface KanPushTeam {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly channels: readonly KanPushTeamChannel[];
}

export interface KanPushChannel {
  readonly id: string;
  readonly baseUrl: string;
  readonly displayName: string;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly teamDisplayName: string | null;
  readonly routeIds: readonly string[];
  readonly platformLabels: readonly string[];
  readonly tokenConfigured: boolean;
  readonly status: "已配置" | "缺少令牌" | "缺少频道";
}

export interface KanPushSummary {
  readonly routeCount: number;
  readonly readyRouteCount: number;
  readonly channelCount: number;
  readonly teamCount: number;
  readonly configuredTokenCount: number;
  readonly baseUrls: readonly string[];
}

export interface KanPushOverview {
  readonly serviceName: string;
  readonly generatedAt: string;
  readonly summary: KanPushSummary;
  readonly routes: readonly KanPushRoute[];
  readonly channels: readonly KanPushChannel[];
  readonly teams: readonly KanPushTeam[];
  readonly platforms: readonly {
    readonly id: string;
    readonly label: string;
  }[];
}

export interface KanPushDispatchRequest {
  readonly platform?: string;
  readonly routeId?: string;
  readonly source?: string;
  readonly message: string;
  readonly channelIds?: readonly string[];
  readonly dedupeKey?: string;
  readonly dryRun?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface KanPushDelivery {
  readonly channelId: string;
  readonly postId: string;
  readonly permalink: string;
  readonly skipped: boolean;
  readonly error: string | null;
}

export interface KanPushDispatchResult {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly routeId: string;
  readonly platform: string;
  readonly channelCount: number;
  readonly deliveries: readonly KanPushDelivery[];
  readonly generatedAt: string;
}

export interface KanPushRouteMutationInput {
  readonly platform?: string;
  readonly routeId?: string;
  readonly baseUrl?: string;
  readonly botToken?: string;
  readonly channelIds: readonly string[];
}
