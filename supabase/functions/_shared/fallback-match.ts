import { normalize, similarity } from "./utils.ts";

/** Remove catalog edition labels and subtitles from a title. */
export function mainTitle(title: string): string {
  const withoutTags = String(title ?? "").replace(/\[[^\]]*\]/g, " ");
  const separator = withoutTags.search(/[:(]/);
  return (separator < 0 ? withoutTags : withoutTags.slice(0, separator))
    .replace(/\s+/g, " ")
    .trim();
}

function bigramDice(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
  const counts = new Map<string, number>();
  for (let i = 0; i + 1 < left.length; i++) {
    const gram = left.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i + 1 < right.length; i++) {
    const gram = right.slice(i, i + 2);
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      shared++;
      counts.set(gram, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length - 2);
}

/** Match catalog titles using word-set or character-bigram Dice. */
export function titleMatch(left: string, right: string): boolean {
  const a = mainTitle(left);
  const b = mainTitle(right);
  return similarity(a, b) >= 0.8 ||
    bigramDice(normalize(a), normalize(b)) >= 0.85;
}
