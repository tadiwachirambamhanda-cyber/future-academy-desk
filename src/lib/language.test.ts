import { describe, it, expect } from "vitest";
import { nonEnglishWordMatch } from "./language";

describe("nonEnglishWordMatch", () => {
  it("catches a Shona question", () => {
    expect(nonEnglishWordMatch("Mari yeGrade 3 inoita marii?")).toBe("shona");
  });
  it("catches a mixed message with one Shona word", () => {
    expect(nonEnglishWordMatch("Mari ye Grade 3 please")).toBe("shona");
  });
  it("catches a Ndebele question", () => {
    expect(nonEnglishWordMatch("Sawubona, malini ukufunda kweGrade 3?")).toBe("ndebele");
  });
  it("is not case or punctuation sensitive", () => {
    expect(nonEnglishWordMatch("NGICELA, help!")).toBe("ndebele");
  });
  it("leaves plain English alone", () => {
    expect(nonEnglishWordMatch("How much are Grade 3 fees?")).toBeNull();
    expect(nonEnglishWordMatch("Hello, can I visit on Monday?")).toBeNull();
  });
  it("matches whole words only", () => {
    expect(nonEnglishWordMatch("I am marinating on it")).toBeNull();
  });
});
