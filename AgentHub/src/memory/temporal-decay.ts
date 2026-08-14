const SECONDS_PER_DAY = 86_400;

/**
 * Apply exponential temporal decay to a relevance score.
 *
 * Formula: score * exp(-ln(2) / halfLifeDays * ageDays)
 *
 * After `halfLifeDays`, the score is halved. Recent memories rank
 * higher than old ones with the same base relevance.
 */
export function applyTemporalDecay(
  score: number,
  createdAt: number,
  now: number,
  halfLifeDays: number,
): number {
  if (halfLifeDays <= 0) return score;
  const ageDays = Math.max(0, (now - createdAt) / SECONDS_PER_DAY);
  const decay = Math.exp((-Math.LN2 / halfLifeDays) * ageDays);
  return score * decay;
}
