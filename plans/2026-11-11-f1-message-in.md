# Plan: F1, a WhatsApp message comes in and is saved

## Goal
After this, a parent's WhatsApp message sent to the 360dialog sandbox number reaches the app and is saved in Supabase, inside a conversation that remembers the earlier messages from the same parent. The agent does not answer yet.

## Feature
- ID: F1. Serves AC5 (the memory it needs).
- Done check: I send "Hello" from the sandbox phone and a new row appears in `messages`, linked to a `conversations` row, marked `is_synthetic`.

## Steps
1. **Start the app.** Create the Next.js project (TypeScript, the current Next.js version, after reading `node_modules/next/dist/docs/`), with `zod`, `@supabase/supabase-js` and Vitest. The folder already holds `CLAUDE.md`, `data/` and `docs/`, so I generate the project in a scratch folder and copy its files in by name. Scripts: `dev`, `build`, `lint`, `typecheck`, `test` (unit tests with a fake memory module, no environment variables needed) and `test:db` (database tests, which run only when the Supabase variables are set). Write `.env.example` with names only: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `D360_API_KEY`, `D360_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`. Done when `npm run build`, `npm run lint`, `npm run typecheck` and `npm test` pass with no environment variables set.
2. **Create the database.** Make a new Supabase project called `future-academy-desk` (see Questions) and write one migration with two tables, locked with row-level security and no public access:
   - `conversations`: id, channel, `wa_id` (the sender's WhatsApp number), status (`bot` or `with_person`), `is_synthetic` (not null, default true), created_at, last_message_at. One conversation per `wa_id`.
   - `messages`: id, conversation_id, direction (`in` or `out`), body, `wa_message_id` (unique), `sent_at` (the WhatsApp timestamp), `is_synthetic` (not null, default true), created_at.
   - The migration also revokes all table privileges from the `anon` and `authenticated` roles, so locking does not rely on row-level security alone.
   Done when I list the tables and see row-level security on, and a select and an insert with the public (anon) key both fail or return nothing on both tables.
3. **Write the memory code** in `src/lib/db.ts` (server-only client) and `src/lib/memory.ts` (the only file that talks to the tables). One database function does the saving together: find or create the conversation (an upsert, so two messages arriving together cannot create two conversations), insert the message (a WhatsApp message id already seen is ignored, so a retry saves nothing twice), and set `last_message_at` only after the insert succeeds. Reading the last 10 messages of a conversation sorts by `sent_at`, then by id, oldest first. Done when `npm run test:db` saves a made-up conversation, reads it back identical and in order, saves the same message id twice and gets one row, saves two messages at once for a new number and gets one conversation, then deletes everything it made.
4. **Read the 360dialog message** in `src/lib/whatsapp.ts`: a zod schema that pulls out the sender number, message id and text from the webhook body. I will first capture one real sandbox payload (step 6), because the sandbox docs do not show the exact shape. Until then the schema accepts both known shapes (the Cloud API shape with `entry` / `changes`, and the older flat `messages` shape). Only text messages are saved; images, voice notes and the like are ignored and counted in a log line. Done when unit tests pass for both shapes, a text message, a non-text message and a broken body.
5. **Write the webhook** `src/app/api/whatsapp/route.ts`: it refuses a request whose secret header (`D360_WEBHOOK_SECRET`, compared in constant time) is wrong, refuses a body over 64 KB (read with a running byte count that stops at the limit, not just the Content-Length header), parses the message, saves it through `memory.ts`, and answers 200 fast. A failed save answers with an error so 360dialog retries, and the retry is safe because of step 3. The message text is stored as data and never used as an instruction. Done when tests show: wrong secret gives 401, a good message gives 200 and one row, the same message twice gives one row, and a database failure gives a 500 with a log line that has no message text or number.
6. **Deploy and connect the real sandbox.** I deploy the app to Vercel (project, build, and the server-side environment variables, which you paste in). Vercel can turn away outside callers on preview deployments, so I use a production deployment or switch the protection off for the webhook path, and check that a plain request from outside gets a 401 from our code, not a Vercel login page. You send START to the 360dialog sandbox number to get a test key and put it in `.env.local`. I register the webhook URL and secret header with 360dialog. Done when "Hello" from the sandbox phone creates a `messages` row with direction `in` and `is_synthetic` true.
7. **Keep the real payload as a fixture, scrubbed.** I replace the number, the profile name and every id with made-up values and add a test that fails if the fixture holds the sandbox phone's number or name. Done when the parser test passes on the scrubbed fixture.

## Files
- Create: `package.json`, `tsconfig.json`, `.env.example`, `next.config.ts`, `src/lib/db.ts`, `src/lib/memory.ts`, `src/lib/whatsapp.ts`, `src/app/api/whatsapp/route.ts`, `supabase/migrations/<date>_create_tables.sql`, tests in `src/lib/*.test.ts` and `src/app/api/whatsapp/route.test.ts`, and a fixture `src/lib/fixtures/d360-text-message.json`.
- Change: `CLAUDE.md` (add the commands once they exist).
- Not touched: `data/` and the rules.

## AI parts
None. F1 calls no model. Jev arrives in F2, Claude in F3 and F5.

## Approval and data
- Nothing leaves the solution in F1. The webhook only receives and stores. No reply is sent.
- Secrets, server side only: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `D360_API_KEY` (used from F7), `D360_WEBHOOK_SECRET`. No `NEXT_PUBLIC_` on any of them. Values go in `.env.local`, which I never read or print.
- Personal data: the sandbox test phone is the only sender. Its number is stored in `conversations.wa_id` (needed to reply in F7), in a locked table, marked `is_synthetic`. Logs hold only ids, counts and timings, never message text or numbers. Test fixtures use a made-up number.

## Checks
| Check | Expected result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm test` | no errors, all tests pass |
| `npm run build` with no environment variables set | passes |
| `npm run test:db` (needs Supabase variables): save a made-up conversation, read it back, save the same message id twice, two messages at once for a new number, delete | identical read-back in `sent_at` order, one row for the repeated id, one conversation, nothing left over |
| Unit test of `getRecentMessages` ordering with equal and out-of-order timestamps | oldest first, ties broken by id |
| Unit tests for the parser (Cloud API shape, flat shape, text, image, broken body) | text is extracted; image is ignored; broken body is rejected |
| Webhook test: wrong or missing secret | 401 and no row |
| Webhook test: good text message | 200 and one `messages` row, direction `in`, `is_synthetic` true |
| Webhook test: the same message id posted twice | one row |
| Webhook test: body over 64 KB, including one sent without a Content-Length | refused, no row |
| Webhook test: database unreachable (fake memory that throws) | 500, and the log line has no message text or number |
| Public (anon) key: a select and an insert on both tables | both fail or return nothing, and no row is created |
| Plain request to the deployed webhook from outside, no secret | 401 from our code (not a Vercel login page) |
| Fixture test | the scrubbed fixture holds no real number or name |
| Real check: "Hello" from the sandbox phone | a new `messages` row linked to a `conversations` row, marked `is_synthetic` (the F1 done check) |
| Real check: "Hello" then "Hello again" from the sandbox phone | one conversation, two `in` messages, and `getRecentMessages` returns both in order |

## What could break
The riskiest step is 6 (with 7), because the real 360dialog payload may differ from what the schema expects, so the first real message could be rejected. That is why I capture one real payload first and turn it into a test. Nothing else exists yet, so nothing already working can break.

## Not doing
- Any reply to the parent, and sending through 360dialog (F7).
- Jev, Claude, rules, language detection, hand-overs and the decision log (F2 to F6). Their columns and tables arrive in their own migrations.
- Images, voice notes, documents (out of scope).
- Delivery receipts and status callbacks from 360dialog (ignored and counted).
- A login, a dashboard or any screen.
- Deleting old messages, or retention rules.

## Questions
1. May I create a new Supabase project called `future-academy-desk`? The cost check shows $0 a month on your plan, in the Havenly organisation. Reusing `liwan-desk` would mix two schools' data, so I recommend a new one.
2. Which region for it? I suggest `ap-south-1` (Mumbai), like your other projects, or `af-south-1` (Cape Town) if available, which is closer to Zimbabwe.
3. For the real sandbox check, shall I use a Vercel production deployment (stable address, you add the keys in Vercel) or a temporary tunnel from your laptop (quicker, needs an installer you run)? I suggest the Vercel deployment.

## Plan check
A fresh reviewer found 7 issues plus 2 small ones. All were accepted and the plan was changed:
- Tests now split into `npm test` (fake memory, no variables) and `npm run test:db` (real database), with each check saying which it uses.
- "Locked" is now proven by revoking `anon` and `authenticated` privileges and checking a select and an insert, not by expecting a 401.
- Step 6 now covers deploying to Vercel, deployment protection and an outside-caller check.
- The 64 KB limit counts bytes as they are read.
- `is_synthetic` defaults to true, messages store `sent_at`, and ordering is `sent_at` then id, with a unit test.
- The conversation upsert, the message insert and `last_message_at` happen in one database function.
- The fixture is scrubbed of the number, name and ids, with a test that fails if real values remain.
- A `lint` script is added, and the project is generated in a scratch folder because the folder is not empty.
- Dismissed: nothing.
