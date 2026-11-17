// F7: the only code that sends a WhatsApp message. It can only reach the 360dialog SANDBOX:
// the address is fixed here, never taken from a message or from the model.
export const SANDBOX_SEND_URL = "https://waba-sandbox.360dialog.io/v1/messages";
export const SEND_TIMEOUT_MS = 8000;

export type SendResult = { ok: true; waMessageId: string | null } | { ok: false; error: string };
export type Send = (to: string, text: string) => Promise<SendResult>;

type Options = {
  fetchImpl?: typeof fetch;
  // Comma-separated numbers (D360_ALLOWED_RECIPIENTS). Required: with no list, nothing is sent.
  allowedRecipients?: string | undefined;
};

// A short reason from 360dialog's error body, so a failed send can be understood from the decision log.
// Phone numbers and long ids are redacted, and it is cut short.
async function providerReason(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    let text = raw;
    try {
      const body = JSON.parse(raw) as { error?: { message?: string; error_data?: { details?: string } }; errors?: { title?: string; details?: string }[]; meta?: { developer_message?: string } };
      text = body.error?.error_data?.details ?? body.error?.message ?? body.errors?.[0]?.details ?? body.errors?.[0]?.title ?? body.meta?.developer_message ?? raw;
    } catch {
      // not JSON: keep the plain text
    }
    const key = process.env.D360_API_KEY;
    if (key) text = text.split(key).join("[key]");
    const clean = `${res.statusText} ${text}`.replace(/\d{6,}/g, "[number]").replace(/\s+/g, " ").trim().slice(0, 200);
    return clean ? `: ${clean}` : "";
  } catch {
    return "";
  }
}

export function createSender(options: Options = {}): Send {
  return async (to, text) => {
    // Numbers only: this keeps a message from steering the request.
    if (!/^\d{6,15}$/.test(to)) return { ok: false, error: "bad_recipient" };
    const allowed = (options.allowedRecipients ?? process.env.D360_ALLOWED_RECIPIENTS ?? "")
      .split(",")
      .map((n) => n.replace(/\D/g, "")) // "+971 54 ..." and "97154..." are the same number
      .filter(Boolean);
    if (allowed.length === 0) return { ok: false, error: "no_allowlist" };
    if (!allowed.includes(to)) return { ok: false, error: "recipient_not_allowed" };

    const apiKey = process.env.D360_API_KEY; // read now, never at import time
    if (!apiKey) return { ok: false, error: "not_configured" };
    if (text.trim() === "") return { ok: false, error: "empty_text" };

    try {
      const res = await (options.fetchImpl ?? fetch)(SANDBOX_SEND_URL, {
        method: "POST",
        headers: { "D360-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, error: `http_${res.status}${await providerReason(res)}` };
      const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
      return { ok: true, waMessageId: body?.messages?.[0]?.id ?? null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.name : "unknown" };
    }
  };
}
