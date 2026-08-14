import { findKanPushRoute } from "./config";
import type {
  KanPushDelivery,
  KanPushDispatchRequest,
  KanPushDispatchResult,
  ResolvedKanPushRoute,
} from "./types";

interface MattermostPostResponse {
  readonly id?: string;
  readonly create_at?: number;
}

function normalizeChannelIds(
  route: ResolvedKanPushRoute,
  channelIds?: readonly string[],
): readonly string[] {
  const selected =
    channelIds && channelIds.length > 0 ? channelIds : route.channelIds;
  return [...new Set(selected.map((item) => item.trim()).filter(Boolean))];
}

async function postKanMessage(
  route: ResolvedKanPushRoute,
  channelId: string,
  message: string,
): Promise<KanPushDelivery> {
  if (!route.token) {
    return {
      channelId,
      postId: "",
      permalink: "",
      skipped: false,
      error: "Kan 机器人令牌未配置",
    };
  }

  try {
    const response = await fetch(`${route.baseUrl}/api/v4/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${route.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel_id: channelId,
        message,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      return {
        channelId,
        postId: "",
        permalink: "",
        skipped: false,
        error: `Kan API ${response.status}: ${details.slice(0, 300)}`,
      };
    }
    const post = (await response.json()) as MattermostPostResponse;
    const postId = post.id ?? "";
    return {
      channelId,
      postId,
      permalink: postId ? `${route.baseUrl}/_redirect/pl/${postId}` : "",
      skipped: false,
      error: null,
    };
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    return {
      channelId,
      postId: "",
      permalink: "",
      skipped: false,
      error: messageText,
    };
  }
}

export async function dispatchKanMessage(
  input: KanPushDispatchRequest,
): Promise<KanPushDispatchResult> {
  const route = findKanPushRoute(input.routeId, input.platform);
  if (!route) {
    throw new Error("没有找到匹配的 Kan 推送路由");
  }

  const message = input.message.trim();
  if (!message) {
    throw new Error("推送消息不能为空");
  }

  const channelIds = normalizeChannelIds(route, input.channelIds);
  if (channelIds.length === 0) {
    throw new Error("没有可用的 Kan 频道");
  }

  const dryRun = Boolean(input.dryRun);
  const deliveries: KanPushDelivery[] = [];
  for (const channelId of channelIds) {
    if (dryRun) {
      deliveries.push({
        channelId,
        postId: "dry-run",
        permalink: "",
        skipped: true,
        error: null,
      });
      continue;
    }
    deliveries.push(await postKanMessage(route, channelId, message));
  }

  return {
    ok: deliveries.every((item) => item.error === null),
    dryRun,
    routeId: route.id,
    platform: route.platform,
    channelCount: deliveries.length,
    deliveries,
    generatedAt: new Date().toISOString(),
  };
}
