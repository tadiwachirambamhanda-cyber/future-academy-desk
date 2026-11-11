import type { SupabaseClient } from "@supabase/supabase-js";

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
};

export type StoredMessage = {
  id: string;
  direction: "in" | "out";
  body: string;
  sent_at: string;
};

export type Memory = {
  saveInbound(message: InboundMessage): Promise<SaveResult>;
  getRecentMessages(conversationId: string, limit?: number): Promise<StoredMessage[]>;
};

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
  };
}
