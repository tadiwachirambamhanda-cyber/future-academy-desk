import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "./fixtures/d360-text-message.json";
import { handleWebhook, MAX_BODY_BYTES, SECRET_HEADER } from "./webhook";
import type { Memory, InboundMessage, SaveResult } from "./memory";

const SECRET = "test-secret-value";

function fakeMemory(opts: { fail?: boolean } = {}) {
  const seen = new Map<string, SaveResult>();
  const saved: InboundMessage[] = [];
  const memory: Memory = {
    async saveInbound(m) {
      if (opts.fail) throw new Error("db down");
      const old = seen.get(m.waMessageId);
      if (old) return { ...old, inserted: false };
      const r = { conversationId: `c-${m.waId}`, messageId: `m-${seen.size}`, inserted: true };
      seen.set(m.waMessageId, r);
      saved.push(m);
      return r;
    },
    async getRecentMessages() {
      return [];
    },
  };
  return { memory, saved };
}

const post = (body: BodyInit | null, headers: Record<string, string> = { [SECRET_HEADER]: SECRET }) =>
  new Request("http://localhost/api/whatsapp", { method: "POST", body, headers });

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(String(line)));
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/whatsapp", () => {
  it("refuses a missing or wrong secret and saves nothing", async () => {
    const { memory, saved } = fakeMemory();
    const none = await handleWebhook(post(JSON.stringify(fixture), {}), { memory, secret: SECRET });
    const wrong = await handleWebhook(post(JSON.stringify(fixture), { [SECRET_HEADER]: "nope" }), { memory, secret: SECRET });
    expect(none.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(saved).toHaveLength(0);
  });

  it("refuses everything when the secret is not configured", async () => {
    const { memory, saved } = fakeMemory();
    const res = await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: undefined });
    expect(res.status).toBe(500);
    expect(saved).toHaveLength(0);
  });

  it("saves a good text message and answers 200", async () => {
    const { memory, saved } = fakeMemory();
    const res = await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET });
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
    expect(saved[0].body).toBe("Hello");
  });

  it("saves the same message id only once", async () => {
    const { memory, saved } = fakeMemory();
    await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET });
    const again = await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET });
    expect(again.status).toBe(200);
    expect(saved).toHaveLength(1);
  });

  it("refuses a body over 64 KB, even with no Content-Length", async () => {
    const { memory, saved } = fakeMemory();
    const big = "x".repeat(MAX_BODY_BYTES + 10);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const req = new Request("http://localhost/api/whatsapp", {
      method: "POST",
      body: stream,
      headers: { [SECRET_HEADER]: SECRET },
      duplex: "half",
    } as RequestInit);
    const res = await handleWebhook(req, { memory, secret: SECRET });
    expect(res.status).toBe(413);
    expect(saved).toHaveLength(0);
  });

  it("answers 400 to a broken body and saves nothing", async () => {
    const { memory, saved } = fakeMemory();
    const notJson = await handleWebhook(post("{oops"), { memory, secret: SECRET });
    const badShape = await handleWebhook(post(JSON.stringify([1, 2])), { memory, secret: SECRET });
    expect(notJson.status).toBe(400);
    expect(badShape.status).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it("answers 500 when the database fails, and the log holds no message text or number", async () => {
    const { memory } = fakeMemory({ fail: true });
    const res = await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET });
    expect(res.status).toBe(500);
    const all = logs.join("\n");
    expect(all).toContain("webhook_save_failed");
    expect(all).not.toContain("Hello");
    expect(all).not.toContain("263770000002");
  });

  it("logs counts only when a message is saved", async () => {
    const { memory } = fakeMemory();
    await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET });
    const all = logs.join("\n");
    expect(all).toContain("webhook_received");
    expect(all).not.toContain("Hello");
    expect(all).not.toContain("263770000002");
  });
});

describe("POST /api/whatsapp with an impossible timestamp (codex #1)", () => {
  it("answers 400, not 500, so 360dialog does not retry", async () => {
    const { memory, saved } = fakeMemory();
    const bad = {
      messages: [{ from: "263770000002", id: "wamid.BAD", timestamp: "1e20", type: "text", text: { body: "Hi" } }],
    };
    const res = await handleWebhook(post(JSON.stringify(bad)), { memory, secret: SECRET });
    expect(res.status).toBe(400);
    expect(saved).toHaveLength(0);
  });
});
