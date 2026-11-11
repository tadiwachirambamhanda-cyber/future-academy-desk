import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "./fixtures/d360-text-message.json";
import { handleWebhook, MAX_BODY_BYTES, SECRET_HEADER, type Classify } from "./webhook";
import type { Memory, InboundMessage, SaveResult } from "./memory";
import type { Classification } from "./jev";

const SECRET = "test-secret-value";

const okClassification = (label = "fees"): Classification => ({
  engine: "jev", language: "english", languageConfidence: 0.97, label, labelConfidence: 0.92,
  latencyMs: 300, inputTokens: 200, costUsd: 0.0000084, error: null,
});

function fakeMemory(opts: { fail?: boolean; previous?: string | null } = {}) {
  const seen = new Map<string, SaveResult>();
  const saved: InboundMessage[] = [];
  const classifications = new Map<string, Classification>();
  const memory: Memory = {
    async saveInbound(m) {
      if (opts.fail) throw new Error("db down");
      const old = seen.get(m.waMessageId);
      if (old) return { ...old, inserted: false, classified: classifications.has(old.messageId) };
      const r = { conversationId: `c-${m.waId}`, messageId: `m-${seen.size}`, inserted: true, classified: false };
      seen.set(m.waMessageId, r);
      saved.push(m);
      return r;
    },
    async getRecentMessages() {
      return [];
    },
    async saveClassification(messageId, result) {
      classifications.set(messageId, result);
    },
    async getPreviousParentMessage() {
      return opts.previous ?? null;
    },
    async claimMessage() { return true; },
    async updateDecision() {},
    async saveHandover() {},
    async saveOutbound() {},
    async countOutboundSince() { return 0; },
    async getMessageClassification() { return null; },
  };
  return { memory, saved, classifications };
}

const okClassify = (): Classify => vi.fn(async () => okClassification());

const post = (body: BodyInit | null, headers: Record<string, string> = { [SECRET_HEADER]: SECRET }) =>
  new Request("http://localhost/api/whatsapp", { method: "POST", body, headers });

const flatBody = (...texts: string[]) => ({
  messages: texts.map((t, i) => ({ from: "263770000002", id: `wamid.B${i}`, timestamp: "1794437000", type: "text", text: { body: t } })),
});

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(String(line)));
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/whatsapp", () => {
  it("refuses a missing or wrong secret and saves nothing", async () => {
    const { memory, saved } = fakeMemory();
    const classify = okClassify();
    const none = await handleWebhook(post(JSON.stringify(fixture), {}), { memory, secret: SECRET, classify });
    const wrong = await handleWebhook(post(JSON.stringify(fixture), { [SECRET_HEADER]: "nope" }), { memory, secret: SECRET, classify });
    expect(none.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(saved).toHaveLength(0);
    expect(classify).not.toHaveBeenCalled();
  });

  it("refuses everything when the secret is not configured", async () => {
    const { memory, saved } = fakeMemory();
    const res = await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: undefined, classify: okClassify() });
    expect(res.status).toBe(500);
    expect(saved).toHaveLength(0);
  });

  it("saves a good text message and answers 200", async () => {
    const { memory, saved } = fakeMemory();
    const res = await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET, classify: okClassify() });
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
    expect(saved[0].body).toBe("Hello");
  });

  it("saves the same message id only once", async () => {
    const { memory, saved } = fakeMemory();
    const classify = okClassify();
    await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET, classify });
    const again = await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET, classify });
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
    const res = await handleWebhook(req, { memory, secret: SECRET, classify: okClassify() });
    expect(res.status).toBe(413);
    expect(saved).toHaveLength(0);
  });

  it("answers 400 to a broken body and saves nothing", async () => {
    const { memory, saved } = fakeMemory();
    const notJson = await handleWebhook(post("{oops"), { memory, secret: SECRET, classify: okClassify() });
    const badShape = await handleWebhook(post(JSON.stringify([1, 2])), { memory, secret: SECRET, classify: okClassify() });
    expect(notJson.status).toBe(400);
    expect(badShape.status).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it("answers 500 when the database fails, and the log holds no message text or number", async () => {
    const { memory } = fakeMemory({ fail: true });
    const res = await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET, classify: okClassify() });
    expect(res.status).toBe(500);
    const all = logs.join("\n");
    expect(all).toContain("webhook_save_failed");
    expect(all).not.toContain("Hello");
    expect(all).not.toContain("263770000002");
  });

  it("logs counts only when a message is saved", async () => {
    const { memory } = fakeMemory();
    await handleWebhook(post(JSON.stringify(fixture)), { memory, secret: SECRET, classify: okClassify() });
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
    const res = await handleWebhook(post(JSON.stringify(bad)), { memory, secret: SECRET, classify: okClassify() });
    expect(res.status).toBe(400);
    expect(saved).toHaveLength(0);
  });
});

