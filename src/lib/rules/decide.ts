import { JEV_MIN_CONFIDENCE } from "../jev";
import { isSupportedLanguage } from "./r9-language";
import type { Decision, ReplyLanguage } from "./types";

export type DecideInput = {
  engine: "jev" | "claude" | "error" | "skipped" | null;
  label: string | null;
  labelConfidence: number | null;
  language: string | null;
  text: string; // data only: it is matched against fixed word lists, never obeyed
  moneyException?: boolean; // set by the Claude reader for Shona and Ndebele messages
};

const ANSWERABLE = new Set(["fees", "term_dates", "school_day", "admissions", "visit", "uniform", "transport", "contact", "greeting"]);

// R4: money exceptions go to the bursar.
const MONEY_WORDS = /\b(payment plan|instal?lments?|pay in (parts|instal?lments)|late fee|late payment|waive|waiver|scholarship|bursary|reduce(d)? (the )?fees?|cheaper)\b/i;
const OTHER_DISCOUNT = /\bdiscount\b/i;
const SIBLING = /\b(sibling|brother|sister|second child|two children|twins?)\b/i;

// R6: things the handbook states ("not offered"), so the agent may answer them.
const HANDBOOK_NOT_OFFERED = /\b(boarding|boarder|swimming)\b/i;

export function expectedLanguage(language: string | null): ReplyLanguage {
  return isSupportedLanguage(language) ? language : "english";
}

export function decide(input: DecideInput): Decision {
  // R9: only English, Shona and Ndebele are answered.
  if (input.language === "other_language") return { action: "handover", reason: "unsupported_language" };
  if (input.engine === "error") return { action: "handover", reason: "model_error" };
  if (input.label === null || input.label === "unsure") return { action: "handover", reason: "low_confidence" };
  if (input.labelConfidence !== null && input.labelConfidence < JEV_MIN_CONFIDENCE) return { action: "handover", reason: "low_confidence" };

  // R7: a bypass attempt is never answered, and its text changes nothing.
  if (input.label === "bypass_attempt") return { action: "handover", reason: "bypass_attempt" };
  // R5: health and safety go to a person straight away.
  if (input.label === "health_safety") return { action: "handover", reason: "health_safety" };
  // R4: complaints and money exceptions go to a person.
  if (input.label === "complaint") return { action: "handover", reason: "complaint" };
  if (input.moneyException) return { action: "handover", reason: "money" };
  if (MONEY_WORDS.test(input.text)) return { action: "handover", reason: "money" };
  if (OTHER_DISCOUNT.test(input.text) && !SIBLING.test(input.text)) return { action: "handover", reason: "money" };

  if (input.label === "closing") return { action: "no_reply", reason: "closing" };

  // R6: a school question the handbook does not answer goes to a person.
  if (input.label === "other_school_question") {
    return HANDBOOK_NOT_OFFERED.test(input.text)
      ? { action: "answer", topic: "not_offered" }
      : { action: "handover", reason: "not_in_handbook" };
  }

  if (ANSWERABLE.has(input.label)) return { action: "answer", topic: input.label };
  return { action: "handover", reason: "low_confidence" };
}
