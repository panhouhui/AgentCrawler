import type { Channel, ChannelName, MessageContent, MessageHandler } from "../types";
import { findKanPushRoute } from "../../integrations/kan/config";
import { claimKanInbound } from "../../store/kan-messages";
import { createLogger } from "../../logger";

interface KanPost { id?: string; channel_id?: string; user_id?: string; message?: string; create_at?: number; }
interface KanUser { id?: string; username?: string; first_name?: string; last_name?: string; }

export interface KanChannelOptions {
  readonly allowedUserIds?: readonly string[];
  readonly allowAllUsers?: boolean;
  readonly botUserId?: string;
}

export function createKanChannel(options: KanChannelOptions = {}): Channel {
  const log = createLogger("kan:channel");
  const route = findKanPushRoute(undefined, "social-fusion") ?? findKanPushRoute();
  const baseUrl = (process.env.KAN_DM_BASE_URL || route?.baseUrl || "https://kan.cool").replace(/\/+$/, "");
  const token = process.env.KAN_DM_BOT_TOKEN || route?.token || "";
  const allowed = new Set((options.allowedUserIds ?? (process.env.KAN_DM_ALLOWED_USER_IDS ?? "").split(",")).map((x) => x.trim()).filter(Boolean));
  const allowAllUsers = options.allowAllUsers ?? process.env.KAN_DM_ALLOW_ALL !== "0";
  let botUserId = options.botUserId || process.env.KAN_DM_BOT_USER_ID || "";
  let ws: WebSocket | null = null;
  let connected = false;
  let handler: MessageHandler | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopping = false;

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`KAN API ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return (await response.json()) as T;
  }

  async function ensureBotId(): Promise<void> {
    if (botUserId) return;
    const me = await api<KanUser>("/api/v4/users/me");
    botUserId = me.id ?? "";
    if (!botUserId) throw new Error("KAN bot user id is unavailable");
  }

  async function addReaction(postId: string, emojiName: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await api("/api/v4/reactions", {
          method: "POST",
          body: JSON.stringify({ user_id: botUserId, post_id: postId, emoji_name: emojiName.replace(/^:/, "").replace(/:$/, "") }),
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
      }
    }
    throw lastError;
  }

  async function directChannel(userId: string): Promise<string> {
    const ids = [botUserId, userId].filter(Boolean);
    const result = await api<{ id?: string }>("/api/v4/channels/direct", { method: "POST", body: JSON.stringify(ids) });
    if (!result.id) throw new Error("KAN direct channel id is unavailable");
    return result.id;
  }

  async function handleEvent(event: MessageEvent): Promise<void> {
    let data: Record<string, unknown>;
    try { data = JSON.parse(String(event.data)) as Record<string, unknown>; } catch { return; }
    if (data.event !== "posted") return;
    let post: KanPost;
    try { post = JSON.parse(String((data.data as Record<string, unknown>)?.post ?? "{}")) as KanPost; } catch { return; }
    if (!post.id || !post.message || !post.user_id || post.user_id === botUserId) return;
    if (!allowAllUsers && (allowed.size === 0 || !allowed.has(post.user_id))) return;
    if (!(await claimKanInbound(post.id))) return;
    if (process.env.KAN_DM_RECEIVED_EMOJI !== "") {
      await addReaction(post.id, process.env.KAN_DM_RECEIVED_EMOJI || "eyes").catch((error) =>
        log.warn("KAN received-message reaction failed", { error }),
      );
    }
    const chatId = post.channel_id || await directChannel(post.user_id);
    const channelInfo = await api<{ type?: string }>(`/api/v4/channels/${chatId}`).catch(() => null);
    if (channelInfo?.type && channelInfo.type !== "D") return;
    const user: KanUser = await api<KanUser>(`/api/v4/users/${post.user_id}`).catch(() => ({} as KanUser));
    await handler?.({ id: post.id, channel: "kan" as ChannelName, chatId, senderId: post.user_id, senderName: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username, content: { text: post.message }, timestamp: Math.floor((post.create_at ?? Date.now()) / 1000), raw: post });
  }

  function connectSocket(): void {
    if (stopping || !token) return;
    const url = baseUrl.replace(/^http/, "ws") + "/api/v4/websocket";
    ws = new WebSocket(url);
    ws.onopen = () => {
      connected = true;
      ws?.send(JSON.stringify({ seq: 1, action: "authentication_challenge", data: { token } }));
      log.info("KAN WebSocket connected");
    };
    ws.onmessage = (event) => { void handleEvent(event).catch((error) => log.error("KAN event handling failed", { error })); };
    ws.onerror = () => { connected = false; };
    ws.onclose = () => {
      connected = false;
      ws = null;
      if (!stopping) reconnectTimer = setTimeout(connectSocket, 5000);
    };
  }

  return {
    name: "kan" as ChannelName,
    async connect() {
      if (!token) throw new Error("KAN bot token is not configured");
      let lastError: unknown;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          await ensureBotId();
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          log.warn("KAN API startup probe failed; retrying", { attempt });
          if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
        }
      }
      if (lastError) throw lastError;
      stopping = false;
      connectSocket();
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
    async disconnect() {
      stopping = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close(); ws = null; connected = false;
    },
    async sendMessage(chatId: string, content: MessageContent): Promise<string | void> {
      if (!content.text?.trim()) return;
      const post = await api<{ id?: string }>("/api/v4/posts", { method: "POST", body: JSON.stringify({ channel_id: chatId, message: content.text }) });
      return post.id;
    },
    onMessage(next: MessageHandler) { handler = next; },
    isConnected() { return connected; },
  };
}
