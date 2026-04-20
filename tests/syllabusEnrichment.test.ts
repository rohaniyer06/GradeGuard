import { describe, expect, it } from "vitest";
import { buildSyllabusEnrichmentPlan, filterPlanByApprovedAssignmentIds } from "../src/syllabusEnrichment";
import type { Assignment, SyllabusItem } from "../src/types";

function assignment(partial: Partial<Assignment>): Assignment {
  return {
    id: partial.id || "a1",
    courseId: partial.courseId || "phys-7a",
    name: partial.name || "Homework Set 1 [PHYS 7A]",
    description: partial.description ?? null,
    dueAt: partial.dueAt || "2026-04-20T06:59:00.000Z",
    pointsPossible: partial.pointsPossible ?? null,
    submissionTypes: partial.submissionTypes ?? null,
    isSubmitted: partial.isSubmitted ?? 0,
    calendarEventId: partial.calendarEventId ?? null,
    notifiedAt: partial.notifiedAt ?? null
  };
}

function item(partial: Partial<SyllabusItem>): SyllabusItem {
  return {
    name: partial.name || "Homework Set 1",
    type: partial.type || "assignment",
    dueDate: partial.dueDate ?? "2026-04-20",
    points: partial.points ?? 20,
    weight: partial.weight ?? null,
    rawText: partial.rawText || "Homework Set 1 due 4/20"
  };
}

describe("syllabus enrichment plan", () => {
  it("matches syllabus items to likely assignments", () => {
    const plan = buildSyllabusEnrichmentPlan(
      [item({ name: "Homework Set 1" })],
      [assignment({ id: "event-assignment-1", name: "Homework Set 1 [PHYS 7A]" })]
    );

    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0].assignmentId).toBe("event-assignment-1");
    expect(plan.unmatchedSyllabusItems).toHaveLength(0);
  });

  it("leaves low-confidence items unmatched", () => {
    const plan = buildSyllabusEnrichmentPlan(
      [item({ name: "Final Project Milestone", dueDate: "2026-05-30" })],
      [assignment({ id: "event-assignment-2", name: "Quiz 1 [PHYS 7A]", dueAt: "2026-04-20T06:59:00.000Z" })]
    );

    expect(plan.matches).toHaveLength(0);
    expect(plan.unmatchedSyllabusItems).toHaveLength(1);
  });

  it("respects higher min-score threshold and records rejected matches", () => {
    const plan = buildSyllabusEnrichmentPlan(
      [item({ name: "Homework Set 1", dueDate: "2026-04-23" })],
      [assignment({ id: "event-assignment-3", name: "Homework Set 1 [PHYS 7A]", dueAt: "2026-04-20T06:59:00.000Z" })],
      { minScore: 0.95 }
    );

    expect(plan.matches).toHaveLength(0);
    expect(plan.rejectedMatches).toHaveLength(1);
    expect(plan.unmatchedSyllabusItems).toHaveLength(1);
  });

  it("filters plan by approved assignment ids", () => {
    const plan = buildSyllabusEnrichmentPlan(
      [item({ name: "Homework Set 1" }), item({ name: "Quiz 1", type: "quiz" })],
      [
        assignment({ id: "event-assignment-10", name: "Homework Set 1 [PHYS 7A]" }),
        assignment({ id: "event-assignment-11", name: "Quiz 1 [PHYS 7A]" })
      ]
    );

    const filtered = filterPlanByApprovedAssignmentIds(plan, new Set(["event-assignment-11"]));
    expect(filtered.matches).toHaveLength(1);
    expect(filtered.matches[0].assignmentId).toBe("event-assignment-11");
    expect(filtered.rejectedMatches.length).toBeGreaterThanOrEqual(1);
  });
});
