import type { SearchResult } from "./types";

/**
 * Compute Jaccard similarity between two sets of words.
 */
function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function wordSet(text: string): ReadonlySet<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * Apply Maximal Marginal Relevance to reduce near-duplicate results.
 *
 * MMR = lambda * relevance - (1 - lambda) * maxSimilarityToSelected
 *
 * Uses Jaccard similarity on word sets (lightweight, no extra embeddings).
 */
export function applyMmr(
  results: readonly SearchResult[],
  lambda: number,
  limit: number,
): readonly SearchResult[] {
  if (results.length <= 1 || limit <= 0) return results.slice(0, limit);

  const wordSets = results.map((r) => wordSet(r.chunk.content));
  const selected: number[] = [];
  const remaining = new Set(results.map((_, i) => i));

  // Always pick the highest-scored result first
  selected.push(0);
  remaining.delete(0);

  while (selected.length < limit && remaining.size > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (const idx of remaining) {
      const relevance = results[idx]!.score;

      // Max similarity to any already-selected result
      let maxSim = 0;
      for (const selIdx of selected) {
        const sim = jaccardSimilarity(wordSets[idx]!, wordSets[selIdx]!);
        if (sim > maxSim) maxSim = sim;
      }

      const mmr = lambda * relevance - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = idx;
      }
    }

    if (bestIdx < 0) break;
    selected.push(bestIdx);
    remaining.delete(bestIdx);
  }

  return selected.map((i) => results[i]!);
}
