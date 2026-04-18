import { listAssignments, updateAssignmentSyllabusData } from "./db";
import type { Assignment, SyllabusItem } from "./types";

export interface SyllabusMatch {
  syllabusItem: SyllabusItem;
  assignmentId: string;
  assignmentName: string;
  score: number;
  reason: string;
}

export interface SyllabusEnrichmentPlan {
  matches: SyllabusMatch[];
  rejectedMatches: SyllabusMatch[];
  unmatchedSyllabusItems: SyllabusItem[];
  unmatchedAssignments: Assignment[];
}

function stripCourseTag(name: string): string {
  return name.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function tokenize(name: string): Set<string> {
  return new Set(
    stripCourseTag(name)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isoDateOnly(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function dateDistanceDays(a: string, b: string): number {
  const aTime = Date.parse(`${a}T00:00:00Z`);
  const bTime = Date.parse(`${b}T00:00:00Z`);
  return Math.round(Math.abs(aTime - bTime) / (24 * 60 * 60 * 1000));
}

function scoreMatch(item: SyllabusItem, assignment: Assignment): { score: number; reason: string } {
  const nameScore = jaccard(tokenize(item.name), tokenize(assignment.name));
  let dateScore = 0;
  const assignmentDate = isoDateOnly((assignment as unknown as { dueAt?: string }).dueAt);

  if (item.dueDate && assignmentDate) {
    const distance = dateDistanceDays(item.dueDate, assignmentDate);
    if (distance === 0) {
      dateScore = 1;
    } else if (distance === 1) {
      dateScore = 0.5;
    }
  }

  const total = nameScore * 0.8 + dateScore * 0.2;
  return {
    score: total,
    reason: `name=${nameScore.toFixed(2)},date=${dateScore.toFixed(2)}`
  };
}

export function buildSyllabusEnrichmentPlan(
  items: SyllabusItem[],
  assignments: Assignment[],
  options?: { minScore?: number }
): SyllabusEnrichmentPlan {
  const minScore = options?.minScore ?? 0.45;
  const matches: SyllabusMatch[] = [];
  const rejectedMatches: SyllabusMatch[] = [];
  const unmatchedSyllabusItems: SyllabusItem[] = [];
  const takenAssignmentIds = new Set<string>();

  for (const item of items) {
    let best: { assignment: Assignment; score: number; reason: string } | null = null;
    for (const assignment of assignments) {
      if (takenAssignmentIds.has(assignment.id)) {
        continue;
      }
      const { score, reason } = scoreMatch(item, assignment);
      if (!best || score > best.score) {
        best = { assignment, score, reason };
      }
    }

    if (!best) {
      unmatchedSyllabusItems.push(item);
      continue;
    }

    if (best.score < minScore) {
      rejectedMatches.push({
        syllabusItem: item,
        assignmentId: best.assignment.id,
        assignmentName: best.assignment.name,
        score: Number(best.score.toFixed(3)),
        reason: `${best.reason},minScore=${minScore.toFixed(2)}`
      });
      unmatchedSyllabusItems.push(item);
      continue;
    }

    takenAssignmentIds.add(best.assignment.id);
    matches.push({
      syllabusItem: item,
      assignmentId: best.assignment.id,
      assignmentName: best.assignment.name,
      score: Number(best.score.toFixed(3)),
      reason: best.reason
    });
  }

  const unmatchedAssignments = assignments.filter((assignment) => !takenAssignmentIds.has(assignment.id));
  return { matches, rejectedMatches, unmatchedSyllabusItems, unmatchedAssignments };
}

function toSubmissionMetadata(item: SyllabusItem): string {
  return JSON.stringify({
    source: "syllabus",
    type: item.type,
    weight: item.weight,
    rawText: item.rawText
  });
}

export function applySyllabusEnrichmentPlan(
  plan: SyllabusEnrichmentPlan,
  options?: { force?: boolean }
): { updatedRows: number; attempted: number } {
  const force = options?.force ?? false;
  let updatedRows = 0;

  for (const match of plan.matches) {
    const changes = updateAssignmentSyllabusData(
      match.assignmentId,
      {
        pointsPossible: match.syllabusItem.points,
        submissionTypes: toSubmissionMetadata(match.syllabusItem)
      },
      force
    );
    updatedRows += changes;
  }

  return {
    updatedRows,
    attempted: plan.matches.length
  };
}

export function planAndApplySyllabusItems(
  items: SyllabusItem[],
  options?: { apply?: boolean; force?: boolean; minScore?: number }
): { plan: SyllabusEnrichmentPlan; applyResult?: { updatedRows: number; attempted: number } } {
  const assignments = listAssignments();
  const plan = buildSyllabusEnrichmentPlan(items, assignments, { minScore: options?.minScore });
  if (!options?.apply) {
    return { plan };
  }
  const applyResult = applySyllabusEnrichmentPlan(plan, { force: options.force });
  return { plan, applyResult };
}
