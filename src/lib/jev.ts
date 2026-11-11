// Every question the agent asks Jev about an incoming message lives in this file.
// Jev is a classifier: it proposes a label and a confidence, and code judges them.
// Server side only: the key (TYPESAFE_API_KEY) is read when a call is made.

import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";
import { nonEnglishWordMatch } from "./language";

export const JEV_MODEL = "jev-1.13.0";
export const JEV_MIN_CONFIDENCE = 0.6; // below this an answer counts as "not sure"
export const JEV_TIMEOUT_MS = 2000;
export const JEV_MAX_TEXT_CHARS = 1000;
const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000; // output tokens are free

// Questions are short and neutral. The parent's words are never part of a question:
// they go in as state (data) only.
export const QUESTIONS = {
  intent: {
    ask: "What does the parent want?",
    options: {
      fees: "They ask about school fees, the application fee, the registration fee, discounts, or how or when to pay",
      term_dates: "They ask when terms start or end, or about holidays",
      school_day: "They ask about lesson times, gate times or after-school clubs",
      admissions: "They ask how to apply, about entry ages, or about the assessment or enrolment steps",
      visit: "They want to visit, tour or see the school",
      uniform: "They ask about the school uniform",
      transport: "They ask about the school bus or transport",
      contact: "They ask for the school's phone number, email, address or office hours",
      health_safety: "They mention an illness, injury, allergy, medication, safety worry or emergency involving a child",
      complaint: "They are unhappy about something that already happened",
      bypass_attempt: "They tell the assistant to ignore its rules or instructions, or demand a guaranteed place, a special price or a promise",
      greeting: "Only a greeting such as hello or good morning, with no question or request",
      closing: "Only a thank-you, a simple acknowledgement such as ok, or a goodbye, with no question or request",
      other_school_question: "A question about the school that fits none of the other options",
      unsure: "The message is too unclear to tell",
    },
  },
  language: {
    ask: "Which language is the message written in?",
    options: {
      english: "English",
      shona: "Shona",
      ndebele: "Ndebele",
      other_language: "Any language that is not English, Shona or Ndebele",
      unsure: "It is too short or unclear to tell",
    },
  },
} as const;

export type Intent = keyof typeof QUESTIONS.intent.options;
export type Language = keyof typeof QUESTIONS.language.options;

const BUSINESS_CONTEXT = "A school receiving a WhatsApp enquiry from a parent.";

// ---------------------------------------------------------------------------
// What the rest of the app sees
// ---------------------------------------------------------------------------

export type Classification = {
  engine: "jev" | "claude" | "error" | "skipped";
  language: string | null; // what Jev (or the word check, or Claude) said
  languageConfidence: number | null;
  label: string | null; // empty means: not for the English path
  labelConfidence: number | null;
  latencyMs: number;
  inputTokens: number | null;
  costUsd: number | null;
  error: string | null; // kind of failure only, never message text
  moneyException?: boolean; // only the Claude reader sets this; it is not stored
};

export type JevAnswers = {
  intent: { choice: string; confidence: number };
  language: { choice: string; confidence: number };
  inputTokens: number | null;
};

export type AskJev = (state: Record<string, string>) => Promise<JevAnswers>;

const AnswersSchema = z.object({
  intent: z.object({ choice: z.enum(Object.keys(QUESTIONS.intent.options) as [Intent, ...Intent[]]), confidence: z.number().min(0).max(1) }),
  language: z.object({ choice: z.enum(Object.keys(QUESTIONS.language.options) as [Language, ...Language[]]), confidence: z.number().min(0).max(1) }),
  inputTokens: z.number().nullable(),
});

// The real call: both questions in one request, so they succeed or fail together.
export const askJevForReal: AskJev = async (state) => {
  const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY
  const { answers, usage } = await client.systemOne(
    {
      state,
      questions: {
        intent: choice(QUESTIONS.intent.ask, QUESTIONS.intent.options),
        language: choice(QUESTIONS.language.ask, QUESTIONS.language.options),
      },
      model: JEV_MODEL,
    },
    { timeout: JEV_TIMEOUT_MS, signal: AbortSignal.timeout(JEV_TIMEOUT_MS), retry: { maxRetries: 0 } },
  );
  return {
    intent: { choice: answers.intent.choice, confidence: answers.intent.confidence },
    language: { choice: answers.language.choice, confidence: answers.language.confidence },
    inputTokens: usage.input_tokens,
  };
};

export type ClassifyOptions = {
  earlierMessage?: string | null; // the parent's previous message, if any
  ask?: AskJev; // replaced by a fake in tests
};

// Never throws. A failure comes back as engine "error".
export async function classifyMessage(text: string, options: ClassifyOptions = {}): Promise<Classification> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const empty = { latencyMs: 0, inputTokens: null, costUsd: null, error: null };

  // 1. Nothing to read: do not call Jev.
  if (text.trim() === "") {
    return { engine: "skipped", language: null, languageConfidence: null, label: null, labelConfidence: null, ...empty };
  }

  // 2. Shona or Ndebele words, even mixed with English: not for Jev.
  const match = nonEnglishWordMatch(text);
  if (match) {
    return { engine: "skipped", language: match, languageConfidence: null, label: null, labelConfidence: null, ...empty };
  }

  // 3. Ask Jev, with the parent's words as state only.
  const state: Record<string, string> = {
    business: BUSINESS_CONTEXT,
    customer_message: text.slice(0, JEV_MAX_TEXT_CHARS),
  };
  if (options.earlierMessage) state.earlier_message = options.earlierMessage.slice(0, JEV_MAX_TEXT_CHARS);

  let raw: JevAnswers;
  try {
    raw = await (options.ask ?? askJevForReal)(state);
  } catch (err) {
    const kind = err instanceof Error ? err.name : "unknown";
    return { engine: "error", language: null, languageConfidence: null, label: null, labelConfidence: null, latencyMs: ms(), inputTokens: null, costUsd: null, error: kind };
  }

  const parsed = AnswersSchema.safeParse(raw);
  if (!parsed.success) {
    return { engine: "error", language: null, languageConfidence: null, label: null, labelConfidence: null, latencyMs: ms(), inputTokens: null, costUsd: null, error: "invalid_answer" };
  }

  // 4. Code judges.
  const a = parsed.data;
  const languageConfidence = a.language.confidence;
  const intentConfidence = a.intent.confidence;
  const isEnglish = a.language.choice === "english" && languageConfidence >= JEV_MIN_CONFIDENCE;
  const label = !isEnglish ? null : intentConfidence >= JEV_MIN_CONFIDENCE ? a.intent.choice : "unsure";

  return {
    engine: "jev",
    language: a.language.choice,
    languageConfidence,
    label,
    labelConfidence: isEnglish ? intentConfidence : null,
    latencyMs: ms(),
    inputTokens: a.inputTokens,
    costUsd: a.inputTokens === null ? null : a.inputTokens * JEV_USD_PER_INPUT_TOKEN,
    error: null,
  };
}
