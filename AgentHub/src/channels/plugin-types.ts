import type { OpenCrowConfig } from "../config/schema";
import type { Channel } from "./types";

export type ChannelId = string;

export interface ChannelMeta {
  readonly id: ChannelId;
  readonly label: string;
  readonly icon: string;
  readonly order: number;
}

export interface ChannelCapabilities {
  readonly media: boolean;
  readonly groups: boolean;
}

export interface ChannelSetupInput {
  readonly enabled?: boolean;
  readonly botToken?: string;
  readonly allowedUserIds?: readonly number[];
  readonly allowedNumbers?: readonly string[];
  readonly allowedGroups?: readonly string[];
}

export interface ChannelAccountSnapshot {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly connected: boolean;
  readonly lastError?: string | null;
  readonly [key: string]: unknown;
}

export interface ChannelSetupAdapter {
  validateInput(input: ChannelSetupInput): string | null;
  applyConfig(config: OpenCrowConfig, input: ChannelSetupInput): OpenCrowConfig;
}

export interface ChannelConfigAdapter {
  isEnabled(config: OpenCrowConfig): boolean;
  isConfigured(config: OpenCrowConfig): boolean;
  getSnapshot(config: OpenCrowConfig, channel?: Channel): ChannelAccountSnapshot;
  getAllowedSenders(
    config: OpenCrowConfig,
  ): readonly string[] | readonly number[];
}

export interface ChannelGatewayAdapter {
  createChannel(config: OpenCrowConfig): Channel;
}

export interface ChannelPlugin {
  readonly id: ChannelId;
  readonly meta: ChannelMeta;
  readonly capabilities: ChannelCapabilities;
  readonly setup: ChannelSetupAdapter;
  readonly config: ChannelConfigAdapter;
  readonly gateway: ChannelGatewayAdapter;
}
