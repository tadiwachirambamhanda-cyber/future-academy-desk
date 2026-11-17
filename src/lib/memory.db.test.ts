import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { createMemory } from "./memory";

// Needs SUPABASE_URL and SUPABASE_SECRET_KEY. Run with: npm run test:db
const db = getDb();
const memory = createMemory(db);
const waIds: string[] = [];
const newWaId = () => {
  const id = `test-${randomUUID()}`; // made-up, never a real number
  waIds.push(id);
  return id;
};

afterAll(async () => {
  // messages go with their conversation (on delete cascade)
  await db.from("academy_conversations").delete().in("wa_id", waIds);
});

describe("memory against the real database", () => {
  it("saves a message and reads the conversation back in order", async () => {
    const waId = newWaId();
    const a = await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "first", sentAt: new Date("2026-11-11T10:00:01Z") });
    await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "third", sentAt: new Date("2026-11-11T10:00:03Z") });
    await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "second", sentAt: new Date("2026-11-11T10:00:02Z") });
    expect(a.inserted).toBe(true);
    const rows = await memory.getRecentMessages(a.conversationId);
    expect(rows.map((r) => r.body)).toEqual(["first", "second", "third"]);
    expect(rows.every((r) => r.direction === "in")).toBe(true);
  });

  it("marks stored rows as synthetic by default", async () => {
    const waId = newWaId();
    const r = await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "hi", sentAt: new Date() });
    const conv = await db.from("academy_conversations").select("is_synthetic").eq("id", r.conversationId).single();
    const msg = await db.from("academy_messages").select("is_synthetic").eq("id", r.messageId).single();
    expect(conv.data?.is_synthetic).toBe(true);
    expect(msg.data?.is_synthetic).toBe(true);
  });

  it("saves the same WhatsApp message id only once", async () => {
    const waId = newWaId();
    const waMessageId = `m-${randomUUID()}`;
    const first = await memory.saveInbound({ waId, waMessageId, body: "once", sentAt: new Date() });
    const second = await memory.saveInbound({ waId, waMessageId, body: "once", sentAt: new Date() });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.messageId).toBe(first.messageId);
    const rows = await memory.getRecentMessages(first.conversationId);
    expect(rows).toHaveLength(1);
  });

  it("makes one conversation when two messages arrive at the same moment from a new number", async () => {
    const waId = newWaId();
    const [x, y] = await Promise.all([
      memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "x", sentAt: new Date() }),
      memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "y", sentAt: new Date() }),
    ]);
    expect(x.conversationId).toBe(y.conversationId);
    const rows = await memory.getRecentMessages(x.conversationId);
    expect(rows).toHaveLength(2);
    const convs = await db.from("academy_conversations").select("id").eq("wa_id", waId);
    expect(convs.data).toHaveLength(1);
  });

  it("returns only the last 10 messages", async () => {
    const waId = newWaId();
    let conversationId = "";
    for (let i = 1; i <= 12; i++) {
      const r = await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: `n${i}`, sentAt: new Date(Date.UTC(2026, 10, 11, 10, 0, i)) });
      conversationId = r.conversationId;
    }
    const rows = await memory.getRecentMessages(conversationId);
    expect(rows).toHaveLength(10);
    expect(rows[0].body).toBe("n3");
    expect(rows[9].body).toBe("n12");
  });

  it("saves a classification on a message and reads every field back (F2)", async () => {
    const waId = newWaId();
    const r = await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "fees?", sentAt: new Date() });
    await memory.saveClassification(r.messageId, {
      engine: "jev", language: "english", languageConfidence: 0.97, label: "fees", labelConfidence: 0.91,
      latencyMs: 420, inputTokens: 210, costUsd: 0.00000882, error: null,
    });
    const row = await db.from("academy_messages").select("*").eq("id", r.messageId).single();
    expect(row.data).toMatchObject({
      language: "english", label: "fees", engine: "jev", latency_ms: 420, input_tokens: 210, classification_error: null,
    });
    expect(row.data?.label_confidence).toBeCloseTo(0.91, 2);
    expect(Number(row.data?.cost_usd)).toBeCloseTo(0.00000882, 8);
  });

  it("reports a saved message with no engine as not classified, and as classified once it has one (F2)", async () => {
    const waId = newWaId();
    const waMessageId = `m-${randomUUID()}`;
    const first = await memory.saveInbound({ waId, waMessageId, body: "hi", sentAt: new Date() });
    expect(first.classified).toBe(false);
    const retry = await memory.saveInbound({ waId, waMessageId, body: "hi", sentAt: new Date() });
    expect(retry.inserted).toBe(false);
    expect(retry.classified).toBe(false); // first attempt was cut off: the retry should classify it
    await memory.saveClassification(first.messageId, {
      engine: "error", language: null, languageConfidence: null, label: null, labelConfidence: null,
      latencyMs: 2000, inputTokens: null, costUsd: null, error: "TimeoutError",
    });
    const again = await memory.saveInbound({ waId, waMessageId, body: "hi", sentAt: new Date() });
    expect(again.classified).toBe(true);
  });

  it("finds the parent's previous message in the same conversation, within 24 hours (F2)", async () => {
    const waId = newWaId();
    const other = newWaId();
    const t = (h: number) => new Date(Date.UTC(2026, 10, 12, 12, 0, 0) + h * 3_600_000);
    const old = await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "a week ago", sentAt: new Date(t(0).getTime() - 7 * 24 * 3_600_000) });
    await memory.saveInbound({ waId: other, waMessageId: `m-${randomUUID()}`, body: "someone else", sentAt: t(-1) });
    const first = await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "How much is Grade 3?", sentAt: t(-2) });
    const second = await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: "And Form 1?", sentAt: t(0) });

    // a message from a week ago is too old, and another parent's message is never used
    expect(old.conversationId).toBe(first.conversationId);
    expect(await memory.getPreviousParentMessage(first.conversationId, first.messageId, t(-2))).toBeNull();
    // the follow-up sees the earlier message from the same conversation only
    expect(await memory.getPreviousParentMessage(second.conversationId, second.messageId, t(0))).toBe("How much is Grade 3?");
  });
});
