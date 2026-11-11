// A cheap check in code, before Jev: common Shona and Ndebele words.
// Jev is an English-first classifier, so a message holding any of these words goes
// straight to the non-English path (Claude, in F3), even if it is mixed with English,
// such as "Mari ye Grade 3 please".
//
// DRAFT word lists: a Shona speaker and a Ndebele speaker should review them.

const SHONA_WORDS = [
  "mari", "marii", "ndinoda", "ndinokumbira", "ndiri", "ndatenda", "makadii", "mhoro",
  "mangwanani", "masikati", "manheru", "mwana", "chikoro", "kwete", "ehe", "zvakanaka",
];

const NDEBELE_WORDS = [
  "ngicela", "ngifuna", "malini", "sawubona", "ngiyabonga", "ngiyathokoza", "unjani",
  "yebo", "ukuthi", "umntwana", "isikolo", "kunjani", "hawu", "ngiyaphila",
];

export type NonEnglishMatch = "shona" | "ndebele" | null;

function wordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}']+/gu) ?? []);
}

export function nonEnglishWordMatch(text: string): NonEnglishMatch {
  const words = wordsOf(text);
  const shona = SHONA_WORDS.filter((w) => words.has(w)).length;
  const ndebele = NDEBELE_WORDS.filter((w) => words.has(w)).length;
  if (shona === 0 && ndebele === 0) return null;
  return shona >= ndebele ? "shona" : "ndebele";
}
