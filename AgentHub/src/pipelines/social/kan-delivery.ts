interface DeliveryLike {
  readonly channelId?: unknown;
  readonly error?: unknown;
  readonly skipped?: unknown;
}

export function successfulKanChannelIdsFromPayload(
  payload: Record<string, unknown>,
): readonly string[] {
  const delivery = asRecord(payload.delivery);
  const explicit = stringArray(delivery?.successfulChannelIds);
  const result = asRecord(delivery?.result);
  const deliveries = Array.isArray(result?.deliveries)
    ? result.deliveries
    : Array.isArray(delivery?.deliveries)
      ? delivery.deliveries
      : [];
  const successful = deliveries
    .map((item) => asRecord(item) as DeliveryLike | null)
    .filter((item): item is DeliveryLike => Boolean(item))
    .filter((item) => item.error === null || item.error === undefined)
    .map((item) => typeof item.channelId === "string" ? item.channelId.trim() : "")
    .filter(Boolean);
  return [...new Set([...explicit, ...successful])];
}

export function missingKanChannelIds(
  configuredChannelIds: readonly string[],
  successfulChannelIds: readonly string[],
): readonly string[] {
  const successful = new Set(successfulChannelIds.map((item) => item.trim()).filter(Boolean));
  return [...new Set(configuredChannelIds.map((item) => item.trim()).filter(Boolean))]
    .filter((channelId) => !successful.has(channelId));
}

export function mergeSuccessfulKanChannelIds(
  previous: readonly string[],
  nextPayload: Record<string, unknown>,
): readonly string[] {
  return [...new Set([...previous, ...successfulKanChannelIdsFromPayload(nextPayload)])];
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
