// Common English stop words to filter out for better FTS
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "it",
  "its",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "and",
  "or",
  "but",
  "not",
  "with",
  "by",
  "from",
  "as",
  "be",
  "was",
  "are",
  "were",
  "been",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "this",
  "that",
  "these",
  "those",
  "i",
  "we",
  "you",
  "he",
  "she",
  "they",
  "me",
  "us",
  "him",
  "her",
  "them",
  "my",
  "our",
  "your",
  "his",
  "their",
  "what",
  "which",
  "who",
  "how",
  "when",
  "where",
  "why",
  "about",
  "up",
  "out",
  "so",
  "if",
  "then",
  "than",
  "also",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "just",
  "because",
  "while",
  "although",
  "however",
  "both",
  "all",
  "any",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "only",
  "own",
  "same",
  "very",
  "s",
  "t",
  "now",
]);

export interface QueryExpansion {
  readonly original: string;
  readonly keywords: readonly string[];
  readonly ftsQuery: string;
}

export function extractKeywords(query: string): readonly string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .filter((word, index, arr) => arr.indexOf(word) === index); // dedupe
}

export function expandQuery(query: string): QueryExpansion {
  const keywords = extractKeywords(query);
  // Let websearch_to_tsquery handle natural language natively
  // instead of strict AND-joining that requires all keywords to match
  const ftsQuery = query.trim();
  return { original: query, keywords, ftsQuery };
}
