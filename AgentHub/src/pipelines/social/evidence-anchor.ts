export interface EvidenceAnchorItem {
  readonly url?: string;
  readonly messageId?: string;
  readonly title: string;
  readonly content: string;
}

export function mergeEvidenceAnchorItems<T extends EvidenceAnchorItem>(
  searchedItems: readonly T[],
  sourceAnchorItems: readonly T[],
  limit = 8,
): readonly T[] {
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const item of [...sourceAnchorItems, ...searchedItems]) {
    const key = [item.url, item.messageId, item.title, item.content.slice(0, 160)]
      .filter(Boolean)
      .join("|")
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= Math.max(1, limit)) break;
  }
  return merged;
}
