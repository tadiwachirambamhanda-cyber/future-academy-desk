import { nonEnglishWordMatch } from "../language";
import type { Failure, ReplyLanguage } from "./types";

// R9: the reply is in the parent's language (English, Shona or Ndebele).
export const SUPPORTED_LANGUAGES: ReplyLanguage[] = ["english", "shona", "ndebele"];

export function isSupportedLanguage(language: string | null): language is ReplyLanguage {
  return language !== null && (SUPPORTED_LANGUAGES as string[]).includes(language);
}

const ENGLISH_WORDS = new Set([
  "the", "and", "is", "are", "of", "to", "for", "you", "we", "in", "a", "on", "at", "our", "can", "will", "please",
  "your", "with", "this", "that", "it", "from", "be", "by", "if", "or", "have", "has", "not", "do", "does", "about",
  "school", "per", "term", "fees", "fee", "visit", "hello", "thank", "thanks", "welcome", "how", "what", "when",
]);

// A second signal, so the reply's language does not rest on what Claude says it wrote:
// how many of its words are common English words.
export function englishShare(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return 0;
  return words.filter((w) => ENGLISH_WORDS.has(w)).length / words.length;
}

export function checkR9(declared: string, expected: ReplyLanguage, reply: string): Failure[] {
  const failures: Failure[] = [];
  if (declared !== expected) failures.push({ rule: "R9", detail: `reply declared as ${declared}, parent wrote ${expected}` });
  const share = englishShare(reply);
  if (expected === "english") {
    if (share < 0.2 || nonEnglishWordMatch(reply) !== null) failures.push({ rule: "R9", detail: "reply does not look like English" });
  } else if (share >= 0.25) {
    failures.push({ rule: "R9", detail: `reply looks like English, parent wrote ${expected}` });
  }
  return failures;
}
