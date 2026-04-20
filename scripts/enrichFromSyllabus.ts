import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { extractSyllabusItemsFromFile } from "../src/syllabusParser";
import {
  applySyllabusEnrichmentPlan,
  filterPlanByApprovedAssignmentIds,
  planAndApplySyllabusItems
} from "../src/syllabusEnrichment";

dotenv.config();

function parseArgs(argv: string[]): {
  filePath: string;
  apply: boolean;
  force: boolean;
  outPath: string | null;
  minScore: number;
  approveFilePath: string | null;
} {
  const apply = argv.includes("--apply");
  const force = argv.includes("--force");
  const outIndex = argv.findIndex((arg) => arg === "--out");
  const outPath = outIndex >= 0 ? (argv[outIndex + 1] || null) : null;
  const scoreIndex = argv.findIndex((arg) => arg === "--min-score");
  const minScoreRaw = scoreIndex >= 0 ? argv[scoreIndex + 1] : "0.45";
  const minScore = Number(minScoreRaw);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new Error(`Invalid --min-score "${minScoreRaw}". Use a number between 0 and 1.`);
  }
  const approveIndex = argv.findIndex((arg) => arg === "--approve-file");
  const approveFilePath = approveIndex >= 0 ? (argv[approveIndex + 1] || null) : null;
  const filePath =
    argv.find(
      (arg, idx) =>
        !arg.startsWith("--") &&
        !["--out", "--min-score", "--approve-file"].includes(argv[idx - 1] || "")
    ) || "";
  if (!filePath) {
    throw new Error(
      "Usage: npm run syllabus:enrich -- <file.pdf|file.txt> [--apply] [--force] [--min-score 0.6] [--out report.json]"
    );
  }
  return { filePath, apply, force, outPath, minScore, approveFilePath };
}

function buildDefaultReportPath(inputPath: string): string {
  const safeBase = path.basename(inputPath).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(process.cwd(), "reports", `syllabus-enrichment-${safeBase}-${stamp}.json`);
}

function readApprovedIds(approveFilePath: string): Set<string> {
  const absoluteApprovePath = path.resolve(process.cwd(), approveFilePath);
  if (!fs.existsSync(absoluteApprovePath)) {
    throw new Error(`Approve file does not exist: ${absoluteApprovePath}`);
  }
  const raw = fs.readFileSync(absoluteApprovePath, "utf8");
  const parsed = JSON.parse(raw) as
    | string[]
    | { approvedAssignmentIds?: string[]; approvedMatches?: Array<{ assignmentId?: string }> };

  const ids = new Set<string>();
  if (Array.isArray(parsed)) {
    for (const id of parsed) {
      if (typeof id === "string" && id.trim()) {
        ids.add(id.trim());
      }
    }
    return ids;
  }
  if (Array.isArray(parsed.approvedAssignmentIds)) {
    for (const id of parsed.approvedAssignmentIds) {
      if (typeof id === "string" && id.trim()) {
        ids.add(id.trim());
      }
    }
  }
  if (Array.isArray(parsed.approvedMatches)) {
    for (const match of parsed.approvedMatches) {
      if (match && typeof match.assignmentId === "string" && match.assignmentId.trim()) {
        ids.add(match.assignmentId.trim());
      }
    }
  }
  return ids;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const absolutePath = path.resolve(process.cwd(), args.filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Input file does not exist: ${absolutePath}`);
  }

  const items = await extractSyllabusItemsFromFile(absolutePath);
  const previewResult = planAndApplySyllabusItems(items, {
    apply: false,
    force: args.force,
    minScore: args.minScore
  });
  let plan = previewResult.plan;

  let approvedAssignmentIds: string[] | null = null;
  if (args.approveFilePath) {
    const approvedSet = readApprovedIds(args.approveFilePath);
    approvedAssignmentIds = Array.from(approvedSet);
    plan = filterPlanByApprovedAssignmentIds(plan, approvedSet);
  }

  const applyResult = args.apply ? applySyllabusEnrichmentPlan(plan, { force: args.force }) : undefined;
  const reportPath = path.resolve(process.cwd(), args.outPath ?? buildDefaultReportPath(absolutePath));

  const reportPayload = {
    event: "syllabus_enrichment_complete",
    file: absolutePath,
    extractedCount: items.length,
    matchedCount: plan.matches.length,
    unmatchedSyllabusCount: plan.unmatchedSyllabusItems.length,
    unmatchedAssignmentsCount: plan.unmatchedAssignments.length,
    rejectedMatchesCount: plan.rejectedMatches.length,
    apply: args.apply,
    force: args.force,
    minScore: args.minScore,
    approveFilePath: args.approveFilePath,
    approvedAssignmentIds,
    applyResult: applyResult ?? null,
    matches: plan.matches,
    rejectedMatches: plan.rejectedMatches,
    unmatchedSyllabusItems: plan.unmatchedSyllabusItems,
    unmatchedAssignments: plan.unmatchedAssignments
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2));

  console.log(
    JSON.stringify(
      {
        ...reportPayload,
        reportPath,
        matchesPreview: plan.matches.slice(0, 10).map((m) => ({
          syllabusName: m.syllabusItem.name,
          assignmentId: m.assignmentId,
          assignmentName: m.assignmentName,
          score: m.score,
          reason: m.reason
        }))
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("syllabus_enrichment_failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