describe("POST /api/whatsapp classifies each message (F2)", () => {
  it("saves the label, confidence and latency on a new message", async () => {
    const { memory, classifications } = fakeMemory();
    const classify = okClassify();
    const res = await handleWebhook(post(JSON.stringify(flatBody("How much are Grade 3 fees?"))), { memory, secret: SECRET, classify });
    expect(res.status).toBe(200);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(classify).mock.calls[0][0]).toBe("How much are Grade 3 fees?");
    const stored = [...classifications.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ engine: "jev", label: "fees", labelConfidence: 0.92, latencyMs: 300 });
  });

  it("does not call Jev again for a duplicate that was already classified", async () => {
    const { memory } = fakeMemory();
    const classify = okClassify();
    await handleWebhook(post(JSON.stringify(flatBody("Hi"))), { memory, secret: SECRET, classify });
    await handleWebhook(post(JSON.stringify(flatBody("Hi"))), { memory, secret: SECRET, classify });
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("classifies a duplicate on the retry when the first attempt was cut off (no engine yet)", async () => {
    const { memory, classifications } = fakeMemory();
    const never: Classify = () => new Promise(() => {});
    const first = await handleWebhook(post(JSON.stringify(flatBody("Hi"))), { memory, secret: SECRET, classify: never, classifyCapMs: 20 });
    expect(first.status).toBe(500); // saved, but not classified: 360dialog will retry
    expect(classifications.size).toBe(0);
    const classify = okClassify();
    const retry = await handleWebhook(post(JSON.stringify(flatBody("Hi"))), { memory, secret: SECRET, classify });
    expect(retry.status).toBe(200);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classifications.size).toBe(1);
  });

  it("classifies a batch of three messages in parallel", async () => {
    const { memory, classifications } = fakeMemory();
    const slow: Classify = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 120));
      return okClassification();
    });
    const started = Date.now();
    const res = await handleWebhook(post(JSON.stringify(flatBody("one", "two", "three"))), { memory, secret: SECRET, classify: slow });
    const took = Date.now() - started;
    expect(res.status).toBe(200);
    expect(slow).toHaveBeenCalledTimes(3);
    expect(classifications.size).toBe(3);
    expect(took).toBeLessThan(330); // three in a row would take 360 ms or more
  });

  it("still answers 200 with the message saved when Jev fails", async () => {
    const { memory, saved, classifications } = fakeMemory();
    const failed: Classify = async () => ({
      engine: "error", language: null, languageConfidence: null, label: null, labelConfidence: null,
      latencyMs: 2000, inputTokens: null, costUsd: null, error: "TimeoutError",
    });
    const res = await handleWebhook(post(JSON.stringify(flatBody("How much?"))), { memory, secret: SECRET, classify: failed });
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
    expect([...classifications.values()][0]).toMatchObject({ engine: "error", label: null });
  });

  it("gives Jev the parent's previous message, and none for a first message", async () => {
    const withPrev = fakeMemory({ previous: "How much is Grade 3?" });
    const c1 = okClassify();
    await handleWebhook(post(JSON.stringify(flatBody("And Form 1?"))), { memory: withPrev.memory, secret: SECRET, classify: c1 });
    expect(vi.mocked(c1).mock.calls[0][1]).toEqual({ earlierMessage: "How much is Grade 3?" });

    const first = fakeMemory({ previous: null });
    const c2 = okClassify();
    await handleWebhook(post(JSON.stringify(flatBody("Hello"))), { memory: first.memory, secret: SECRET, classify: c2 });
    expect(vi.mocked(c2).mock.calls[0][1]).toEqual({ earlierMessage: null });
  });

  it("logs the label, confidence and time, never the message text or number", async () => {
    const { memory } = fakeMemory();
    await handleWebhook(post(JSON.stringify(flatBody("How much are Grade 3 fees?"))), { memory, secret: SECRET, classify: okClassify() });
    const all = logs.join("\n");
    expect(all).toContain("message_classified");
    expect(all).toContain("fees");
    expect(all).not.toContain("Grade 3");
    expect(all).not.toContain("263770000002");
  });
});

describe("POST /api/whatsapp starts the agent after answering (F7)", () => {
  it("schedules the agent for every saved message, including a duplicate (the agent claims each one)", async () => {
    const { memory } = fakeMemory();
    const agent = vi.fn(async () => {});
    const scheduled: (() => Promise<void>)[] = [];
    const deps = { memory, secret: SECRET, classify: okClassify(), agent, schedule: (fn: () => Promise<void>) => void scheduled.push(fn) };
    await handleWebhook(post(JSON.stringify(flatBody("one", "two"))), deps);
    await handleWebhook(post(JSON.stringify(flatBody("one", "two"))), deps);
    expect(scheduled).toHaveLength(2);
    expect(agent).not.toHaveBeenCalled(); // nothing runs until after the response
    await scheduled[0]();
    const items = (agent.mock.calls[0] as unknown[])[0] as { body: string; waId: string }[];
    expect(items.map((i) => i.body)).toEqual(["one", "two"]);
    expect(items[0].waId).toBe("263770000002");
  });

  it("does not start the agent when the secret is wrong or the body is broken", async () => {
    const { memory } = fakeMemory();
    const scheduled: unknown[] = [];
    const deps = { memory, secret: SECRET, classify: okClassify(), agent: async () => {}, schedule: (fn: unknown) => void scheduled.push(fn) };
    await handleWebhook(post(JSON.stringify(flatBody("hi")), {}), deps);
    await handleWebhook(post("{oops"), deps);
    expect(scheduled).toHaveLength(0);
  });

  it("still answers 200 when the agent later fails", async () => {
    const { memory } = fakeMemory();
    const res = await handleWebhook(post(JSON.stringify(flatBody("hi"))), {
      memory, secret: SECRET, classify: okClassify(), agent: async () => { throw new Error("boom"); }, schedule: (fn) => void fn().catch(() => {}),
    });
    expect(res.status).toBe(200);
  });
});
