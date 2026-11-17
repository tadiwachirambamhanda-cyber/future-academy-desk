// Runs the agent end to end, three times per case: the real Jev and the real Claude, with a
// pretend database and a pretend sender (nothing is sent to anyone).
// Run: npm run cases:agent   (needs TYPESAFE_API_KEY and ANTHROPIC_API_KEY in .env.local; costs about a cent; not part of CI)
// Cases that need Claude are skipped, and reported as skipped, when ANTHROPIC_API_KEY is missing.
import { readFileSync, writeFileSync } from "node:fs";
import { runAgent } from "../src/lib/agent";
import { classifyMessage } from "../src/lib/jev";
import { fakeMemory } from "../src/lib/test-support/fake-memory";

type Case = {
  id: string; ac: string; title: string; body: string;
  history?: { direction: "in" | "out"; body: string }[];
  expect: { status: string; reason?: string; sent: boolean; mustInclude?: string[]; mustNotInclude?: string[]; language?: string };
};

const REPEATS = 3;
const { cases } = JSON.parse(readFileSync("cases/agent-cases.json", "utf8")) as { cases: Case[] };
const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);
const needsClaude = (c: Case) => c.expect.status === "answered" || c.id === "A06" || c.id === "A10";

if (!process.env.TYPESAFE_API_KEY) {
  console.error("TYPESAFE_API_KEY is not set. Add it to .env.local.");
  process.exit(1);
}

type Outcome = { pass: boolean; problems: string[]; reply: string | null; costUsd: number; ms: number };

async function runOnce(c: Case): Promise<Outcome> {
  const { memory, state } = fakeMemory();
  const waId = "263770000099"; // made up
  const t0 = Date.parse("2026-11-12T10:00:00Z");
  let i = 0;
  for (const h of c.history ?? []) {
    const at = new Date(t0 + i++ * 1000);
    if (h.direction === "in") await memory.saveInbound({ waId, waMessageId: `h-${i}`, body: h.body, sentAt: at });
    else await memory.saveOutbound({ conversationId: `c-${waId}`, waMessageId: null, body: h.body, sentAt: at });
  }
  const sentAt = new Date(t0 + 60_000);
  const saved = await memory.saveInbound({ waId, waMessageId: "now", body: c.body, sentAt });
  const earlier = (c.history ?? []).filter((h) => h.direction === "in").at(-1)?.body ?? null;
  const cls = await classifyMessage(c.body, { earlierMessage: earlier });
  await memory.saveClassification(saved.messageId, cls);

  const sent: string[] = [];
  const started = Date.now();
  await runAgent(
    { conversationId: saved.conversationId, messageId: saved.messageId, waId, body: c.body, sentAt },
    { memory, send: async (_to, text) => { sent.push(text); return { ok: true, waMessageId: null }; } },
  );
  const ms = Date.now() - started;

  const d = state.decisions.get(saved.messageId);
  const reply = sent[0] ?? null;
  const e = c.expect;
  const problems: string[] = [];
  if (d?.status !== e.status) problems.push(`status ${d?.status} (expected ${e.status})`);
  if (e.reason && d?.reason !== e.reason) problems.push(`reason ${d?.reason} (expected ${e.reason})`);
  if (e.sent !== (reply !== null)) problems.push(`sent ${reply !== null} (expected ${e.sent})`);
  for (const w of e.mustInclude ?? []) if (!reply?.includes(w)) problems.push(`reply lacks "${w}"`);
  for (const w of e.mustNotInclude ?? []) if (reply?.toLowerCase().includes(w.toLowerCase())) problems.push(`reply has "${w}"`);
  if (e.language && d?.language !== e.language) problems.push(`language ${d?.language} (expected ${e.language})`);
  const costUsd = (d?.costUsd ?? 0) + (cls.costUsd ?? 0);
  return { pass: problems.length === 0, problems, reply, costUsd, ms };
}

const results: { c: Case; runs: Outcome[]; skipped: boolean }[] = [];
for (const c of cases) {
  if (needsClaude(c) && !hasClaude) { results.push({ c, runs: [], skipped: true }); continue; }
  const runs: Outcome[] = [];
  for (let r = 0; r < REPEATS; r++) runs.push(await runOnce(c));
  results.push({ c, runs, skipped: false });
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const lines = ["# F3 to F7 end-to-end cases", "", `Run: ${new Date().toISOString()}. Repeats per case: ${REPEATS}. Claude available: ${hasClaude ? "yes" : "NO (answer cases skipped)"}.`, "",
  "| Case | AC | What | Result | Avg cost USD | Avg ms | Problems |", "|---|---|---|---|---|---|---|"];
for (const { c, runs, skipped } of results) {
  if (skipped) { lines.push(`| ${c.id} | ${c.ac} | ${c.title} | SKIPPED (no ANTHROPIC_API_KEY) | - | - | - |`); continue; }
  const pass = runs.filter((r) => r.pass).length;
  const problems = [...new Set(runs.flatMap((r) => r.problems))].join("; ") || "-";
  lines.push(`| ${c.id} | ${c.ac} | ${c.title} | ${pass}/${runs.length} | ${avg(runs.map((r) => r.costUsd)).toFixed(6)} | ${Math.round(avg(runs.map((r) => r.ms)))} | ${problems} |`);
}
lines.push("", "## Sample replies (made-up conversations)", "");
for (const { c, runs } of results) if (runs[0]?.reply) lines.push(`- **${c.id}** (${c.body}): ${runs[0].reply.replace(/\n/g, " / ")}`);
writeFileSync("cases/agent-report.md", lines.join("\n") + "\n");
console.log(lines.join("\n"));

const ran = results.filter((r) => !r.skipped);
const failed = ran.some((r) => r.runs.some((x) => !x.pass));
console.log(failed ? "\nFAIL: a case did not pass on every repeat." : `\nPASS: ${ran.length} case(s) passed on every repeat${hasClaude ? "" : " (the Claude cases were skipped)"}.`);
process.exit(failed ? 1 : 0);
