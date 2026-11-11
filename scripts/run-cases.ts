// Runs the F2 test cases against the real Jev, three times each, and writes cases/report.md.
// Run: npm run cases   (needs TYPESAFE_API_KEY in .env.local; costs a fraction of a cent; not part of CI)
import { readFileSync, writeFileSync } from "node:fs";
import { classifyMessage, JEV_MIN_CONFIDENCE, JEV_MODEL, type Classification } from "../src/lib/jev";

type Case = {
  id: string;
  title: string;
  set: "tune" | "heldout";
  body: string;
  earlier?: string;
  ac?: string;
  expect: { route: "english"; label: string } | { route: "non_english" };
};

const REPEATS = 3;
const CONCURRENCY = 4;

if (!process.env.TYPESAFE_API_KEY) {
  console.error("TYPESAFE_API_KEY is not set. Add it to .env.local and run: npm run cases");
  process.exit(1);
}

const { cases } = JSON.parse(readFileSync("cases/f2-jev-cases.json", "utf8")) as { cases: Case[] };

type Run = { c: Case; result: Classification; pass: boolean; got: string };

function judge(c: Case, r: Classification): { pass: boolean; got: string } {
  if (r.engine === "error") return { pass: false, got: `error:${r.error}` };
  const got = r.label ?? "(non-English path)";
  if (c.expect.route === "english") return { pass: r.label === c.expect.label, got };
  return { pass: r.label === null, got };
}

async function runAll(): Promise<Run[]> {
  const jobs = cases.flatMap((c) => Array.from({ length: REPEATS }, () => c));
  const out: Run[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = next++;
        if (i >= jobs.length) return;
        const c = jobs[i];
        const result = await classifyMessage(c.body, { earlierMessage: c.earlier ?? null });
        out.push({ c, result, ...judge(c, result) });
      }
    }),
  );
  return out;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const runs = await runAll();
const byCase = (c: Case) => runs.filter((r) => r.c.id === c.id);

// Rates, per set and overall. English: correct label / wrongly sent to the non-English path.
// Non-English: wrongly given an English label (false accept).
function rates(set: "tune" | "heldout" | "all") {
  const inSet = (r: Run) => set === "all" || r.c.set === set;
  const english = runs.filter((r) => inSet(r) && r.c.expect.route === "english");
  const non = runs.filter((r) => inSet(r) && r.c.expect.route === "non_english");
  return {
    englishCorrect: pct(english.filter((r) => r.pass).length, english.length),
    englishRejected: pct(english.filter((r) => r.result.engine === "jev" && r.result.label === null).length, english.length),
    nonEnglishAccepted: pct(non.filter((r) => r.result.engine === "jev" && r.result.label !== null).length, non.length),
    nonEnglishRouted: pct(non.filter((r) => r.pass).length, non.length),
    errors: runs.filter((r) => inSet(r) && r.result.engine === "error").length,
  };
}

const lines: string[] = [];
const row = (...cells: (string | number)[]) => `| ${cells.join(" | ")} |`;

lines.push("# F2 test cases: Jev classifier", "");
lines.push(`Run: ${new Date().toISOString()}. Jev model: \`${JEV_MODEL}\`. Confidence threshold: ${JEV_MIN_CONFIDENCE}. Repeats per case: ${REPEATS}. Cases: ${cases.length}.`, "");

lines.push("## Rates", "", row("Set", "English correct", "English wrongly sent to non-English path", "Non-English wrongly given an English label", "Non-English sent to non-English path", "Jev errors"), row("---", "---", "---", "---", "---", "---"));
for (const set of ["tune", "heldout", "all"] as const) {
  const r = rates(set);
  lines.push(row(set, r.englishCorrect, r.englishRejected, r.nonEnglishAccepted, r.nonEnglishRouted, r.errors));
}

lines.push("", "## Acceptance-criteria cases (T01 to T05)", "", row("Case", "AC", "Message", "Expected", "Passes", "Seen", "Avg confidence", "Avg ms"), row("---", "---", "---", "---", "---", "---", "---", "---"));
for (const c of cases.filter((x) => x.ac)) {
  const rs = byCase(c);
  const confs = rs.flatMap((r) => (r.result.labelConfidence === null ? [] : [r.result.labelConfidence]));
  const expected = c.expect.route === "english" ? c.expect.label : "(non-English path)";
  lines.push(row(c.id, c.ac ?? "", c.body.slice(0, 50), expected, `${rs.filter((r) => r.pass).length}/${rs.length}`, [...new Set(rs.map((r) => r.got))].join(", "), avg(confs).toFixed(2), Math.round(avg(rs.map((r) => r.result.latencyMs)))));
}

lines.push("", "## Every case", "", row("Case", "Set", "Expected", "Passes", "Seen", "Avg confidence"), row("---", "---", "---", "---", "---", "---"));
for (const c of cases) {
  const rs = byCase(c);
  const confs = rs.flatMap((r) => (r.result.labelConfidence === null ? [] : [r.result.labelConfidence]));
  const expected = c.expect.route === "english" ? c.expect.label : "(non-English path)";
  lines.push(row(c.id, c.set, expected, `${rs.filter((r) => r.pass).length}/${rs.length}`, [...new Set(rs.map((r) => r.got))].join(", "), confs.length ? avg(confs).toFixed(2) : "-"));
}

const jevRuns = runs.filter((r) => r.result.engine === "jev");
lines.push("", "## Cost and speed", "", `Average cost per request (Jev calls): USD ${avg(jevRuns.flatMap((r) => (r.result.costUsd === null ? [] : [r.result.costUsd]))).toFixed(8)}. Total for this run: USD ${runs.reduce((s, r) => s + (r.result.costUsd ?? 0), 0).toFixed(6)}. Average latency (Jev calls): ${Math.round(avg(jevRuns.map((r) => r.result.latencyMs)))} ms. Calls skipped by the word check or empty text: ${runs.filter((r) => r.result.engine === "skipped").length} of ${runs.length}.`, "");

writeFileSync("cases/report.md", lines.join("\n"));
console.log(lines.join("\n"));

const acFailed = runs.some((r) => r.c.ac && !r.pass);
console.log(acFailed ? "\nFAIL: an acceptance-criteria case did not pass on every repeat." : "\nPASS: T01 to T05 passed on every repeat.");
process.exit(acFailed ? 1 : 0);
