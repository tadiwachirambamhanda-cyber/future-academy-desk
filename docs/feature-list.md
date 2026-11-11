# Feature list: Future Academy Desk

Source: `docs/prd.md`. Build order follows the solution shape: message in, understand (Jev, or Claude for Shona and Ndebele), decide (code), write the reply (Claude), check it (code), send or hand over to a person.

## Features

| ID | Feature (what a person can do or see) | Done check | AC | Version | Status |
|---|---|---|---|---|---|
| F1 | A WhatsApp message sent to the sandbox is received and saved, with the conversation history, in Supabase | I send "Hello" from the sandbox phone and a new row appears in `messages` linked to a `conversations` row, marked `is_synthetic` | AC5 | v1 | built, not merged |
| F2 | Each English message is sorted by Jev into a label (fees, term dates, visit, admissions, uniform, transport, complaint, health, not in handbook, bypass attempt) with a confidence | `npm run cases` shows the Jev label and confidence for the English cases in T01 to T04, and each message row stores label, confidence and latency | AC1, AC2, AC3, AC4 | v1 | not started |
| F3 | A Shona or Ndebele message is recognised and sorted by Claude into the same labels, with a confidence | I send "Mari yeGrade 3 inoita marii?" and the message row shows language `sn`, label `fees` and a confidence; an Ndebele fees question shows language `nd` and label `fees` | AC1 | v1 | not started |
| F4 | The rules R1 to R9 decide, in code, what the agent may do for each label | `npm run cases` shows one passing unit test per rule, each named with its id (R1 to R9) | AC1, AC2, AC3, AC4 | v1 | not started |
| F5 | Claude writes a warm, short reply in the parent's language from the handbook and the saved history, and the reply is checked in code, with one fix attempt before hand-over | I ask "How much are Grade 3 fees?" then "And Form 1?", and `npm run cases` passes T01 (English and Shona) and T05 (replies contain 450 and 680) | AC1, AC3, AC5 | v1 | not started |
| F6 | An exception sends the parent a fixed holding reply and writes a hand-over row with the reason | I send "Do you have a school canteen?" and the sandbox phone gets a holding reply, and one `handovers` row has reason `not_in_handbook`; T02 and T04 pass | AC2, AC4 | v1 | not started |
| F7 | The reply goes back to the parent on WhatsApp through 360dialog, and every decision is logged with its cost | I send "How much are Grade 3 fees?" from the sandbox phone and get the reply on the phone; the `decisions` row shows the checks, status, language, latency and cost | AC1, AC5 | v1 | not started |
| F8 | The agent still answers from fixed wording when the Jev key fails (templates mode) | With `AI_MODE=templates`, a fees question gets the fixed fees answer | none | later | not started |
| F9 | A page showing hand-overs for the admissions officer | The officer opens a page and sees today's hand-overs | none | later | not started |

## Acceptance criteria coverage

- AC1: F2, F3, F4, F5, F7
- AC2: F2, F4, F6
- AC3: F2, F4, F5
- AC4: F2, F4, F6
- AC5: F1, F5, F7

## Later

- Templates mode fallback when the Jev key fails (F8).
- A hand-over page for the admissions officer (F9).
- Handling images and voice notes from parents.
- Visit booking that checks a real calendar.
- A review of Shona and Ndebele replies by native speakers.
