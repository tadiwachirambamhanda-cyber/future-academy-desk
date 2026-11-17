import type { Failure } from "./types";

// R6 (code half): a reply may only use numbers that appear in the handbook or in the conversation
// (the parent's own words). This catches an invented date, age, class size or time. Code cannot
// check every claim in prose, so the handbook-only instruction, the topic routing and the
// writer's own "answerable" flag stay as the other layers.
function numbersIn(text: string): Set<number> {
  return new Set((text.match(/\d+/g) ?? []).map(Number));
}

export function checkGrounding(reply: string, groundTexts: string[]): Failure[] {
  const known = new Set<number>();
  for (const t of groundTexts) for (const n of numbersIn(t)) known.add(n);
  return [...numbersIn(reply)]
    .filter((n) => !known.has(n))
    .map((n) => ({ rule: "R6", detail: `number ${n} is not in the handbook or the conversation` }));
}
