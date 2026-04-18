import { describe, expect, it } from "vitest";
import { formatMetadataSuffix, parseSyllabusMetadata } from "../src/syllabusMetadata";

describe("syllabusMetadata", () => {
  it("parses valid submission metadata json", () => {
    const parsed = parseSyllabusMetadata(
      JSON.stringify({ source: "syllabus", type: "quiz", weight: 15, rawText: "Quiz 1 15%" })
    );
    expect(parsed?.type).toBe("quiz");
    expect(parsed?.weight).toBe(15);
  });

  it("formats points/type/weight suffix", () => {
    const suffix = formatMetadataSuffix({
      pointsPossible: 20,
      submissionTypes: JSON.stringify({ type: "assignment", weight: 10 })
    });
    expect(suffix).toContain("20 pts");
    expect(suffix).toContain("assignment");
    expect(suffix).toContain("10%");
  });
});
