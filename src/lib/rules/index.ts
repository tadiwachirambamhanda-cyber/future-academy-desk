import { allowedAmounts, getHandbookText } from "../handbook";
import { checkGrounding } from "./r6-grounding";
import { checkLevelFee, checkR1 } from "./r1-amounts";
import { checkR2 } from "./r2-no-promises";
import { checkR3 } from "./r3-visits";
import { checkR8 } from "./r8-bank-details";
import { checkR9 } from "./r9-language";
import type { Failure, ReplyLanguage } from "./types";

export * from "./types";
export { decide, expectedLanguage } from "./decide";
export type { DecideInput } from "./decide";

export type CheckResult = { ok: boolean; failures: Failure[]; ran: string[] };

// The reply checks. Code checks facts, not words: amounts, promises, visit times,
// bank details and the language. Visit rules apply to visit replies only.
export function checkReply(
  reply: string,
  context: { label: string; expectedLanguage: ReplyLanguage; declaredLanguage: string; parentMessage: string; conversation?: string[] },
  allowed: Set<number> = allowedAmounts(),
  handbook: string = getHandbookText(),
): CheckResult {
  const ran = ["R1", "R2", "R6", "R8", "R9"];
  const failures = [
    ...checkR1(reply, allowed),
    ...checkR2(reply),
    ...checkGrounding(reply, [handbook, context.parentMessage, ...(context.conversation ?? [])]),
    ...checkR8(reply),
    ...checkR9(context.declaredLanguage, context.expectedLanguage, reply),
  ];
  if (context.label === "fees") failures.push(...checkLevelFee(context.parentMessage, reply));
  if (context.label === "visit") {
    ran.push("R3");
    failures.push(...checkR3(reply));
  }
  return { ok: failures.length === 0, failures, ran };
}
