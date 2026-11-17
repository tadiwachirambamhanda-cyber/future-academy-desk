import { after } from "next/server";
import { runAgent, type AgentItem } from "@/lib/agent";
import { getDb } from "@/lib/db";
import { classifyMessage } from "@/lib/jev";
import { createMemory } from "@/lib/memory";
import { createSender } from "@/lib/send";
import { handleWebhook } from "@/lib/webhook";

// The agent runs after the 200 is sent: two Claude calls and a send can take a while.
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleWebhook(request, {
    // Read at request time so the build passes with no environment variables.
    get memory() {
      return createMemory(getDb());
    },
    secret: process.env.D360_WEBHOOK_SECRET,
    classify: classifyMessage,
    schedule: (work) => after(work),
    agent: async (items: AgentItem[]) => {
      const memory = createMemory(getDb());
      const send = createSender();
      await Promise.all(items.map((item) => runAgent(item, { memory, send })));
    },
  });
}
