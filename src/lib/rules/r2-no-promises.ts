import type { Failure } from "./types";

// R2: never confirm, promise or guarantee a place. Only the admissions office does.
const PATTERNS: [RegExp, string][] = [
  [/\bguarantee[sd]?\b/i, "guarantee"],
  [/\b(place|spot|seat)\b[^.!?]{0,40}\b(is|has been|have been|are)\b[^.!?]{0,20}\b(confirmed|secured|reserved|guaranteed|yours)\b/i, "place confirmed"],
  [/\byou (have|will have|will get|('ve| have) got|have been given) a (place|spot|seat)\b/i, "promised a place"],
  [/\bwe (confirm|will confirm) your (place|admission|enrolment|enrollment)\b/i, "we confirm your place"],
  [/\badmission is (confirmed|assured)\b/i, "admission confirmed"],
  // Shona and Ndebele (draft word lists, to be reviewed by native speakers)
  [/\b(ndinovimbisa|tinovimbisa|vimbiso|yasimbiswa|wasimbiswa|ine nzvimbo yakasimbiswa)\b/i, "promise or confirmation (Shona)"],
  [/\b(sithembisa|ngithembisa|isithembiso|kuqinisekisiwe|siqinisekisile|sikuqinisekisele)\b/i, "promise or confirmation (Ndebele)"],
];

export function checkR2(reply: string): Failure[] {
  return PATTERNS.filter(([p]) => p.test(reply)).map(([, name]) => ({ rule: "R2", detail: `promises a place (${name})` }));
}
