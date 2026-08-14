export function parseJsonFromText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const raw = fenced?.[1] ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)?.[1] ?? text;
  return JSON.parse(raw.trim());
}

export function stableEventKey(title: string): string {
  const normalized = title
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || `event-${crypto.randomUUID()}`;
}
