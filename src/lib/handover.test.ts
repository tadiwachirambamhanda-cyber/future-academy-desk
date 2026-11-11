import { describe, it, expect } from "vitest";
import { holdingReply, officePhone } from "./handover";
import type { HandoverReason } from "./rules";

const reasons: HandoverReason[] = ["not_in_handbook", "bypass_attempt", "complaint", "health_safety", "money", "low_confidence", "check_failed", "model_error", "unsupported_language", "cap_reached", "send_failed"];

describe("F6: holding replies", () => {
  it("reads the office phone number from the handbook", () => {
    expect(officePhone()).toBe("+263 77 000 0000");
  });
  it("every reason has a holding reply in every language, with the phone filled in", () => {
    for (const reason of reasons) {
      for (const language of ["english", "shona", "ndebele"] as const) {
        const text = holdingReply(reason, language, "+263 77 000 0000");
        expect(text).toContain("+263 77 000 0000");
        expect(text).not.toContain("{phone}");
      }
    }
  });
  it("a health or safety hand-over tells the parent to call the school now", () => {
    expect(holdingReply("health_safety", "english", "123")).toContain("call the school office now");
  });
  it("a holding reply never promises a place, a time or a fee", () => {
    for (const reason of reasons) {
      const text = holdingReply(reason, "english", "+263 77 000 0000");
      expect(text).not.toMatch(/guarantee|confirmed|booked|USD|\$/i);
    }
  });
  it("an unsupported language gets the English wording", () => {
    expect(holdingReply("unsupported_language", "shona", "1")).toBe(holdingReply("unsupported_language", "english", "1"));
  });
});
