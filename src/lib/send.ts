// F7: the only code that sends a WhatsApp message. It can only reach the 360dialog SANDBOX:
// the address is fixed here, never taken from a message or from the model.
export const SANDBOX_SEND_URL = "https://waba-sandbox.360dialog.io/v1/messages";
export const SEND_TIMEOUT_MS = 8000;

export type SendResult = { ok: true; waMessageId: string | null } | { ok: false; error: string };
export type Send = (to: string, text: string) => Promise<SendResult>;

type Options = {
  fetchImpl?: typeof fetch;
  // Optional extra guard: comma-separated numbers (D360_ALLOWED_RECIPIENTS). If set, only these.
  allowedRecipients?: string | undefined;
};

export function createSender(options: Options = {}): Send {
  return async (to, text) => {
    // Numbers only: this keeps a message from steering the request.
    if (!/^\d{6,15}$/.test(to)) return { ok: false, error: "bad_recipient" };
    const allowed = (options.allowedRecipients ?? process.env.D360_ALLOWED_RECIPIENTS ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(to)) return { ok: false, error: "recipient_not_allowed" };

    const apiKey = process.env.D360_API_KEY; // read now, never at import time
    if (!apiKey) return { ok: false, error: "not_configured" };
    if (text.trim() === "") return { ok: false, error: "empty_text" };

    try {
      const res = await (options.fetchImpl ?? fetch)(SANDBOX_SEND_URL, {
        method: "POST",
        headers: { "D360-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_type: "individual", to, type: "text", text: { body: text } }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, error: `http_${res.status}` };
      const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
      return { ok: true, waMessageId: body?.messages?.[0]?.id ?? null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.name : "unknown" };
    }
  };
}
