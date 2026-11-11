import { readFileSync } from "node:fs";
import path from "node:path";

// The handbook is the only source of facts. Read when needed, never at import time.
let cache: string | null = null;

export function getHandbookText(): string {
  if (cache === null) cache = readFileSync(path.join(process.cwd(), "data", "school-handbook.md"), "utf8");
  return cache;
}

// Every dollar amount the handbook states: "USD 25", and the numbers in the fee table.
export function amountsInHandbook(text: string): Set<number> {
  const amounts = new Set<number>();
  for (const m of text.matchAll(/USD\s?(\d[\d,]*)/g)) amounts.add(Number(m[1].replace(/,/g, "")));
  const fees = text.split(/^## /m).find((s) => s.startsWith("Fees")) ?? "";
  for (const m of fees.matchAll(/^\|[^|\n]*\|\s*(\d[\d,]*)\s*\|\s*$/gm)) amounts.add(Number(m[1].replace(/,/g, "")));
  return amounts;
}

export function allowedAmounts(): Set<number> {
  return amountsInHandbook(getHandbookText());
}
