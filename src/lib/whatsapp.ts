import { z } from "zod";
import type { InboundMessage } from "./memory";

export class WebhookParseError extends Error {}

const textMessage = z.object({
  from: z.string().min(1),
  id: z.string().min(1),
  timestamp: z.union([z.string().regex(/^\d+$/), z.number().nonnegative()]),
  type: z.literal("text"),
  text: z.object({ body: z.string() }),
});

const anyMessage = z.object({ type: z.string() }).passthrough();

const container = z
  .object({
    messages: z.array(z.unknown()).optional(),
    entry: z
      .array(
        z
          .object({
            changes: z
              .array(z.object({ value: z.object({ messages: z.array(z.unknown()).optional() }).passthrough() }).passthrough())
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export type ParsedWebhook = {
  messages: InboundMessage[];
  ignored: number; // images, voice notes and other non-text messages
};

// Accepts both 360dialog shapes: the Cloud API shape (entry / changes / value)
// and the older flat shape ({ messages: [...] }). A body with only delivery
// receipts parses to zero messages. Message text is returned as data only.
export function parseWebhook(body: unknown): ParsedWebhook {
  const top = container.safeParse(body);
  if (!top.success) throw new WebhookParseError("body is not a webhook object");

  const raw: unknown[] = [
    ...(top.data.messages ?? []),
    ...(top.data.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value.messages ?? [])),
  ];

  const messages: InboundMessage[] = [];
  let ignored = 0;
  for (const item of raw) {
    if (!anyMessage.safeParse(item).success) throw new WebhookParseError("message has no type");
    const text = textMessage.safeParse(item);
    if (!text.success) {
      if ((item as { type: string }).type === "text") throw new WebhookParseError("text message is malformed");
      ignored += 1;
      continue;
    }
    const sentAt = new Date(Number(text.data.timestamp) * 1000);
    if (Number.isNaN(sentAt.getTime())) throw new WebhookParseError("message timestamp is not a valid date");
    messages.push({
      waId: text.data.from,
      waMessageId: text.data.id,
      body: text.data.text.body,
      sentAt,
    });
  }
  return { messages, ignored };
}
