export type Failure = { rule: string; detail: string };

export type HandoverReason =
  | "not_in_handbook"
  | "bypass_attempt"
  | "complaint"
  | "health_safety"
  | "money"
  | "low_confidence"
  | "check_failed"
  | "model_error"
  | "unsupported_language"
  | "cap_reached"
  | "send_failed";

export type Decision =
  | { action: "answer"; topic: string }
  | { action: "no_reply"; reason: "closing" }
  | { action: "handover"; reason: HandoverReason };

export type ReplyLanguage = "english" | "shona" | "ndebele";
