import { beforeEach, describe, expect, it, vi } from "vitest";

const insertDigest = vi.fn();
const listAssignmentsBetween = vi.fn();
const generateText = vi.fn();
const isLlmConfigured = vi.fn();

vi.mock("../src/db", () => ({
  insertDigest,
  listAssignmentsBetween
}));

vi.mock("../src/llm", () => ({
  generateText,
  isLlmConfigured
}));

describe("digest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates fallback daily digest when llm is not configured", async () => {
    isLlmConfigured.mockReturnValue(false);
    listAssignmentsBetween.mockReturnValue([
      {
        name: "Homework 1",
        courseName: "PHYS 7A",
        dueAt: "2026-04-17T23:59:00.000Z"
      }
    ]);

    const { generateDailyDigest } = await import("../src/digest");
    const result = await generateDailyDigest();

    expect(result).toContain("Daily Digest");
    expect(result).toContain("Homework 1");
    expect(insertDigest).toHaveBeenCalledWith("daily", expect.any(String));
  });

  it("uses llm output for weekly digest when configured", async () => {
    isLlmConfigured.mockReturnValue(true);
    listAssignmentsBetween.mockReturnValue([{ name: "Quiz 4", courseName: "PHYS 7A", dueAt: "2026-04-18T20:00:00.000Z" }]);
    generateText.mockResolvedValue("Weekly digest from llm");

    const { generateWeeklyDigest } = await import("../src/digest");
    const result = await generateWeeklyDigest();

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(result).toBe("Weekly digest from llm");
    expect(insertDigest).toHaveBeenCalledWith("weekly", "Weekly digest from llm");
  });
});
