import type { ChannelRegistry } from './registry'
import type { Channel, MessageHandler } from './types'
import type { ChannelAccountSnapshot } from './plugin-types'
import type { OpenCrowConfig } from '../config/schema'
import { createLogger } from '../logger'

const log = createLogger('channel-manager')

export interface ChannelManager {
  startAll(config: OpenCrowConfig, onMessage: MessageHandler): Promise<void>
  startChannel(
    id: string,
    config: OpenCrowConfig,
    onMessage: MessageHandler
  ): Promise<void>
  stopChannel(id: string): Promise<void>
  stopAll(): Promise<void>
  getChannel(id: string): Channel | undefined
  getChannels(): ReadonlyMap<string, Channel>
  getSnapshots(config: OpenCrowConfig): Record<string, ChannelAccountSnapshot>
}

export function createChannelManager(registry: ChannelRegistry): ChannelManager {
  const channels = new Map<string, Channel>()

  return {
    async startAll(config: OpenCrowConfig, onMessage: MessageHandler): Promise<void> {
      const enabled = registry.getEnabled(config)
      for (const plugin of enabled) {
        try {
          await this.startChannel(plugin.id, config, onMessage)
        } catch (error) {
          log.error(`Failed to start channel: ${plugin.id}`, error)
        }
      }
    },

    async startChannel(
      id: string,
      config: OpenCrowConfig,
      onMessage: MessageHandler
    ): Promise<void> {
      const plugin = registry.get(id)
      if (!plugin) {
        throw new Error(`Unknown channel: ${id}`)
      }

      if (!plugin.config.isConfigured(config)) {
        log.warn(`Channel ${id} is not configured, skipping`)
        return
      }

      const existing = channels.get(id)
      if (existing) {
        await existing.disconnect()
        channels.delete(id)
      }

      const channel = plugin.gateway.createChannel(config)
      channel.onMessage(onMessage)
      await channel.connect()
      channels.set(id, channel)
      log.info(`Channel connected: ${id}`)
    },

    async stopChannel(id: string): Promise<void> {
      const channel = channels.get(id)
      if (!channel) return

      try {
        await channel.disconnect()
      } catch (error) {
        log.error(`Error disconnecting channel: ${id}`, error)
      }
      channels.delete(id)
      log.info(`Channel stopped: ${id}`)
    },

    async stopAll(): Promise<void> {
      for (const [id] of channels) {
        await this.stopChannel(id)
      }
    },

    getChannel(id: string): Channel | undefined {
      return channels.get(id)
    },

    getChannels(): ReadonlyMap<string, Channel> {
      return channels
    },

    getSnapshots(config: OpenCrowConfig): Record<string, ChannelAccountSnapshot> {
      return registry.getSnapshots(config, channels)
    },
  }
}
