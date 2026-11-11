// An in-memory Memory for unit tests. No database, no keys.
import type { Memory, InboundMessage, StoredMessage, DecisionPatch, StoredClassification } from "../memory";
import type { Classification } from "../jev";

export type FakeState = {
  messages: (StoredMessage & { conversationId: string; waMessageId: string | null })[];
  decisions: Map<string, DecisionPatch & { claimedAt: number }>;
  handovers: { conversationId: string; messageId: string; reason: string }[];
  classifications: Map<string, Classification>;
};

export function fakeMemory(opts: { failClaim?: boolean } = {}) {
  const state: FakeState = { messages: [], decisions: new Map(), handovers: [], classifications: new Map() };
  const seen = new Map<string, string>();
  let n = 0;
  const memory: Memory = {
    async saveInbound(m: InboundMessage) {
      const dup = seen.get(m.waMessageId);
      if (dup) return { conversationId: `c-${m.waId}`, messageId: dup, inserted: false, classified: state.classifications.has(dup) };
      const id = `m-${++n}`;
      seen.set(m.waMessageId, id);
      state.messages.push({ id, direction: "in", body: m.body, sent_at: m.sentAt.toISOString(), conversationId: `c-${m.waId}`, waMessageId: m.waMessageId });
      return { conversationId: `c-${m.waId}`, messageId: id, inserted: true, classified: false };
    },
    async getRecentMessages(conversationId, limit = 10) {
      return state.messages.filter((x) => x.conversationId === conversationId).slice(-limit).map(({ id, direction, body, sent_at }) => ({ id, direction, body, sent_at }));
    },
    async saveClassification(messageId, result) {
      state.classifications.set(messageId, result);
    },
    async getPreviousParentMessage() {
      return null;
    },
    async claimMessage(_c, messageId) {
      if (opts.failClaim) throw new Error("db down");
      if (state.decisions.has(messageId)) return false;
      state.decisions.set(messageId, { status: "claimed", claimedAt: Date.now() });
      return true;
    },
    async updateDecision(messageId, patch) {
      state.decisions.set(messageId, { ...(state.decisions.get(messageId) ?? { claimedAt: Date.now() }), ...patch });
    },
    async saveHandover(h) {
      state.handovers.push(h);
    },
    async saveOutbound({ conversationId, waMessageId, body, sentAt }) {
      state.messages.push({ id: `o-${++n}`, direction: "out", body, sent_at: sentAt.toISOString(), conversationId, waMessageId });
    },
    async countOutboundSince(conversationId, since) {
      return state.messages.filter((x) => x.conversationId === conversationId && x.direction === "out" && Date.parse(x.sent_at) >= since.getTime()).length;
    },
    async getMessageClassification(messageId): Promise<StoredClassification | null> {
      const c = state.classifications.get(messageId);
      return c ? { engine: c.engine, label: c.label, labelConfidence: c.labelConfidence, language: c.language } : null;
    },
  };
  return { memory, state };
}
