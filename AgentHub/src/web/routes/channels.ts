import { Hono } from "hono";
import type { WebAppDeps } from "../app";
import { setOverride } from "../../store/config-overrides";
import { loadConfigWithOverrides } from "../../config/loader";
import type { WhatsAppChannel } from "../../channels/whatsapp/client";
import { createLogger } from "../../logger";

const log = createLogger("web-channels");

export function createChannelRoutes(deps: WebAppDeps): Hono {
  const app = new Hono();

  app.get("/channels", async (c) => {
    // Proxy to core when running as standalone web
    if (deps.coreClient && !deps.channelRegistry) {
      try {
        const result = await deps.coreClient.listChannels();
        return c.json({ success: true, data: result.data });
      } catch (err) {
        log.error("Core proxy list channels error", err);
        return c.json(
          { success: false, error: "Failed to list channels" },
          502,
        );
      }
    }

    if (!deps.channelRegistry || !deps.channelManager) {
      return c.json(
        { success: false, error: "Channel system not initialized" },
        500,
      );
    }

    const plugins = deps.channelRegistry.list();
    const currentConfig = await loadConfigWithOverrides();
    const snapshots = deps.channelManager.getSnapshots(currentConfig);

    const channels = plugins.map((plugin) => ({
      id: plugin.id,
      meta: plugin.meta,
      capabilities: plugin.capabilities,
      snapshot: snapshots[plugin.id] ?? {
        enabled: false,
        configured: false,
        connected: false,
      },
    }));

    return c.json({ success: true, data: channels });
  });

  app.get("/channels/:id", async (c) => {
    const id = c.req.param("id");
    if (!deps.channelRegistry || !deps.channelManager) {
      return c.json(
        { success: false, error: "Channel system not initialized" },
        500,
      );
    }

    const plugin = deps.channelRegistry.get(id);
    if (!plugin) {
      return c.json({ success: false, error: `Unknown channel: ${id}` }, 404);
    }

    const currentConfig = await loadConfigWithOverrides();
    const channel = deps.channelManager.getChannel(id);
    const snapshot = plugin.config.getSnapshot(currentConfig, channel);

    return c.json({
      success: true,
      data: {
        id: plugin.id,
        meta: plugin.meta,
        capabilities: plugin.capabilities,
        snapshot,
      },
    });
  });

  app.post("/channels/:id/setup", async (c) => {
    const id = c.req.param("id");
    if (deps.coreClient && !deps.channelManager) {
      try {
        const body = await c.req.json();
        const result = await deps.coreClient.channelAction(id, "setup", body);
        return c.json({ success: true, ...result });
      } catch (err) {
        log.error("Core proxy channel setup error", err);
        return c.json(
          { success: false, error: "Failed to setup channel" },
          502,
        );
      }
    }
    if (!deps.channelRegistry || !deps.channelManager) {
      return c.json(
        { success: false, error: "Channel system not initialized" },
        500,
      );
    }

    const plugin = deps.channelRegistry.get(id);
    if (!plugin) {
      return c.json({ success: false, error: `Unknown channel: ${id}` }, 404);
    }

    const input = await c.req.json();
    const validationError = plugin.setup.validateInput(input);
    if (validationError) {
      return c.json({ success: false, error: validationError }, 400);
    }

    try {
      const current = await loadConfigWithOverrides();
      const applied = plugin.setup.applyConfig(current, input);
      const channelDiff = extractChannelDiff(current, applied, id);
      await setOverride("channels", id, channelDiff);

      const updated = await loadConfigWithOverrides();

      const shouldRestart =
        input.enabled !== undefined || input.botToken !== undefined;
      if (shouldRestart && plugin.config.isEnabled(updated)) {
        await deps.channelManager.stopChannel(id);
        await deps.channelManager.startChannel(
          id,
          updated,
          deps.messageHandler!,
        );
      }

      const channel = deps.channelManager.getChannel(id);
      const snapshot = plugin.config.getSnapshot(updated, channel);

      return c.json({ success: true, data: { snapshot } });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to apply config";
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.post("/channels/:id/enable", async (c) => {
    const id = c.req.param("id");
    if (deps.coreClient && !deps.channelManager) {
      try {
        const result = await deps.coreClient.channelAction(id, "enable");
        return c.json({ success: true, ...result });
      } catch (err) {
        log.error("Core proxy channel enable error", err);
        return c.json(
          { success: false, error: "Failed to enable channel" },
          502,
        );
      }
    }
    if (!deps.channelRegistry || !deps.channelManager) {
      return c.json(
        { success: false, error: "Channel system not initialized" },
        500,
      );
    }

    const plugin = deps.channelRegistry.get(id);
    if (!plugin) {
      return c.json({ success: false, error: `Unknown channel: ${id}` }, 404);
    }

    try {
      const current = await loadConfigWithOverrides();
      const applied = plugin.setup.applyConfig(current, { enabled: true });
      const channelDiff = extractChannelDiff(current, applied, id);
      await setOverride("channels", id, channelDiff);

      const updated = await loadConfigWithOverrides();

      if (plugin.config.isConfigured(updated)) {
        await deps.channelManager.startChannel(
          id,
          updated,
          deps.messageHandler!,
        );
      }

      const channel = deps.channelManager.getChannel(id);
      const snapshot = plugin.config.getSnapshot(updated, channel);

      return c.json({ success: true, data: { snapshot } });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to enable channel";
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.post("/channels/:id/disable", async (c) => {
    const id = c.req.param("id");
    if (deps.coreClient && !deps.channelManager) {
      try {
        const result = await deps.coreClient.channelAction(id, "disable");
        return c.json({ success: true, ...result });
      } catch (err) {
        log.error("Core proxy channel disable error", err);
        return c.json(
          { success: false, error: "Failed to disable channel" },
          502,
        );
      }
    }
    if (!deps.channelRegistry || !deps.channelManager) {
      return c.json(
        { success: false, error: "Channel system not initialized" },
        500,
      );
    }

    const plugin = deps.channelRegistry.get(id);
    if (!plugin) {
      return c.json({ success: false, error: `Unknown channel: ${id}` }, 404);
    }

    try {
      const current = await loadConfigWithOverrides();
      const applied = plugin.setup.applyConfig(current, { enabled: false });
      const channelDiff = extractChannelDiff(current, applied, id);
      await setOverride("channels", id, channelDiff);

      await deps.channelManager.stopChannel(id);

      const updated = await loadConfigWithOverrides();
      const snapshot = plugin.config.getSnapshot(updated, undefined);

      return c.json({ success: true, data: { snapshot } });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to disable channel";
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.post("/channels/:id/restart", async (c) => {
    const id = c.req.param("id");
    if (deps.coreClient && !deps.channelManager) {
      try {
        const result = await deps.coreClient.channelAction(id, "restart");
        return c.json({ success: true, ...result });
      } catch (err) {
        log.error("Core proxy channel restart error", err);
        return c.json(
          { success: false, error: "Failed to restart channel" },
          502,
        );
      }
    }
    if (!deps.channelRegistry || !deps.channelManager) {
      return c.json(
        { success: false, error: "Channel system not initialized" },
        500,
      );
    }

    const plugin = deps.channelRegistry.get(id);
    if (!plugin) {
      return c.json({ success: false, error: `Unknown channel: ${id}` }, 404);
    }

    try {
      const currentConfig = await loadConfigWithOverrides();
      await deps.channelManager.stopChannel(id);
      await deps.channelManager.startChannel(
        id,
        currentConfig,
        deps.messageHandler!,
      );

      const channel = deps.channelManager.getChannel(id);
      const snapshot = plugin.config.getSnapshot(currentConfig, channel);

      return c.json({ success: true, data: { snapshot } });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to restart channel";
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.post("/channels/whatsapp/pair", async (c) => {
    if (deps.coreClient && !deps.channelManager) {
      try {
        const body = await c.req.json();
        const result = await deps.coreClient.channelAction(
          "whatsapp",
          "pair",
          body,
        );
        if (result.error) {
          return c.json({ success: false, error: result.error }, 400);
        }
        return c.json({ success: true, ...result });
      } catch (err) {
        log.error("Core proxy WhatsApp pair error", err);
        return c.json(
          { success: false, error: "Failed to request pairing code" },
          502,
        );
      }
    }
    if (!deps.channelManager) {
      return c.json(
        { success: false, error: "Channel system not initialized" },
        500,
      );
    }

    const body = await c.req.json();
    const phoneNumber = body.phoneNumber as string | undefined;
    if (!phoneNumber || !/^\d{7,15}$/.test(phoneNumber)) {
      return c.json(
        {
          success: false,
          error:
            "Invalid phone number. Use country code + number, no +. Example: 491234567890",
        },
        400,
      );
    }

    const channel = deps.channelManager.getChannel("whatsapp") as
      | WhatsAppChannel
      | undefined;
    if (!channel) {
      return c.json(
        {
          success: false,
          error: "WhatsApp channel is not running. Enable it first.",
        },
        400,
      );
    }

    try {
      const code = await channel.requestPairingCode(phoneNumber);
      return c.json({ success: true, data: { code } });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to request pairing code";
      return c.json({ success: false, error: message }, 500);
    }
  });

  return app;
}

function extractChannelDiff(
  before: { channels: Record<string, unknown> },
  after: { channels: Record<string, unknown> },
  channelId: string,
): Record<string, unknown> {
  const afterChannel = (after.channels[channelId] ?? {}) as Record<
    string,
    unknown
  >;
  const beforeChannel = (before.channels[channelId] ?? {}) as Record<
    string,
    unknown
  >;

  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(afterChannel)) {
    if (JSON.stringify(value) !== JSON.stringify(beforeChannel[key])) {
      diff[key] = value;
    }
  }

  return diff;
}
