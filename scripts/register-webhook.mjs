// Tells the 360dialog sandbox where to send incoming WhatsApp messages.
// Run: node --env-file=.env.local scripts/register-webhook.mjs
// Reads D360_API_KEY and D360_WEBHOOK_SECRET from the environment and never prints them.
const apiKey = process.env.D360_API_KEY;
const secret = process.env.D360_WEBHOOK_SECRET;
const url = process.argv[2] ?? "https://future-academy-desk.vercel.app/api/whatsapp";

if (!apiKey || !secret) {
  console.error("D360_API_KEY and D360_WEBHOOK_SECRET must be set in .env.local");
  process.exit(1);
}

const redact = (text) => text.split(apiKey).join("[key]").split(secret).join("[secret]");

const res = await fetch("https://waba-sandbox.360dialog.io/v1/configs/webhook", {
  method: "POST",
  headers: { "D360-API-KEY": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({ url, headers: { "x-webhook-secret": secret } }),
});
console.log("status:", res.status);
console.log(redact(await res.text()).slice(0, 500));
