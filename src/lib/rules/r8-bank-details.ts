import type { Failure } from "./types";

// R8: bank details are never sent over WhatsApp.
export function checkR8(reply: string): Failure[] {
  const failures: Failure[] = [];
  if (/\b(account (number|no\.?)|iban|swift|sort code|routing number|ecocash (number|merchant|code)|nhamba yeakaundi|inombolo ye-?akhawunti|akaundi yebhengi|i-?akhawunti yebhange)\b/i.test(reply)) {
    failures.push({ rule: "R8", detail: "mentions bank or payment account details" });
  }
  if (/\d{9,}/.test(reply.replace(/[\s-]/g, "").replace(/\+/g, ""))) {
    // a long run of digits with the spaces taken out could be an account number
    if (/\d{9,}/.test(reply)) failures.push({ rule: "R8", detail: "contains a long number" });
  }
  return failures;
}
