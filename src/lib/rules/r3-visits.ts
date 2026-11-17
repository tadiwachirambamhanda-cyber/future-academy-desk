import type { Failure } from "./types";

// R3: visits are Monday to Friday at 09:00, 11:00 or 14:00, and the agent never confirms a booking.
export const VISIT_TIMES = ["09:00", "11:00", "14:00"];

function timesIn(reply: string): string[] {
  const times: string[] = [];
  for (const m of reply.matchAll(/\b(\d{1,2})[:.h](\d{2})\b/g)) times.push(`${m[1].padStart(2, "0")}:${m[2]}`);
  for (const m of reply.matchAll(/\b(\d{1,2})\s?(am|pm)\b/gi)) {
    let h = Number(m[1]) % 12;
    if (m[2].toLowerCase() === "pm") h += 12;
    times.push(`${String(h).padStart(2, "0")}:00`);
  }
  return times;
}

export function checkR3(reply: string): Failure[] {
  const failures: Failure[] = [];
  if (/\b(confirmed|booked|reserved|yasimbiswa|yabhukwa|kubhuka|kuqinisekisiwe|kubhukiwe|bhukiwe)\b/i.test(reply)) {
    failures.push({ rule: "R3", detail: "confirms or books a visit" });
  }
  for (const t of timesIn(reply)) {
    if (!VISIT_TIMES.includes(t)) failures.push({ rule: "R3", detail: `visit time ${t} is not 09:00, 11:00 or 14:00` });
  }
  return failures;
}
