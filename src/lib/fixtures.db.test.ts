import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getDb } from "./db";

// Needs the Supabase variables. Run with: npm run test:db
// Fails if the sample webhook message holds any phone number that is really stored.
describe("fixtures hold no real values", () => {
  it("the sample message contains no stored sender number", async () => {
    const sample = readFileSync(new URL("./fixtures/d360-text-message.json", import.meta.url), "utf8");
    const { data, error } = await getDb().from("academy_conversations").select("wa_id").not("wa_id", "like", "test-%");
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(sample.includes(row.wa_id)).toBe(false);
    }
  });
});
