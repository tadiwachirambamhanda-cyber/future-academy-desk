import { getDb } from "@/lib/db";
import { createMemory } from "@/lib/memory";
import { classifyMessage } from "@/lib/jev";
import { handleWebhook } from "@/lib/webhook";

export async function POST(request: Request) {
  return handleWebhook(request, {
    // Read at request time so the build passes with no environment variables.
    get memory() {
      return createMemory(getDb());
    },
    secret: process.env.D360_WEBHOOK_SECRET,
    classify: classifyMessage,
  });
}
