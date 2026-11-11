import { describe, it, expect } from "vitest";
import { oldestFirst, type StoredMessage } from "./memory";

const row = (id: string, sent_at: string): StoredMessage => ({
  id,
  direction: "in",
  body: id,
  sent_at,
});

describe("getRecentMessages ordering", () => {
  it("puts the oldest message first", () => {
    const out = oldestFirst([
      row("c", "2026-11-11T10:00:03Z"),
      row("a", "2026-11-11T10:00:01Z"),
      row("b", "2026-11-11T10:00:02Z"),
    ]);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("orders messages that arrived out of order by their WhatsApp time", () => {
    const out = oldestFirst([
      row("late-id", "2026-11-11T10:00:01Z"),
      row("early-id", "2026-11-11T10:00:09Z"),
    ]);
    expect(out.map((m) => m.id)).toEqual(["late-id", "early-id"]);
  });

  it("breaks ties with the same time by id", () => {
    const out = oldestFirst([
      row("b", "2026-11-11T10:00:00Z"),
      row("a", "2026-11-11T10:00:00Z"),
    ]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });
});
