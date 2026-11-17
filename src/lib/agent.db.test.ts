import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { createMemory } from "./memory";

// Needs SUPABASE_URL and SUPABASE_SECRET_KEY. Run with: npm run test:db
const db = getDb();
const memory = createMemory(db);
const waIds: string[] = [];
const newMessage = async (body = "hi") => {
  const waId = `test-${randomUUID()}`; // made-up, never a real number
  waIds.push(waId);
  return memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body, sentAt: new Date() });
};

afterAll(async () => {
  await db.from("academy_conversations").delete().in("wa_id", waIds); // everything else cascades
});

describe("F3 to F7 tables against the real database", () => {
  it("claims a message once, however many runs try", async () => {
    const m = await newMessage();
    const results = await Promise.all([1, 2, 3].map(() => memory.claimMessage(m.conversationId, m.messageId)));
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    expect(await memory.claimMessage(m.conversationId, m.messageId)).toBe("taken");
  });

  it("lets a later run take over a claim that never finished, but not one that did", async () => {
    const m = await newMessage();
    await memory.claimMessage(m.conversationId, m.messageId);
    await db.from("academy_decisions").update({ claimed_at: new Date(Date.now() - 10 * 60_000).toISOString() }).eq("message_id", m.messageId);
    expect(await memory.claimMessage(m.conversationId, m.messageId)).toBe("claimed"); // stale claim reclaimed
    await memory.updateDecision(m.messageId, { status: "answered" });
    await db.from("academy_decisions").update({ claimed_at: new Date(Date.now() - 10 * 60_000).toISOString() }).eq("message_id", m.messageId);
    expect(await memory.claimMessage(m.conversationId, m.messageId)).toBe("taken"); // finished: never again
  });

  it("saves a decision with its checks and cost, and reads every field back", async () => {
    const m = await newMessage();
    await memory.claimMessage(m.conversationId, m.messageId);
    await memory.updateDecision(m.messageId, {
      status: "answered", reason: "fees", language: "shona", label: "fees", labelConfidence: 0.95,
      checks: { ran: ["R1", "R9"], failures: [] }, fixAttempted: true, model: "claude-sonnet-5-5",
      inputTokens: 1500, outputTokens: 120, costUsd: 0.0042, latencyMs: 1800, sent: true, sendError: null,
    });
    const row = await db.from("academy_decisions").select("*").eq("message_id", m.messageId).single();
    expect(row.data).toMatchObject({
      status: "answered", reason: "fees", language: "shona", label: "fees", fix_attempted: true, model: "claude-sonnet-5-5",
      input_tokens: 1500, output_tokens: 120, latency_ms: 1800, sent: true, send_error: null, is_synthetic: true,
    });
    expect(row.data?.checks).toEqual({ ran: ["R1", "R9"], failures: [] });
    expect(Number(row.data?.cost_usd)).toBeCloseTo(0.0042, 6);
  });

  it("saves a hand-over with its reason, open and synthetic", async () => {
    const m = await newMessage();
    await memory.saveHandover({ conversationId: m.conversationId, messageId: m.messageId, reason: "not_in_handbook" });
    const row = await db.from("academy_handovers").select("*").eq("message_id", m.messageId).single();
    expect(row.data).toMatchObject({ reason: "not_in_handbook", status: "open", is_synthetic: true });
  });

  it("saves outgoing messages in the conversation history", async () => {
    const m = await newMessage();
    await memory.saveOutbound({ conversationId: m.conversationId, waMessageId: "wamid.OUT-" + randomUUID(), body: "recent", sentAt: new Date() });
    await memory.saveOutbound({ conversationId: m.conversationId, waMessageId: null, body: "no id", sentAt: new Date() });
    const history = await memory.getRecentMessages(m.conversationId);
    expect(history.map((x) => x.direction).sort()).toEqual(["in", "out", "out"]);
  });

  it("stops claiming at the cap, atomically, even when messages arrive together (codex #4)", async () => {
    const waId = `test-${randomUUID()}`;
    waIds.push(waId);
    const saved = [];
    for (let k = 0; k < 6; k++) saved.push(await memory.saveInbound({ waId, waMessageId: `m-${randomUUID()}`, body: `m${k}`, sentAt: new Date(Date.now() + k) }));
    const results = await Promise.all(saved.map((s) => memory.claimMessage(s.conversationId, s.messageId, 4)));
    expect(results.filter((r) => r === "claimed")).toHaveLength(4);
    expect(results.filter((r) => r === "cap")).toHaveLength(2);
    const capped = await db.from("academy_decisions").select("status, reason").eq("conversation_id", saved[0].conversationId).eq("reason", "cap_reached");
    expect(capped.data).toHaveLength(2);
  });

  it("reads a message's classification back, and none for an unknown id", async () => {
    const m = await newMessage();
    await memory.saveClassification(m.messageId, { engine: "claude", language: "ndebele", languageConfidence: 0.9, label: "visit", labelConfidence: 0.9, latencyMs: 900, inputTokens: 800, costUsd: 0.002, error: null });
    expect(await memory.getMessageClassification(m.messageId)).toEqual({ engine: "claude", label: "visit", labelConfidence: 0.9, language: "ndebele" });
    expect(await memory.getMessageClassification(randomUUID())).toBeNull();
  });
});
