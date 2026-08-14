import type { ChannelPlugin, ChannelAccountSnapshot } from './plugin-types'
import type { OpenCrowConfig } from '../config/schema'
import type { Channel } from './types'

export interface ChannelRegistry {
  register(plugin: ChannelPlugin): void
  get(id: string): ChannelPlugin | undefined
  list(): readonly ChannelPlugin[]
  getEnabled(config: OpenCrowConfig): readonly ChannelPlugin[]
  getSnapshots(
    config: OpenCrowConfig,
    channels: ReadonlyMap<string, Channel>
  ): Record<string, ChannelAccountSnapshot>
}

export function createChannelRegistry(): ChannelRegistry {
  const plugins = new Map<string, ChannelPlugin>()

  return {
    register(plugin: ChannelPlugin): void {
      plugins.set(plugin.id, plugin)
    },

    get(id: string): ChannelPlugin | undefined {
      return plugins.get(id)
    },

    list(): readonly ChannelPlugin[] {
      return [...plugins.values()].sort((a, b) => a.meta.order - b.meta.order)
    },

    getEnabled(config: OpenCrowConfig): readonly ChannelPlugin[] {
      return [...plugins.values()]
        .filter((p) => p.config.isEnabled(config))
        .sort((a, b) => a.meta.order - b.meta.order)
    },

    getSnapshots(
      config: OpenCrowConfig,
      channels: ReadonlyMap<string, Channel>
    ): Record<string, ChannelAccountSnapshot> {
      const result: Record<string, ChannelAccountSnapshot> = {}
      for (const plugin of plugins.values()) {
        const channel = channels.get(plugin.id)
        result[plugin.id] = plugin.config.getSnapshot(config, channel)
      }
      return result
    },
  }
}
