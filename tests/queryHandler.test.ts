import { beforeEach, describe, expect, it, vi } from "vitest";

const listAssignmentsBetween = vi.fn();
const listAssignmentSnapshotForLlm = vi.fn();
const listOverdueAssignments = vi.fn();
const generateText = vi.fn();
const isLlmConfigured = vi.fn();

vi.mock("../src/db", () => ({
  listAssignmentsBetween,
  listAssignmentSnapshotForLlm,
  listOverdueAssignments
}));

vi.mock("../src/llm", () => ({
  generateText,
  isLlmConfigured
}));

describe("queryHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAssignmentsBetween.mockReturnValue([]);
    listOverdueAssignments.mockReturnValue([]);
  });

  it("returns fallback due-this-week response", async () => {
    isLlmConfigured.mockReturnValue(false);
    listAssignmentsBetween.mockReturnValue([
      {
        name: "H01",
        courseName: "CMPSC 176A",
        dueAt: "2026-04-17T23:59:00.000Z"
      }
    ]);

    const { handleQuery } = await import("../src/queryHandler");
    const result = await handleQuery("What's due this week?");

    expect(result).toContain("Assignments due this week");
    expect(result).toContain("H01");
  });

  it("uses llm path when configured", async () => {
    isLlmConfigured.mockReturnValue(true);
    listAssignmentSnapshotForLlm.mockReturnValue([{ name: "Quiz 4" }]);
    generateText.mockResolvedValue("LLM answer");

    const { handleQuery } = await import("../src/queryHandler");
    const result = await handleQuery("When is my next exam?");

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(result).toBe("LLM answer");
  });
});
