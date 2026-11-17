import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Classification } from "./jev";

export type InboundMessage = {
  waId: string;
  waMessageId: string;
  body: string;
  sentAt: Date;
};

export type SaveResult = {
  conversationId: string;
  messageId: string;
  inserted: boolean; // false when this WhatsApp message id was already saved
  classified: boolean; // true when the message already has an engine (Jev ran, failed or was skipped)
};

export type StoredMessage = {
  id: string;
  direction: "in" | "out";
  body: string;
  sent_at: string;
};

export type StoredClassification = {
  engine: "jev" | "claude" | "error" | "skipped" | null;
  label: string | null;
  labelConfidence: number | null;
  language: string | null;
};

export type DecisionPatch = Partial<{
  status: "claimed" | "answered" | "needs_person" | "no_reply";
  reason: string | null;
  language: string | null;
  label: string | null;
  labelConfidence: number | null;
  checks: unknown;
  fixAttempted: boolean;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  sent: boolean;
  sendError: string | null;
}>;

export type Memory = {
  saveInbound(message: InboundMessage): Promise<SaveResult>;
  getRecentMessages(conversationId: string, limit?: number): Promise<StoredMessage[]>;
  saveClassification(messageId: string, result: Classification): Promise<void>;
  // The parent's last earlier message in the same conversation, sent in the last 24 hours.
  getPreviousParentMessage(conversationId: string, messageId: string, sentAt: Date): Promise<string | null>;
  // F7: one run per message. True for the first run (or a run that finds a stale claim).
  // "claimed": this run answers. "taken": another run has it. "cap": too many replies in 24 hours (recorded as a hand-over by the database).
  claimMessage(conversationId: string, messageId: string, cap?: number): Promise<"claimed" | "taken" | "cap">;
  updateDecision(messageId: string, patch: DecisionPatch): Promise<void>;
  saveHandover(input: { conversationId: string; messageId: string; reason: string }): Promise<void>;
  saveOutbound(input: { conversationId: string; waMessageId: string | null; body: string; sentAt: Date }): Promise<void>;
  getMessageClassification(messageId: string): Promise<StoredClassification | null>;
};

export const PREVIOUS_MESSAGE_WINDOW_HOURS = 24;

// Oldest first. Messages with the same timestamp are ordered by id.
export function oldestFirst(rows: StoredMessage[]): StoredMessage[] {
  return [...rows].sort((a, b) => {
    const byTime = Date.parse(a.sent_at) - Date.parse(b.sent_at);
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// The only code that talks to the academy_ tables.
export function createMemory(db: SupabaseClient): Memory {
  return {
    async saveInbound(message) {
      const { data, error } = await db.rpc("academy_save_inbound", {
        p_wa_id: message.waId,
        p_wa_message_id: message.waMessageId,
        p_body: message.body,
        p_sent_at: message.sentAt.toISOString(),
      });
      if (error) throw new Error(`save failed: ${error.code ?? "unknown"}`);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("save failed: empty result");
      return {
        conversationId: row.out_conversation_id,
        messageId: row.out_message_id,
        inserted: row.out_inserted,
        classified: row.out_classified,
      };
    },

    async getRecentMessages(conversationId, limit = 10) {
      const { data, error } = await db
        .from("academy_messages")
        .select("id, direction, body, sent_at")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`read failed: ${error.code ?? "unknown"}`);
      return oldestFirst((data ?? []) as StoredMessage[]);
    },

    async saveClassification(messageId, result) {
      const { error } = await db
        .from("academy_messages")
        .update({
          language: result.language,
          language_confidence: result.languageConfidence,
          label: result.label,
          label_confidence: result.labelConfidence,
          engine: result.engine,
          latency_ms: result.latencyMs,
          input_tokens: result.inputTokens,
          cost_usd: result.costUsd,
          classification_error: result.error,
        })
        .eq("id", messageId);
      if (error) throw new Error(`classification save failed: ${error.code ?? "unknown"}`);
    },

    async getPreviousParentMessage(conversationId, messageId, sentAt) {
      const since = new Date(sentAt.getTime() - PREVIOUS_MESSAGE_WINDOW_HOURS * 3_600_000);
      const { data, error } = await db
        .from("academy_messages")
        .select("body")
        .eq("conversation_id", conversationId)
        .eq("direction", "in")
        .neq("id", messageId)
        .gte("sent_at", since.toISOString())
        .lte("sent_at", sentAt.toISOString())
        .order("sent_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (error) throw new Error(`read failed: ${error.code ?? "unknown"}`);
      return data && data.length > 0 ? (data[0].body as string) : null;
    },

    async claimMessage(conversationId, messageId, cap = 20) {
      const { data, error } = await db.rpc("academy_claim_message", { p_conversation_id: conversationId, p_message_id: messageId, p_cap: cap });
      if (error) throw new Error(`claim failed: ${error.code ?? "unknown"}`);
      return data === "claimed" || data === "cap" ? data : "taken";
    },

    async updateDecision(messageId, patch) {
      const row: Record<string, unknown> = {};
      const map: Record<string, string> = {
        status: "status", reason: "reason", language: "language", label: "label", labelConfidence: "label_confidence",
        checks: "checks", fixAttempted: "fix_attempted", model: "model", inputTokens: "input_tokens",
        outputTokens: "output_tokens", costUsd: "cost_usd", latencyMs: "latency_ms", sent: "sent", sendError: "send_error",
      };
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) row[map[key]] = value;
      const { error } = await db.from("academy_decisions").update(row).eq("message_id", messageId);
      if (error) throw new Error(`decision save failed: ${error.code ?? "unknown"}`);
    },

    async saveHandover({ conversationId, messageId, reason }) {
      const { error } = await db.from("academy_handovers").insert({ conversation_id: conversationId, message_id: messageId, reason });
      if (error) throw new Error(`handover save failed: ${error.code ?? "unknown"}`);
    },

    async saveOutbound({ conversationId, waMessageId, body, sentAt }) {
      const { error } = await db.from("academy_messages").insert({
        conversation_id: conversationId,
        direction: "out",
        body,
        wa_message_id: waMessageId ?? `out-${randomUUID()}`,
        sent_at: sentAt.toISOString(),
      });
      if (error) throw new Error(`outgoing save failed: ${error.code ?? "unknown"}`);
    },

    async getMessageClassification(messageId) {
      const { data, error } = await db
        .from("academy_messages")
        .select("engine, label, label_confidence, language")
        .eq("id", messageId)
        .maybeSingle();
      if (error) throw new Error(`read failed: ${error.code ?? "unknown"}`);
      if (!data) return null;
      return { engine: data.engine, label: data.label, labelConfidence: data.label_confidence, language: data.language };
    },
  };
}
