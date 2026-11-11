// F7: for one saved message, decide, write, check, send or hand over, and log every step.
import { readWithClaude } from "./reader";
import { holdingReply, officePhone } from "./handover";
import { decide, expectedLanguage, type HandoverReason } from "./rules";
import type { Memory, StoredMessage } from "./memory";
import type { Classification } from "./jev";
import type { Send } from "./send";
import { writeReply, type WriteInput, type WriteResult } from "./writer";

export const REPLY_CAP = 20; // replies (holding replies included) per conversation per 24 hours
export const CAP_WINDOW_HOURS = 24;

export type AgentItem = { conversationId: string; messageId: string; waId: string; body: string; sentAt: Date };

export type AgentDeps = {
  memory: Memory;
  send: Send;
  read?: typeof readWithClaude;
  write?: (input: WriteInput) => Promise<WriteResult>;
  phone?: string;
  now?: () => Date;
};

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...fields }));
}

// Never throws: a crash here must not take the webhook down. Every outcome is in the decision row.
export async function runAgent(item: AgentItem, deps: AgentDeps): Promise<void> {
  const { memory, send } = deps;
  const now = deps.now ?? (() => new Date());
  const read = deps.read ?? readWithClaude;
  const write = deps.write ?? writeReply;
  const started = Date.now();

  try {
    // 1. Claim the message. Only one run answers it, however many times it is delivered.
    if (!(await memory.claimMessage(item.conversationId, item.messageId))) {
      log("agent_skipped", { reason: "already_claimed" });
      return;
    }

    // 2. Understand. Jev already ran in the webhook. If it left no label, Claude reads the message.
    const stored = await memory.getMessageClassification(item.messageId);
    let cls: Classification = {
      engine: stored?.engine ?? "error", language: stored?.language ?? null, languageConfidence: null,
      label: stored?.label ?? null, labelConfidence: stored?.labelConfidence ?? null,
      latencyMs: 0, inputTokens: null, costUsd: null, error: stored ? null : "no_classification",
    };
    if (cls.label === null && item.body.trim() !== "") {
      const earlier = await memory.getPreviousParentMessage(item.conversationId, item.messageId, item.sentAt);
      cls = await read(item.body, { earlierMessage: earlier });
      await memory.saveClassification(item.messageId, cls);
    }
    const readerCost = cls.engine === "claude" && stored?.engine !== "claude" ? (cls.costUsd ?? 0) : 0;
    const language = expectedLanguage(cls.language);

    // 3. Reply cap: a loop must not run up cost.
    const since = new Date(now().getTime() - CAP_WINDOW_HOURS * 3_600_000);
    if ((await memory.countOutboundSince(item.conversationId, since)) >= REPLY_CAP) {
      await memory.saveHandover({ conversationId: item.conversationId, messageId: item.messageId, reason: "cap_reached" });
      await memory.updateDecision(item.messageId, { status: "needs_person", reason: "cap_reached", language, label: cls.label, labelConfidence: cls.labelConfidence });
      log("agent_handover", { reason: "cap_reached" });
      return;
    }

    // 4. Decide, in code.
    const decision = decide({
      engine: cls.engine, label: cls.label, labelConfidence: cls.labelConfidence, language: cls.language,
      text: item.body, moneyException: cls.moneyException,
    });
    const base = { language, label: cls.label, labelConfidence: cls.labelConfidence };

    if (decision.action === "no_reply") {
      await memory.updateDecision(item.messageId, { ...base, status: "no_reply", reason: decision.reason });
      log("agent_no_reply", { reason: decision.reason });
      return;
    }

    // 5. Write and check the reply, or hand over.
    let handoverReason: HandoverReason | null = decision.action === "handover" ? decision.reason : null;
    let replyText: string | null = null;
    let patch: Parameters<Memory["updateDecision"]>[1] = { costUsd: readerCost };

    if (decision.action === "answer") {
      const recent: StoredMessage[] = (await memory.getRecentMessages(item.conversationId, 11)).filter((m) => m.id !== item.messageId);
      const written = await write({ parentMessage: item.body, label: cls.label ?? decision.topic, language, history: recent.slice(-10) });
      patch = {
        model: written.usage.model, inputTokens: written.usage.inputTokens, outputTokens: written.usage.outputTokens,
        costUsd: written.usage.costUsd + readerCost, latencyMs: written.usage.latencyMs,
        fixAttempted: written.fixAttempted, checks: written.checks ? { ran: written.checks.ran, failures: written.checks.failures } : null,
      };
      if (written.ok) replyText = written.reply;
      else handoverReason = written.reason;
    }

    // 6. Record the decision BEFORE anything is sent.
    if (replyText !== null) {
      await memory.updateDecision(item.messageId, { ...base, ...patch, status: "answered", reason: decision.action === "answer" ? decision.topic : null });
    } else {
      const reason = handoverReason ?? "check_failed";
      await memory.saveHandover({ conversationId: item.conversationId, messageId: item.messageId, reason });
      await memory.updateDecision(item.messageId, { ...base, ...patch, status: "needs_person", reason });
      replyText = holdingReply(reason, language, deps.phone ?? officePhone());
      log("agent_handover", { reason });
    }

    // 7. Send, then save what was sent.
    const sent = await send(item.waId, replyText);
    if (sent.ok) {
      await memory.saveOutbound({ conversationId: item.conversationId, waMessageId: sent.waMessageId, body: replyText, sentAt: now() });
      await memory.updateDecision(item.messageId, { sent: true });
    } else {
      // Nobody got the reply: make it visible to a person.
      await memory.updateDecision(item.messageId, { sent: false, sendError: sent.error });
      await memory.saveHandover({ conversationId: item.conversationId, messageId: item.messageId, reason: "send_failed" });
      log("agent_send_failed", { error: sent.error });
    }
    log("agent_done", { ms: Date.now() - started, sent: sent.ok });
  } catch (err) {
    // A crash leaves the claim in place, with no reply. The decision row shows it is unfinished.
    log("agent_crashed", { error: err instanceof Error ? err.name : "unknown", ms: Date.now() - started });
  }
}
