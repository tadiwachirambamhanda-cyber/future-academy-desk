import { createHash, timingSafeEqual } from "node:crypto";
import type { Memory } from "./memory";
import { parseWebhook, WebhookParseError } from "./whatsapp";

export const MAX_BODY_BYTES = 64 * 1024;
export const SECRET_HEADER = "x-webhook-secret";

type Deps = { memory: Memory; secret: string | undefined };

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

export async function handleWebhook(request: Request, { memory, secret }: Deps): Promise<Response> {
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
  let saved = 0;
  let duplicates = 0;
  try {
    for (const message of parsed.messages) {
      const result = await memory.saveInbound(message);
      if (result.inserted) saved += 1;
      else duplicates += 1;
    }
  } catch {
    // A 500 makes 360dialog retry. The retry is safe: a message id already saved is ignored.
    log("webhook_save_failed", { saved, duplicates, ms: Date.now() - started });
    return json(500, { ok: false });
  }

  log("webhook_received", { saved, duplicates, ignored: parsed.ignored, ms: Date.now() - started });
  return json(200, { ok: true });
}
