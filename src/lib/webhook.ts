import { createHash, timingSafeEqual } from "node:crypto";
import type { Memory, SaveResult } from "./memory";
import type { Classification, ClassifyOptions } from "./jev";
import type { AgentItem } from "./agent";
import type { InboundMessage } from "./memory";
import { parseWebhook, WebhookParseError } from "./whatsapp";

export const MAX_BODY_BYTES = 64 * 1024;
export const SECRET_HEADER = "x-webhook-secret";
export const CLASSIFY_CAP_MS = 4000; // the whole classification step, for all messages in one request

export type Classify = (text: string, options?: ClassifyOptions) => Promise<Classification>;

type Deps = {
  memory: Memory;
  secret: string | undefined;
  classify: Classify;
  classifyCapMs?: number;
  // F7: after the 200 is sent, the agent answers every saved message (it claims each one, so a
  // duplicate delivery never gets a second reply). Absent in tests that do not need it.
  agent?: (items: AgentItem[]) => Promise<void>;
  schedule?: (work: () => Promise<void>) => void;
};

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Reads the body while counting bytes, and stops at the limit.
async function readLimited(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// Logs hold counts, ids and timings only: never message text or phone numbers.
function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...fields }));
}

const TIMED_OUT = Symbol("timed out");

export async function handleWebhook(request: Request, { memory, secret, classify, classifyCapMs = CLASSIFY_CAP_MS, agent, schedule }: Deps): Promise<Response> {
  if (!secret) {
    log("webhook_not_configured", {});
    return json(500, { ok: false });
  }
  if (!sameSecret(request.headers.get(SECRET_HEADER), secret)) {
    log("webhook_refused", { reason: "bad_secret" });
    return json(401, { ok: false });
  }

  const text = await readLimited(request);
  if (text === null) {
    log("webhook_refused", { reason: "too_large" });
    return json(413, { ok: false });
  }

  let parsed;
  try {
    parsed = parseWebhook(JSON.parse(text));
  } catch (err) {
    log("webhook_refused", { reason: err instanceof WebhookParseError ? "bad_shape" : "bad_json" });
    return json(400, { ok: false });
  }

  const started = Date.now();

  // 1. Save every message first, so a crash later never loses the parent's words.
  const saved: { message: InboundMessage; result: SaveResult }[] = [];
  let duplicates = 0;
  try {
    for (const message of parsed.messages) {
      const result = await memory.saveInbound(message);
      saved.push({ message, result });
      if (!result.inserted) duplicates += 1;
    }
  } catch {
    // A 500 makes 360dialog retry. The retry is safe: a message id already saved is ignored.
    log("webhook_save_failed", { saved: saved.length, duplicates, ms: Date.now() - started });
    return json(500, { ok: false });
  }

  // 2. Classify, in parallel. A new message is classified; so is a duplicate whose first
  // attempt was cut off (no engine yet). Jev never throws: a failure is stored as engine "error".
  const todo = saved.filter(({ result }) => result.inserted || !result.classified);
  const work = Promise.all(
    todo.map(async ({ message, result }) => {
      const earlier = await memory.getPreviousParentMessage(result.conversationId, result.messageId, message.sentAt);
      const classification = await classify(message.body, { earlierMessage: earlier });
      await memory.saveClassification(result.messageId, classification);
      log("message_classified", {
        engine: classification.engine,
        label: classification.label,
        label_confidence: classification.labelConfidence,
        language: classification.language,
        language_confidence: classification.languageConfidence,
        ms: classification.latencyMs,
        error: classification.error,
      });
    }),
  );
  work.catch(() => {}); // the outcome is read below; this stops a late failure becoming unhandled

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), classifyCapMs);
      }),
    ]);
    if (outcome === TIMED_OUT) throw new Error("classification took too long");
  } catch {
    // The messages are saved. A 500 makes 360dialog retry, and the retry classifies the rows that have no engine yet.
    log("webhook_classify_failed", { saved: saved.length, ms: Date.now() - started });
    return json(500, { ok: false });
  } finally {
    clearTimeout(timer);
  }

  if (agent && schedule && saved.length > 0) {
    const items: AgentItem[] = saved.map(({ message, result }) => ({
      conversationId: result.conversationId, messageId: result.messageId, waId: message.waId, body: message.body, sentAt: message.sentAt,
    }));
    schedule(() => agent(items));
  }

  log("webhook_received", {
    saved: saved.length - duplicates,
    duplicates,
    classified: todo.length,
    ignored: parsed.ignored,
    ms: Date.now() - started,
  });
  return json(200, { ok: true });
}
