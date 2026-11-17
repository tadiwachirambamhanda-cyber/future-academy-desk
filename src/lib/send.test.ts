import { describe, it, expect, vi, afterEach } from "vitest";
import { createSender, SANDBOX_SEND_URL } from "./send";

afterEach(() => vi.unstubAllEnvs());
const ALLOWED = "263770000002";
const okFetch = () => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.OUT1" }] }), { status: 200 }));

describe("F7: sending", () => {
  it("only ever posts to the 360dialog sandbox address", async () => {
    vi.stubEnv("D360_API_KEY", "k");
    const f = okFetch();
    await createSender({ fetchImpl: f as unknown as typeof fetch, allowedRecipients: ALLOWED })("263770000002", "Hello");
    expect(f.mock.calls[0][0]).toBe(SANDBOX_SEND_URL);
    expect(new URL(SANDBOX_SEND_URL).host).toBe("waba-sandbox.360dialog.io");
  });
  it("sends the text to the number and returns the WhatsApp id", async () => {
    vi.stubEnv("D360_API_KEY", "k");
    const f = okFetch();
    const r = await createSender({ fetchImpl: f as unknown as typeof fetch, allowedRecipients: ALLOWED })("263770000002", "Hello");
    expect(r).toEqual({ ok: true, waMessageId: "wamid.OUT1" });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "263770000002", type: "text", text: { body: "Hello" } });
  });
  it("refuses a recipient that is not just digits", async () => {
    vi.stubEnv("D360_API_KEY", "k");
    const f = okFetch();
    for (const to of ["", "abc", "+26377", "2637700 00002", "263770000002/../x"]) {
      expect(await createSender({ fetchImpl: f as unknown as typeof fetch, allowedRecipients: ALLOWED })(to, "hi")).toEqual({ ok: false, error: "bad_recipient" });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("refuses a recipient that is not on the allow-list when one is set", async () => {
    vi.stubEnv("D360_API_KEY", "k");
    const f = okFetch();
    const send = createSender({ fetchImpl: f as unknown as typeof fetch, allowedRecipients: "263770000002, 263770000003" });
    expect(await send("263770000009", "hi")).toEqual({ ok: false, error: "recipient_not_allowed" });
    expect((await send("263770000003", "hi")).ok).toBe(true);
  });
  it("sends nothing at all when no allow-list is configured (codex #3)", async () => {
    vi.stubEnv("D360_API_KEY", "k");
    vi.stubEnv("D360_ALLOWED_RECIPIENTS", "");
    const f = okFetch();
    expect(await createSender({ fetchImpl: f as unknown as typeof fetch })("263770000002", "hi")).toEqual({ ok: false, error: "no_allowlist" });
    expect(f).not.toHaveBeenCalled();
  });
  it("accepts the allow-list written like a phone number, with a plus and spaces", async () => {
    vi.stubEnv("D360_API_KEY", "k");
    const f = okFetch();
    const send = createSender({ fetchImpl: f as unknown as typeof fetch, allowedRecipients: "+263 77 000 0002, +263 77 000 0003" });
    expect((await send("263770000002", "hi")).ok).toBe(true);
    expect((await send("263770000003", "hi")).ok).toBe(true);
    expect(await send("263770000009", "hi")).toEqual({ ok: false, error: "recipient_not_allowed" });
  });
  it("reads the allow-list from D360_ALLOWED_RECIPIENTS", async () => {
    vi.stubEnv("D360_API_KEY", "k");
    vi.stubEnv("D360_ALLOWED_RECIPIENTS", "263770000002");
    const f = okFetch();
    expect((await createSender({ fetchImpl: f as unknown as typeof fetch })("263770000002", "hi")).ok).toBe(true);
    expect(await createSender({ fetchImpl: f as unknown as typeof fetch })("263770000009", "hi")).toEqual({ ok: false, error: "recipient_not_allowed" });
  });
  it("keeps a short, number-free reason from 360dialog when a send is refused", async () => {
    vi.stubEnv("D360_API_KEY", "k");
    const refused = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: { message: "Recipient 263770000002 is not in the allowed list for this sandbox" } }), { status: 403 }));
    const r = await createSender({ fetchImpl: refused as unknown as typeof fetch, allowedRecipients: ALLOWED })("263770000002", "hi");
    expect(r).toEqual({ ok: false, error: "http_403: Recipient [number] is not in the allowed list for this sandbox" });
  });
  it("fails safely with no key, empty text, an HTTP error or a network error", async () => {
    const f = okFetch();
    expect(await createSender({ fetchImpl: f as unknown as typeof fetch, allowedRecipients: ALLOWED })("263770000002", "hi")).toEqual({ ok: false, error: "not_configured" });
    vi.stubEnv("D360_API_KEY", "k");
    expect(await createSender({ fetchImpl: f as unknown as typeof fetch, allowedRecipients: ALLOWED })("263770000002", "  ")).toEqual({ ok: false, error: "empty_text" });
    const bad = vi.fn<typeof fetch>(async () => new Response("no", { status: 401 }));
    expect(await createSender({ fetchImpl: bad as unknown as typeof fetch, allowedRecipients: ALLOWED })("263770000002", "hi")).toEqual({ ok: false, error: "http_401" });
    const boom = vi.fn<typeof fetch>(async () => { throw new TypeError("network"); });
    expect(await createSender({ fetchImpl: boom as unknown as typeof fetch, allowedRecipients: ALLOWED })("263770000002", "hi")).toEqual({ ok: false, error: "TypeError" });
  });
});
