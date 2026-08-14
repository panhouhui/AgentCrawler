import type { ChannelRegistry } from "./registry";
import { telegramPlugin } from "./telegram/plugin";
import { whatsappPlugin } from "./whatsapp/plugin";

export function registerDefaultPlugins(registry: ChannelRegistry): void {
  registry.register(telegramPlugin);
  registry.register(whatsappPlugin);
}
