/**
 * Lightweight similarity check using 5-gram Jaccard index on word sequences.
 * Returns a value 0–1 (1 = identical). Runs server-side only.
 */
export function similarity(a: string, b: string): number {
  const ngrams = (text: string, n: number): Set<string> => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const result = new Set<string>();
    for (let i = 0; i <= words.length - n; i++) {
      result.add(words.slice(i, i + n).join(" "));
    }
    return result;
  };

  const N = 5;
  const sa = ngrams(a, N);
  const sb = ngrams(b, N);
  if (!sa.size && !sb.size) return 1;
  if (!sa.size || !sb.size) return 0;

  let intersection = 0;
  for (const g of sa) {
    if (sb.has(g)) intersection++;
  }
  const union = sa.size + sb.size - intersection;
  return intersection / union;
}
