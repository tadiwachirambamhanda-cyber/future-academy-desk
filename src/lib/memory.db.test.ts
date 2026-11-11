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
});
