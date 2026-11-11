import type { Failure } from "./types";

// R1: every dollar amount in a reply must appear in the handbook.
export function amountsIn(reply: string): number[] {
  const found: number[] = [];
  const patterns = [
    /(?:USD|US\$|\$)\s?(\d[\d,]*(?:\.\d+)?)/gi,
    /(\d[\d,]*(?:\.\d+)?)\s?(?:USD|dollars?)\b/gi,
    /(\d[\d,]*(?:\.\d+)?)\s?(?:per|a|each)\s+term\b/gi,
  ];
  for (const p of patterns) for (const m of reply.matchAll(p)) found.push(Number(m[1].replace(/,/g, "")));
  return [...new Set(found)];
}

// The right amount for the right level. Checked against the handbook table in the tests.
export const LEVEL_FEES: { name: string; fee: number; test: RegExp }[] = [
  { name: "ECD", fee: 380, test: /\becd\b/i },
  { name: "Grade 1 to 3", fee: 450, test: /\bgrade\s?[1-3]\b/i },
  { name: "Grade 4 to 7", fee: 520, test: /\bgrade\s?[4-7]\b/i },
  { name: "Form 1 to 4", fee: 680, test: /\bform\s?[1-4]\b/i },
];

// If the parent names exactly one level, the reply must give that level's term fee
// and not another level's. (Wrong number for the right topic is the failure R1 alone misses.)
export function checkLevelFee(parentMessage: string, reply: string): Failure[] {
  const named = LEVEL_FEES.filter((l) => l.test.test(parentMessage));
  if (named.length !== 1) return [];
  const amounts = amountsIn(reply);
  const failures: Failure[] = [];
  if (!amounts.includes(named[0].fee)) failures.push({ rule: "R1", detail: `reply does not give the ${named[0].name} fee` });
  for (const other of LEVEL_FEES) {
    if (other !== named[0] && amounts.includes(other.fee)) failures.push({ rule: "R1", detail: `reply gives the ${other.name} fee for a ${named[0].name} question` });
  }
  return failures;
}

export function checkR1(reply: string, allowed: Set<number>): Failure[] {
  return amountsIn(reply)
    .filter((n) => !allowed.has(n))
    .map((n) => ({ rule: "R1", detail: `amount ${n} is not in the handbook` }));
}
